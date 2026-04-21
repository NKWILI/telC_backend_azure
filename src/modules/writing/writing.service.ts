import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
  Optional,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
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
    private readonly prisma: PrismaService,
    @Optional()
    @Inject('WRITING_CORRECTION_QUEUE')
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
      const exerciseId =
        teilNumber !== undefined && WRITING_TEIL_IDS.includes(String(teilNumber))
          ? String(teilNumber)
          : undefined;

      const rows = await this.prisma.writingAttempt.findMany({
        where: { student_id: studentId, ...(exerciseId ? { exercise_id: exerciseId } : {}) },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: { attempt_id: true, created_at: true, completed_at: true, score: true, feedback: true, duration_seconds: true },
      });

      return rows.map((row) => this.mapRowToAttemptDto(row));
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

    if (
      !content ||
      typeof content !== 'string' ||
      content.trim().length === 0
    ) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Content must not be empty',
        messageKey: 'writingContentTooShort',
      });
    }

    const attemptId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    try {
      await this.prisma.writingAttempt.create({
        data: {
          attempt_id: attemptId,
          student_id: studentId,
          exercise_id: exerciseId,
          content: content.trim(),
          status: 'pending',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create writing attempt: ${(err as Error).message}`,
      );
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
    for (const id of WRITING_TEIL_IDS) result[id] = 0;
    try {
      const rows = await this.prisma.writingAttempt.findMany({
        where: { student_id: studentId, status: 'completed' },
        select: { exercise_id: true },
      });
      for (const row of rows) {
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
    created_at?: Date | string | null;
    completed_at?: Date | string | null;
    score?: number | null;
    feedback?: string | null;
    duration_seconds?: number | null;
  }): ExerciseAttemptDto {
    const toIso = (d: Date | string | null | undefined) =>
      d ? (d instanceof Date ? d.toISOString() : d) : '';
    const date = toIso(row.completed_at) || toIso(row.created_at);
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
