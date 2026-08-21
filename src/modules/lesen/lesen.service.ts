import { Injectable, NotFoundException, Logger } from '@nestjs/common';
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

    const correctMatches: Record<string, string> = {};
    const texts = exercise.texts.map((t) => {
      correctMatches[String(t.textNumber)] = t.correctTitleId;
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
      correctMatches,
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
      const correct = q.options.find((o) => o.isCorrect);
      const correctOptionId = correct
        ? `${q.questionNumber}${LETTERS[correct.sortOrder]}`
        : '';
      return {
        id: String(q.questionNumber),
        content: q.prompt,
        options,
        correctOptionId,
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

    const correctMatches: Record<string, string> = {};
    const situations = exercise.situations.map((s) => {
      correctMatches[String(s.situationNumber)] = s.noMatch
        ? 'X'
        : (letterMap.get(s.correctAnnouncementId!) ?? '');
      return { id: String(s.situationNumber), content: s.content };
    });

    return {
      label: exercise.label,
      instruction: exercise.instruction,
      situations,
      announcements,
      correctMatches,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async submitTeil2(
    _dto: LesenSubmitRequestDto,
  ): Promise<LesenSubmitResponseDto> {
    return { score: 0 };
  }
}
