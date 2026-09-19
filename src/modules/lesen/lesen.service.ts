import {
  Injectable,
  NotFoundException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type {
  LesenExerciseResponseDto,
  LesenTeil1Dto,
  LesenTeil2QuestionDto,
  LesenTeil3Dto,
  LesenSubmitResponseDto,
} from './dto';
import type { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';
import { recordActivity } from '../student-activity/student-activity.writer';
import { submitOnce } from '../student-activity/submit-once';
import { historyFields, teilStats } from '../student-activity/student-history';
import type { ExerciseAttemptDto } from '../writing/dto/exercise-attempt.dto';
import type { ExerciseTypeDto } from '../writing/dto/exercise-type.dto';

const LETTERS = ['a', 'b', 'c'];

const TEIL_IDS = ['1', '2', '3'];

const TEIL_CATALOG: Record<string, Omit<ExerciseTypeDto, 'progress'>> = {
  '1': {
    id: '1',
    title: 'Teil 1',
    subtitle: 'Globalverstehen',
    prompt: 'Ordnen Sie jedem Text die passende Überschrift zu.',
    part: 1,
  },
  '2': {
    id: '2',
    title: 'Teil 2',
    subtitle: 'Detailverstehen',
    prompt: 'Wählen Sie für jede Aufgabe die richtige Antwort.',
    part: 2,
  },
  '3': {
    id: '3',
    title: 'Teil 3',
    subtitle: 'Selektives Verstehen',
    prompt: 'Ordnen Sie jeder Situation die passende Anzeige zu.',
    part: 3,
  },
};

@Injectable()
export class LesenService {
  private readonly logger = new Logger(LesenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the Modelltest once, then fetch all three Teils scoped to it.
   *
   * Every Teil query must filter on modelltest_id. Without it, `findFirst`
   * returns an unordered row and the three Teils can come from different
   * Modelltests — a mixed exam scored against the wrong answer key.
   */
  async getExercise(modelltestNumber = 1): Promise<LesenExerciseResponseDto> {
    const modelltest = await this.prisma.modelltest.findUnique({
      where: { number: modelltestNumber },
    });

    if (!modelltest) {
      throw new NotFoundException(`Modelltest ${modelltestNumber} not found`);
    }

    const [teil1, teil2Result, teil3] = await Promise.all([
      this.getTeil1Exercise(modelltest.id),
      this.getTeil2Exercise(modelltest.id),
      this.getTeil3Exercise(modelltest.id),
    ]);

    return {
      contentRevision: teil2Result.contentRevision,
      issuedAt: teil2Result.issuedAt,
      teil1,
      teil2: teil2Result.teil2,
      teil3,
    };
  }

  async getTeil1Exercise(modelltestId: string): Promise<LesenTeil1Dto> {
    const exercise = await this.prisma.lesenTeil1Exercise.findFirst({
      where: { modelltest_id: modelltestId },
      // Deterministic pick if a Modelltest ever ends up with two rows for the
      // same Teil. A unique constraint on modelltest_id would make this
      // unnecessary, but nothing enforces one yet.
      orderBy: { createdAt: 'asc' },
      include: {
        texts: { orderBy: { sortOrder: 'asc' } },
        titles: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!exercise) {
      throw new NotFoundException(
        `No Lesen Teil 1 exercise found for Modelltest with id ${modelltestId}`,
      );
    }

    const texts = exercise.texts.map((t) => {
      return { id: String(t.textNumber), von: t.von, an: t.an, body: t.body };
    });

    const titles = exercise.titles.map((t) => ({
      id: t.id,
      content: t.content,
    }));

    return {
      label: exercise.label,
      instruction: exercise.instruction,
      texts,
      titles,
    };
  }

  async getTeil2Exercise(
    modelltestId: string,
  ): Promise<Omit<LesenExerciseResponseDto, 'teil1' | 'teil3'>> {
    const exercise = await this.prisma.lesenTeil2Exercise.findFirst({
      where: { modelltest_id: modelltestId },
      // Deterministic pick if a Modelltest ever ends up with two rows for the
      // same Teil. A unique constraint on modelltest_id would make this
      // unnecessary, but nothing enforces one yet.
      orderBy: { createdAt: 'asc' },
      include: {
        questions: {
          orderBy: { sortOrder: 'asc' },
          include: {
            options: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });

    if (!exercise) {
      throw new NotFoundException(
        `No Lesen Teil 2 exercise found for Modelltest with id ${modelltestId}`,
      );
    }

    const questions: LesenTeil2QuestionDto[] = exercise.questions.map((q) => {
      const options = q.options.map((o) => ({
        id: `${q.questionNumber}${LETTERS[o.sortOrder]}`,
        content: o.content,
      }));
      return {
        id: String(q.questionNumber),
        content: q.prompt,
        options,
      };
    });

    return {
      contentRevision: exercise.contentRevision,
      issuedAt: new Date().toISOString(),
      teil2: {
        label: exercise.label,
        instruction: exercise.instruction,
        cautionNote: exercise.cautionNote,
        sender: exercise.topSender,
        receiver: exercise.topReceiver,
        content: exercise.topBody,
        quotedThread: exercise.quotedThread,
        questions,
      },
    };
  }

  async getTeil3Exercise(modelltestId: string): Promise<LesenTeil3Dto> {
    const exercise = await this.prisma.lesenTeil3Exercise.findFirst({
      where: { modelltest_id: modelltestId },
      // Deterministic pick if a Modelltest ever ends up with two rows for the
      // same Teil. A unique constraint on modelltest_id would make this
      // unnecessary, but nothing enforces one yet.
      orderBy: { createdAt: 'asc' },
      include: {
        announcements: { orderBy: { sortOrder: 'asc' } },
        situations: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!exercise) {
      throw new NotFoundException(
        `No Lesen Teil 3 exercise found for Modelltest with id ${modelltestId}`,
      );
    }

    const letterMap = new Map<string, string>();
    const announcements = exercise.announcements.map((a) => {
      const letter = String.fromCharCode(97 + a.sortOrder);
      letterMap.set(a.id, letter);
      return { id: letter, title: a.title, content: a.content };
    });

    const situations = exercise.situations.map((s) => {
      return { id: String(s.situationNumber), content: s.content };
    });

    return {
      label: exercise.label,
      instruction: exercise.instruction,
      situations,
      announcements,
    };
  }

  /**
   * Scores a Teil and, for a student, stores it (phase 11: Lesen used to score
   * and forget). A guest is scored and nothing is kept, as before.
   */
  async submit(
    caller: { studentId: string; isGuest?: boolean },
    dto: LesenSubmitRequestDto,
  ): Promise<LesenSubmitResponseDto> {
    const modelltest = await this.prisma.modelltest.findUnique({
      where: { number: dto.modelltestNumber ?? 1 },
      select: { id: true },
    });
    if (!modelltest) throw new NotFoundException('Modelltest not found');

    const submissionRules = await this.getSubmissionRules(
      modelltest.id,
      dto.teil_id,
    );
    this.validateAnswers(dto.answers, submissionRules.allowedAnswers);
    const answerKey = submissionRules.answerKey;
    const correct = Object.entries(answerKey).filter(
      ([id, answer]) => dto.answers[id] === answer,
    ).length;
    const score =
      answerKey && Object.keys(answerKey).length
        ? Math.round((correct / Object.keys(answerKey).length) * 100)
        : 0;

    if (caller.isGuest) return { score };

    const { studentId } = caller;
    const completedAt = new Date();
    const { attemptId, earlier } = await submitOnce(
      studentId,
      dto.attemptId,
      (id) =>
        this.prisma.lesenAttempt.findUnique({
          where: { attempt_id: id },
          select: { student_id: true, score: true },
        }),
      (id) =>
        this.prisma.$transaction(async (tx) => {
          await tx.lesenAttempt.create({
            data: {
              attempt_id: id,
              student_id: studentId,
              teil_id: dto.teil_id,
              modelltest_id: modelltest.id,
              score,
              answers: dto.answers,
              duration_seconds: dto.durationSeconds ?? null,
              created_at: completedAt,
            },
          });
          await recordActivity(tx, {
            studentId,
            skill: 'LESEN',
            teil: Number(dto.teil_id),
            score,
            durationSeconds: dto.durationSeconds,
            modelltestId: modelltest.id,
            attemptId: id,
            completedAt,
          });
        }),
    );
    return { attemptId, score: earlier?.score ?? score };
  }

  /**
   * GET /api/reading/teils — the three Teils with the student's numbers, in
   * the shape every module's `/teils` has (D29). `progress` is 100 once a
   * Teil has been completed, as in the other modules.
   */
  async getTeils(studentId: string): Promise<ExerciseTypeDto[]> {
    const stats = await teilStats(
      this.prisma,
      studentId,
      'LESEN',
      TEIL_IDS.map(Number),
    );
    return TEIL_IDS.map((id) => ({
      ...stats[Number(id)],
      ...TEIL_CATALOG[id],
      progress: stats[Number(id)].attempts > 0 ? 100 : 0,
    }));
  }

  /** GET /api/reading/sessions — the student's scored Teils, newest first. */
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
      const rows = await this.prisma.lesenAttempt.findMany({
        where: {
          student_id: studentId,
          erasure_id: null,
          ...(teilId ? { teil_id: teilId } : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          attempt_id: true,
          teil_id: true,
          modelltest_id: true,
          score: true,
          duration_seconds: true,
          created_at: true,
        },
      });
      return rows.map((row) => ({
        ...historyFields('LESEN', {
          attemptId: row.attempt_id,
          teil: Number(row.teil_id),
          score: row.score,
          completedAt: row.created_at,
          durationSeconds: row.duration_seconds,
          modelltestId: row.modelltest_id,
        }),
        id: row.attempt_id,
        date: row.created_at.toISOString(),
        dateLabel: formatDateLabel(row.created_at),
        score: row.score,
        durationSeconds: row.duration_seconds ?? undefined,
      }));
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  private async getSubmissionRules(
    modelltestId: string,
    teilId: string,
  ): Promise<{
    answerKey: Record<string, string>;
    allowedAnswers: Record<string, string[]>;
  }> {
    if (teilId === '1') {
      const exercise = await this.prisma.lesenTeil1Exercise.findUnique({
        where: { modelltest_id: modelltestId },
        select: { texts: true, titles: { select: { id: true } } },
      });
      if (!exercise) throw new NotFoundException('Lesen Teil 1 not found');
      const titleIds = exercise.titles.map((title) => title.id);
      return {
        answerKey: Object.fromEntries(
          exercise.texts.map((text) => [
            String(text.textNumber),
            text.correctTitleId,
          ]),
        ),
        allowedAnswers: Object.fromEntries(
          exercise.texts.map((text) => [String(text.textNumber), titleIds]),
        ),
      };
    }
    if (teilId === '2') {
      const exercise = await this.prisma.lesenTeil2Exercise.findUnique({
        where: { modelltest_id: modelltestId },
        select: { questions: { include: { options: true } } },
      });
      if (!exercise) throw new NotFoundException('Lesen Teil 2 not found');
      return {
        answerKey: Object.fromEntries(
          exercise.questions.map((question) => {
            const correct = question.options.find((option) => option.isCorrect);
            return [
              String(question.questionNumber),
              correct
                ? `${question.questionNumber}${LETTERS[correct.sortOrder]}`
                : '',
            ];
          }),
        ),
        allowedAnswers: Object.fromEntries(
          exercise.questions.map((question) => [
            String(question.questionNumber),
            question.options.map(
              (option) =>
                `${question.questionNumber}${LETTERS[option.sortOrder]}`,
            ),
          ]),
        ),
      };
    }
    if (teilId === '3') {
      const exercise = await this.prisma.lesenTeil3Exercise.findUnique({
        where: { modelltest_id: modelltestId },
        select: { announcements: true, situations: true },
      });
      if (!exercise) throw new NotFoundException('Lesen Teil 3 not found');
      const letters = new Map(
        exercise.announcements.map((item) => [
          item.id,
          String.fromCharCode(97 + item.sortOrder),
        ]),
      );
      const allowed = [...letters.values(), 'X'];
      return {
        answerKey: Object.fromEntries(
          exercise.situations.map((situation) => [
            String(situation.situationNumber),
            situation.noMatch
              ? 'X'
              : (letters.get(situation.correctAnnouncementId ?? '') ?? ''),
          ]),
        ),
        allowedAnswers: Object.fromEntries(
          exercise.situations.map((situation) => [
            String(situation.situationNumber),
            allowed,
          ]),
        ),
      };
    }
    throw new NotFoundException('Lesen Teil not found');
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
        throw new UnprocessableEntityException(`Unknown Lesen question: ${id}`);
      }
      if (!allowedAnswers[id].includes(answer)) {
        throw new UnprocessableEntityException(
          `Invalid answer for Lesen question: ${id}`,
        );
      }
    }
  }
}

/** Heute / Gestern / dd.mm.yyyy, as the other modules label a date. */
function formatDateLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (day.getTime() === today.getTime()) return 'Heute';
  if (day.getTime() === yesterday.getTime()) return 'Gestern';
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
