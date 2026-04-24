import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { LesenExerciseResponseDto, LesenTeil1Dto, LesenTeil2QuestionDto, LesenTeil3Dto, LesenSubmitResponseDto } from './dto';
import type { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';

const LETTERS = ['a', 'b', 'c'];

@Injectable()
export class LesenService {
  private readonly logger = new Logger(LesenService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getTeil1Exercise(): Promise<LesenTeil1Dto> {
    const exercise = await this.prisma.lesenTeil1Exercise.findFirst({
      include: {
        texts:  { orderBy: { sortOrder: 'asc' } },
        titles: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!exercise) {
      throw new NotFoundException('No Lesen Teil 1 exercise found');
    }

    const correctMatches: Record<string, string> = {};
    const texts = exercise.texts.map((t) => {
      correctMatches[String(t.textNumber)] = t.correctTitleId;
      return { id: String(t.textNumber), von: t.von, an: t.an, body: t.body };
    });

    const titles = exercise.titles.map((t) => ({ id: t.id, content: t.content }));

    return {
      label: exercise.label,
      instruction: exercise.instruction,
      texts,
      titles,
      correctMatches,
    };
  }

  async getTeil2Exercise(): Promise<Omit<LesenExerciseResponseDto, 'teil1' | 'teil3'>> {
    const exercise = await this.prisma.lesenTeil2Exercise.findFirst({
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
      throw new NotFoundException('No Lesen Teil 2 exercise found');
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

  async getTeil3Exercise(): Promise<LesenTeil3Dto> {
    const exercise = await this.prisma.lesenTeil3Exercise.findFirst({
      include: {
        announcements: { orderBy: { sortOrder: 'asc' } },
        situations:    { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!exercise) {
      throw new NotFoundException('No Lesen Teil 3 exercise found');
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async submitTeil2(_dto: LesenSubmitRequestDto): Promise<LesenSubmitResponseDto> {
    return { score: 0 };
  }
}
