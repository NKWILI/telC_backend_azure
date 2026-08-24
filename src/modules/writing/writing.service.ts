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
  ExerciseAttemptDto,
  SubmitWritingResponseDto,
  WritingExerciseDto,
  WritingExerciseStimulus,
} from './dto';
import type { SubmitWritingDto } from './dto';

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
   * GET /api/writing/exercise/:id — fetch full exercise content from DB.
   */
  async getExercise(id: string): Promise<WritingExerciseDto> {
    let row: Awaited<ReturnType<typeof this.prisma.writingExercise.findUnique>>;
    try {
      row = await this.prisma.writingExercise.findUnique({ where: { id } });
    } catch {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise not found',
        messageKey: 'writingExerciseNotFound',
      });
    }
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise not found',
        messageKey: 'writingExerciseNotFound',
      });
    }
    return this.mapExerciseRow(row);
  }

  /**
   * GET /api/writing/exercise?modelltest=1 — fetch exercise by modelltest number.
   */
  async getExerciseByModelltest(
    modelltestNumber: number,
  ): Promise<WritingExerciseDto> {
    let row: Awaited<ReturnType<typeof this.prisma.writingExercise.findFirst>>;
    try {
      row = await this.prisma.writingExercise.findFirst({
        where: { modelltest: { number: modelltestNumber } },
      });
    } catch {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise not found for this Modelltest',
        messageKey: 'writingExerciseNotFound',
      });
    }
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise not found for this Modelltest',
        messageKey: 'writingExerciseNotFound',
      });
    }
    return this.mapExerciseRow(row);
  }

  /**
   * GET /api/writing/sessions — list past attempts, optionally filtered by exerciseId (UUID).
   */
  async getSessions(
    studentId: string,
    exerciseId?: string,
    limit = 50,
  ): Promise<ExerciseAttemptDto[]> {
    try {
      const rows = await this.prisma.writingAttempt.findMany({
        where: {
          student_id: studentId,
          ...(exerciseId ? { exercise_id: exerciseId } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          attempt_id: true,
          created_at: true,
          completed_at: true,
          score: true,
          feedback: true,
          duration_seconds: true,
          content: true,
          corrected_text: true,
          diff: true,
          corrections: true,
          points_addressed: true,
        },
      });

      return rows.map((row) => this.mapRowToAttemptDto(row));
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * POST /api/writing/submit — validate exercise exists in DB, create attempt, enqueue correction.
   */
  async submit(
    studentId: string,
    dto: SubmitWritingDto,
  ): Promise<SubmitWritingResponseDto> {
    const { exerciseId, content } = dto;

    let exercise: { id: string; modelltest_id: string | null } | null;
    try {
      exercise = await this.prisma.writingExercise.findUnique({
        where: { id: exerciseId },
        select: { id: true, modelltest_id: true },
      });
    } catch {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise type not found',
        messageKey: 'writingExerciseNotFound',
      });
    }

    if (!exercise) {
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
          modelltest_id: exercise.modelltest_id ?? undefined,
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

  mapExerciseRow(row: {
    id: string;
    title: string;
    subtitle: string | null;
    task_type: string;
    intro: string | null;
    stimulus: unknown;
    task_instructions: string;
    bullet_points: string[];
    closing_reminder: string | null;
  }): WritingExerciseDto {
    return {
      id: row.id,
      part: 1,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      taskType: row.task_type as 'brief' | 'forumsbeitrag',
      intro: row.intro ?? undefined,
      stimulus: row.stimulus as WritingExerciseStimulus | undefined,
      taskInstructions: row.task_instructions,
      bulletPoints: row.bullet_points,
      closingReminder: row.closing_reminder ?? undefined,
    };
  }

  private mapRowToAttemptDto(row: {
    attempt_id: string;
    created_at?: Date | string | null;
    completed_at?: Date | string | null;
    score?: number | null;
    feedback?: string | null;
    duration_seconds?: number | null;
    content?: string | null;
    corrected_text?: string | null;
    diff?: unknown;
    corrections?: unknown;
    points_addressed?: number | null;
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
      originalText: row.content ?? undefined,
      correctedText: row.corrected_text ?? undefined,
      diff: Array.isArray(row.diff)
        ? (row.diff as ExerciseAttemptDto['diff'])
        : undefined,
      pointsAddressed: row.points_addressed ?? undefined,
      corrections: this.mapCorrectionsForDto(row.corrections),
    };
  }

  private mapCorrectionsForDto(
    raw: unknown,
  ): ExerciseAttemptDto['corrections'] {
    if (!Array.isArray(raw)) return undefined;
    return raw.map((c) => {
      const item = c as Record<string, unknown>;
      return {
        original: String(item.original ?? ''),
        corrected: String(item.corrected ?? ''),
        explanation:
          typeof item.explanation === 'string' ? item.explanation : undefined,
        errorType:
          typeof item.error_type === 'string'
            ? item.error_type
            : typeof item.errorType === 'string'
              ? item.errorType
              : undefined,
      };
    });
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
