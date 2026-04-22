import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { LesenExerciseResponseDto, LesenTeil2QuestionDto, LesenSubmitResponseDto } from './dto';
import type { LesenSubmitRequestDto } from './dto/lesen-submit-request.dto';

const LETTERS = ['a', 'b', 'c'];

@Injectable()
export class LesenService {
  private readonly logger = new Logger(LesenService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getTeil2Exercise(): Promise<LesenExerciseResponseDto> {
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
        thread: {
          topSender: exercise.topSender,
          topReceiver: exercise.topReceiver,
          topBody: exercise.topBody,
          quotedThread: exercise.quotedThread,
        },
        questions,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async submitTeil2(_dto: LesenSubmitRequestDto): Promise<LesenSubmitResponseDto> {
    return { score: 0 };
  }
}
