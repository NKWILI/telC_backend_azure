import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
  Optional,
  Inject,
} from '@nestjs/common';
import { DatabaseService } from '../../shared/services/database.service';
import type {
  ExerciseTypeDto,
  ExerciseAttemptDto,
  SubmitWritingResponseDto,
} from './dto';
import type { SubmitWritingDto } from './dto';

/** Known exercise type ids (Teile) for Schreiben. */
const WRITING_TEIL_IDS = ['1', '2'];

/** Static exercise type definitions (exam language). */
const STATIC_TEILS: Omit<ExerciseTypeDto, 'progress'>[] = [
  {
    id: '1',
    title: 'E-Mail',
    subtitle: 'Formelle E-Mail schreiben',
    prompt: 'Schreiben Sie eine E-Mail an...',
    imagePath: '',
    part: 1,
    durationMinutes: 15,
  },
  {
    id: '2',
    title: 'Beitrag',
    subtitle: 'Forumsbeitrag',
    prompt: 'Schreiben Sie einen Beitrag...',
    imagePath: '',
    part: 2,
    durationMinutes: 20,
  },
];

export interface WritingCorrectionQueue {
  add(data: {
    attemptId: string;
    studentId: string;
    exerciseId: string;
    content: string;
    createdAt: string;
  }): Promise<unknown>;
}

@Injectable()
export class WritingService {
  private readonly logger = new Logger(WritingService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject('WRITING_CORRECTION_QUEUE')
    private readonly correctionQueue?: WritingCorrectionQueue,
  ) {}

  /**
   * GET /api/writing/teils — list exercise types with progress for the student.
   */
  async getTeils(studentId: string): Promise<ExerciseTypeDto[]> {
    const progressByExercise = await this.getProgressByExercise(studentId);
    return STATIC_TEILS.map((t) => ({
      ...t,
      progress: progressByExercise[t.id] ?? 0,
    }));
  }

  /**
   * GET /api/writing/sessions — list past attempts, optionally filtered by teilNumber (exercise id).
   */
  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<ExerciseAttemptDto[]> {
    try {
      let query = this.db
        .getClient()
        .from('writing_attempts')
        .select(
          'attempt_id, created_at, completed_at, score, feedback, duration_seconds',
        )
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (teilNumber !== undefined) {
        const exerciseId = String(teilNumber);
        if (WRITING_TEIL_IDS.includes(exerciseId)) {
          query = query.eq('exercise_id', exerciseId);
        }
      }

      const { data: rows, error } = await query;

      if (error) {
        this.logger.error(`Failed to fetch writing sessions: ${error.message}`);
        return [];
      }

      return (rows || []).map((row: any) =>
        this.mapRowToAttemptDto(row),
      );
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * POST /api/writing/submit — create attempt (pending), enqueue correction, return 201.
   */
  async submit(
    studentId: string,
    dto: SubmitWritingDto,
  ): Promise<SubmitWritingResponseDto> {
    const { exerciseId, content } = dto;

    if (!WRITING_TEIL_IDS.includes(exerciseId)) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise type not found',
        messageKey: 'writingExerciseNotFound',
      });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Content must not be empty',
        messageKey: 'writingContentTooShort',
      });
    }

    const attemptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const { error: insertError } = await this.db
      .getClient()
      .from('writing_attempts')
      .insert({
        attempt_id: attemptId,
        student_id: studentId,
        exercise_id: exerciseId,
        content: content.trim(),
        status: 'pending',
        created_at: createdAt,
      });

    if (insertError) {
      this.logger.error(`Failed to create writing attempt: ${insertError.message}`);
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Failed to save submission',
        messageKey: 'writingSubmitFailed',
      });
    }

    if (this.correctionQueue) {
      try {
        await this.correctionQueue.add({
          attemptId,
          studentId,
          exerciseId,
          content: content.trim(),
          createdAt,
        });
      } catch (err) {
        this.logger.warn(
          `Enqueue correction failed (attempt ${attemptId} saved): ${(err as Error).message}`,
        );
      }
    }

    return {
      attemptId,
      status: 'pending',
      message: 'Submission received. Correction in progress.',
    };
  }

  private async getProgressByExercise(
    studentId: string,
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const id of WRITING_TEIL_IDS) {
      result[id] = 0;
    }
    try {
      const { data: rows, error } = await this.db
        .getClient()
        .from('writing_attempts')
        .select('exercise_id')
        .eq('student_id', studentId)
        .eq('status', 'completed');

      if (error || !rows) return result;
      for (const row of rows as { exercise_id: string }[]) {
        if (WRITING_TEIL_IDS.includes(row.exercise_id)) {
          result[row.exercise_id] = 100;
        }
      }
    } catch {
      // ignore
    }
    return result;
  }

  private mapRowToAttemptDto(row: {
    attempt_id: string;
    created_at?: string;
    completed_at?: string | null;
    score?: number | null;
    feedback?: string | null;
    duration_seconds?: number | null;
  }): ExerciseAttemptDto {
    const date = row.completed_at || row.created_at || '';
    return {
      id: row.attempt_id,
      date: date || undefined,
      dateLabel: date ? this.formatDateLabel(date) : undefined,
      score: row.score ?? undefined,
      feedback: row.feedback ?? undefined,
      durationSeconds: row.duration_seconds ?? undefined,
    };
  }

  private formatDateLabel(isoDate: string): string {
    const d = new Date(isoDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dateOnly.getTime() === today.getTime()) return 'Heute';
    if (dateOnly.getTime() === yesterday.getTime()) return 'Gestern';
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
