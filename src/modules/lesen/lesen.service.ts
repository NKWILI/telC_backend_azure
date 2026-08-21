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

const LETTERS = ['a', 'b', 'c'];

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

  async submit(dto: LesenSubmitRequestDto): Promise<LesenSubmitResponseDto> {
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
    return {
      score:
        answerKey && Object.keys(answerKey).length
          ? Math.round((correct / Object.keys(answerKey).length) * 100)
          : 0,
    };
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
