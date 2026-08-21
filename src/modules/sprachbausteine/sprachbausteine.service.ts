import {
  Injectable,
  NotFoundException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type {
  SprachbausteineExerciseResponseDto,
  SprachbausteineGapDto,
  SprachbausteineTeil2Dto,
  SubmitSprachbausteineResponseDto,
} from './dto';
import type { SubmitSprachbausteineDto } from './dto/submit-sprachbausteine.dto';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';

const TEIL_IDS = ['1', '2'];

const TEIL_CATALOG: Record<string, Omit<ExerciseTypeDto, 'progress'>> = {
  '1': {
    id: '1',
    title: 'Teil 1',
    subtitle: 'Lückentext mit Mehrfachauswahl',
    prompt: 'Wählen Sie für jede Lücke die passende Antwort.',
    part: 1,
    durationMinutes: 18,
  },
  '2': {
    id: '2',
    title: 'Teil 2',
    subtitle: 'Wortbank-Lückentext',
    prompt: 'Ordnen Sie jeder Lücke das passende Wort aus dem Wortbank zu.',
    part: 2,
    durationMinutes: 18,
  },
};

@Injectable()
export class SprachbausteineService {
  private readonly logger = new Logger(SprachbausteineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getExercise(
    modelltestNumber = 1,
  ): Promise<SprachbausteineExerciseResponseDto> {
    const modelltest = await this.prisma.modelltest.findUnique({
      where: { number: modelltestNumber },
    });
    if (!modelltest) {
      throw new NotFoundException(`Modelltest ${modelltestNumber} not found`);
    }

    const [exercise, teil2] = await Promise.all([
      this.prisma.sprachbausteineExercise.findFirst({
        where: { modelltest_id: modelltest.id },
        include: {
          gaps: {
            orderBy: { sort_order: 'asc' },
            include: {
              options: { orderBy: { sort_order: 'asc' } },
            },
          },
        },
      }),
      this.getTeil2Exercise(modelltest.id),
    ]);

    if (!exercise) {
      throw new NotFoundException(
        `No Sprachbausteine exercise found for Modelltest ${modelltestNumber}`,
      );
    }

    const letters = ['a', 'b', 'c'];
    const gaps: SprachbausteineGapDto[] = exercise.gaps.map((gap) => {
      const options = gap.options.map((o) => ({
        id: `${gap.gap_key}${letters[o.sort_order]}`,
        content: o.content,
      }));
      return { id: gap.gap_key, options };
    });

    return {
      contentRevision: exercise.content_revision,
      issuedAt: new Date().toISOString(),
      teil1: {
        imageUrl: exercise.image_url,
        label: exercise.label ?? '',
        instruction: exercise.instruction,
        durationMinutes: exercise.duration_minutes,
        body: exercise.body,
        gaps,
      },
      teil2,
    };
  }

  private async getTeil2Exercise(
    modelltestId: string,
  ): Promise<SprachbausteineTeil2Dto> {
    const exercise = await this.prisma.sprachbausteineTeil2Exercise.findFirst({
      where: { modelltest_id: modelltestId },
      include: {
        words: { orderBy: { sortOrder: 'asc' } },
        gaps: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!exercise) {
      throw new NotFoundException(
        `No Sprachbausteine Teil 2 exercise found for Modelltest with id ${modelltestId}`,
      );
    }

    const wordBank = exercise.words.map((w) => {
      const wordId = 'w' + String.fromCharCode(97 + w.sortOrder);
      return {
        id: wordId,
        letter: String.fromCharCode(97 + w.sortOrder),
        content: w.content,
      };
    });

    const gaps = exercise.gaps.map((g) => ({ id: g.gapKey }));

    return {
      imageUrl: exercise.imageUrl,
      label: exercise.label,
      instruction: exercise.instruction,
      durationMinutes: exercise.durationMinutes,
      body: exercise.body,
      wordBank,
      gaps,
    };
  }

  async submit(
    studentId: string,
    dto: SubmitSprachbausteineDto,
  ): Promise<SubmitSprachbausteineResponseDto> {
    const modelltest = await this.prisma.modelltest.findUnique({
      where: { number: dto.modelltestNumber },
    });
    if (!modelltest) {
      throw new NotFoundException(
        `Modelltest ${dto.modelltestNumber} not found`,
      );
    }

    const answerKey = await this.getAnswerKey(modelltest.id, dto.teil_id);
    const expectedRevision = answerKey.contentRevision;
    if (dto.contentRevision !== expectedRevision) {
      throw new NotFoundException('Content revision mismatch');
    }
    const answers = answerKey.answers;
    this.validateAnswers(dto.answers, answerKey.allowedAnswers);
    const correct = Object.entries(answers).filter(
      ([id, answer]) => dto.answers[id] === answer,
    ).length;
    const score = Object.keys(answers).length
      ? Math.round((correct / Object.keys(answers).length) * 100)
      : 0;

    await this.prisma.sprachbausteineAttempt.create({
      data: {
        student_id: studentId,
        teil_id: dto.teil_id,
        modelltest_id: modelltest.id,
        status: 'completed',
        score: score,
        answers: dto.answers,
        content_revision: dto.contentRevision,
        duration_seconds: dto.durationSeconds ?? null,
        completed_at: new Date(),
      },
    });

    return { score };
  }

  private async getAnswerKey(
    modelltestId: string,
    teilId: '1' | '2',
  ): Promise<{
    contentRevision: string;
    answers: Record<string, string>;
    allowedAnswers: Record<string, string[]>;
  }> {
    if (teilId === '1') {
      const exercise = await this.prisma.sprachbausteineExercise.findUnique({
        where: { modelltest_id: modelltestId },
        include: { gaps: { include: { options: true } } },
      });
      if (!exercise)
        throw new NotFoundException('Sprachbausteine Teil 1 not found');
      const letters = ['a', 'b', 'c'];
      return {
        contentRevision: exercise.content_revision,
        answers: Object.fromEntries(
          exercise.gaps.map((gap) => {
            const option = gap.options.find((item) => item.is_correct);
            return [
              gap.gap_key,
              option ? `${gap.gap_key}${letters[option.sort_order]}` : '',
            ];
          }),
        ),
        allowedAnswers: Object.fromEntries(
          exercise.gaps.map((gap) => [
            gap.gap_key,
            gap.options.map(
              (option) => `${gap.gap_key}${letters[option.sort_order]}`,
            ),
          ]),
        ),
      };
    }
    const exercise = await this.prisma.sprachbausteineTeil2Exercise.findUnique({
      where: { modelltest_id: modelltestId },
      include: { words: true, gaps: true },
    });
    if (!exercise)
      throw new NotFoundException('Sprachbausteine Teil 2 not found');
    const wordIds = new Map(
      exercise.words.map((word) => [
        word.id,
        `w${String.fromCharCode(97 + word.sortOrder)}`,
      ]),
    );
    return {
      contentRevision: exercise.contentRevision,
      answers: Object.fromEntries(
        exercise.gaps.map((gap) => [
          gap.gapKey,
          wordIds.get(gap.correctWordId) ?? '',
        ]),
      ),
      allowedAnswers: Object.fromEntries(
        exercise.gaps.map((gap) => [gap.gapKey, [...wordIds.values()]]),
      ),
    };
  }

  private validateAnswers(
    answers: Record<string, string>,
    allowedAnswers: Record<string, string[]>,
  ): void {
    if (Object.keys(answers).length === 0) {
      throw new UnprocessableEntityException('Answers must not be empty');
    }
    for (const [id, answer] of Object.entries(answers)) {
      if (!allowedAnswers[id]) {
        throw new UnprocessableEntityException(
          `Unknown Sprachbausteine gap: ${id}`,
        );
      }
      if (!allowedAnswers[id].includes(answer)) {
        throw new UnprocessableEntityException(
          `Invalid answer for Sprachbausteine gap: ${id}`,
        );
      }
    }
  }

  async getTeils(studentId: string): Promise<ExerciseTypeDto[]> {
    const progress = await this.getProgressByTeil(studentId);
    return TEIL_IDS.map((id) => ({
      ...TEIL_CATALOG[id],
      progress: progress[id] ?? 0,
    }));
  }

  private async getProgressByTeil(
    studentId: string,
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const id of TEIL_IDS) result[id] = 0;

    try {
      const rows = await this.prisma.sprachbausteineAttempt.findMany({
        where: { student_id: studentId, status: 'completed' },
        select: { teil_id: true },
      });

      for (const row of rows) {
        if (TEIL_IDS.includes(row.teil_id)) {
          result[row.teil_id] = 100;
        }
      }
    } catch {
      // ignore — return zeroed progress
    }
    return result;
  }

  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<ExerciseAttemptDto[]> {
    try {
      const teilId =
        teilNumber !== undefined && TEIL_IDS.includes(String(teilNumber))
          ? String(teilNumber)
          : undefined;

      const rows = await this.prisma.sprachbausteineAttempt.findMany({
        where: {
          student_id: studentId,
          ...(teilId ? { teil_id: teilId } : {}),
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
