import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';
import type { ListeningExerciseDto } from './dto/listening-exercise.dto';
import type { SubmitListeningDto } from './dto/submit-listening.dto';
import type { SubmitListeningResponseDto } from './dto/submit-listening-response.dto';

const TEIL_IDS = ['1', '2', '3'];

@Injectable()
export class ListeningService {
  private readonly logger = new Logger(ListeningService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getTeils(
    studentId: string,
    modelltestNumber = 1,
  ): Promise<ExerciseTypeDto[]> {
    const modelltest = await this.getModelltest(modelltestNumber);
    const [exercises, progress] = await Promise.all([
      this.prisma.listeningExercise.findMany({
        where: { modelltest_id: modelltest.id },
        orderBy: { part: 'asc' },
        select: {
          part: true,
          title: true,
          subtitle: true,
          instruction: true,
          image_url: true,
          duration_minutes: true,
        },
      }),
      this.getProgressByExercise(studentId, modelltest.id),
    ]);
    return exercises.map((exercise) => ({
      id: String(exercise.part),
      title: exercise.title,
      subtitle: exercise.subtitle ?? '',
      prompt: exercise.instruction,
      imagePath: exercise.image_url,
      part: exercise.part,
      durationMinutes: exercise.duration_minutes,
      progress: progress[String(exercise.part)] ?? 0,
    }));
  }

  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<ExerciseAttemptDto[]> {
    try {
      const exerciseId =
        teilNumber !== undefined && TEIL_IDS.includes(String(teilNumber))
          ? String(teilNumber)
          : undefined;
      const rows = await this.prisma.listeningAttempt.findMany({
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
        },
      });
      return rows.map((row) => this.mapRowToAttemptDto(row));
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  async getExercise(
    type: string,
    modelltestNumber = 1,
  ): Promise<ListeningExerciseDto> {
    const part = this.parsePart(type);
    const exercise = await this.prisma.listeningExercise.findFirst({
      where: { modelltest: { number: modelltestNumber }, part },
      select: {
        content_revision: true,
        audio_url: true,
        bundled_audio_asset: true,
        image_url: true,
        questions: {
          orderBy: { sort_order: 'asc' },
          select: { question_number: true, prompt: true },
        },
      },
    });
    if (!exercise) this.throwExerciseNotFound();
    return {
      content_revision: exercise.content_revision,
      issued_at: new Date().toISOString(),
      audio_url: exercise.audio_url,
      bundled_audio_asset: exercise.bundled_audio_asset,
      imagePath: exercise.image_url,
      questions: exercise.questions.map((question) => ({
        id: `q${question.question_number}`,
        prompt: question.prompt,
      })),
    };
  }

  async submit(
    studentId: string,
    dto: SubmitListeningDto,
  ): Promise<SubmitListeningResponseDto> {
    const part = this.parsePart(dto.type, true);
    const exercise = await this.prisma.listeningExercise.findFirst({
      where: { modelltest: { number: dto.modelltestNumber ?? 1 }, part },
      include: { questions: { orderBy: { sort_order: 'asc' } } },
    });
    if (!exercise) this.throwUnknownType();
    if (dto.content_revision !== exercise.content_revision) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Content revision mismatch — please reload the exercise',
        messageKey: 'listeningStaleRevision',
      });
    }
    if (!dto.answers || Object.keys(dto.answers).length === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Answers must not be empty',
        messageKey: 'listeningEmptyAnswers',
      });
    }
    const answerKey = Object.fromEntries(
      exercise.questions.map((question) => [
        `q${question.question_number}`,
        question.correct_answer,
      ]),
    );
    this.validateAnswers(dto.answers, answerKey);
    const score = this.computeScore(dto.answers, answerKey);
    await this.prisma.listeningAttempt.create({
      data: {
        student_id: studentId,
        exercise_id: dto.type,
        listening_exercise_id: exercise.id,
        status: 'completed',
        score,
        timed: dto.timed,
        content_revision: dto.content_revision,
        modelltest_id: exercise.modelltest_id,
        completed_at: new Date(),
      },
    });
    return { score, answerKey };
  }

  private async getModelltest(number: number): Promise<{ id: string }> {
    const modelltest = await this.prisma.modelltest.findUnique({
      where: { number },
      select: { id: true },
    });
    if (!modelltest)
      throw new NotFoundException(`Modelltest ${number} not found`);
    return modelltest;
  }

  private parsePart(type: string, submission = false): number {
    if (!TEIL_IDS.includes(type)) {
      if (submission) this.throwUnknownType();
      this.throwExerciseNotFound();
    }
    return Number(type);
  }

  private throwExerciseNotFound(): never {
    throw new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      message: 'Exercise type not found',
      messageKey: 'listeningExerciseNotFound',
    });
  }

  private throwUnknownType(): never {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Unknown exercise type',
      messageKey: 'listeningUnknownType',
    });
  }

  private validateAnswers(
    answers: Record<string, string>,
    answerKey: Record<string, string>,
  ): void {
    if (Object.keys(answers).some((id) => !(id in answerKey)))
      throw new UnprocessableEntityException('Unknown listening question');
    if (
      Object.values(answers).some((answer) => answer !== '+' && answer !== '-')
    )
      throw new UnprocessableEntityException(
        'Listening answers must be + or -',
      );
  }

  private computeScore(
    answers: Record<string, string>,
    answerKey: Record<string, string>,
  ): number {
    const total = Object.keys(answerKey).length;
    if (total === 0) return 0;
    const correct = Object.entries(answerKey).filter(
      ([id, answer]) => answers[id] === answer,
    ).length;
    return Math.round((correct / total) * 100);
  }

  private async getProgressByExercise(
    studentId: string,
    modelltestId: string,
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = Object.fromEntries(
      TEIL_IDS.map((id) => [id, 0]),
    );
    try {
      const rows = await this.prisma.listeningAttempt.findMany({
        where: {
          student_id: studentId,
          status: 'completed',
          modelltest_id: modelltestId,
        },
        select: { exercise_id: true },
      });
      for (const row of rows)
        if (TEIL_IDS.includes(row.exercise_id)) result[row.exercise_id] = 100;
    } catch {
      /* Progress failure must not hide exam content. */
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
    const toIso = (date: Date | string | null | undefined) =>
      date ? (date instanceof Date ? date.toISOString() : date) : '';
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
    const date = new Date(isoDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateOnly = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    if (dateOnly.getTime() === today.getTime()) return 'Heute';
    if (dateOnly.getTime() === yesterday.getTime()) return 'Gestern';
    return date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}
