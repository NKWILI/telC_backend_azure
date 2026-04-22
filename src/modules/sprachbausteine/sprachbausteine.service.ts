import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type {
  SprachbausteineExerciseResponseDto,
  SprachbausteineGapDto,
  SubmitSprachbausteineResponseDto,
} from './dto';
import type { SubmitSprachbausteineDto } from './dto/submit-sprachbausteine.dto';

@Injectable()
export class SprachbausteineService {
  private readonly logger = new Logger(SprachbausteineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getExercise(): Promise<SprachbausteineExerciseResponseDto> {
    const exercise = await this.prisma.sprachbausteineExercise.findFirst({
      include: {
        gaps: {
          orderBy: { sort_order: 'asc' },
          include: {
            options: { orderBy: { sort_order: 'asc' } },
          },
        },
      },
    });

    if (!exercise) {
      throw new NotFoundException('No Sprachbausteine exercise found');
    }

    const gaps: SprachbausteineGapDto[] = exercise.gaps.map((gap) => {
      const correctOption = gap.options.find((o) => o.is_correct);
      return {
        id: gap.id,
        gapKey: gap.gap_key,
        options: gap.options.map((o) => ({ id: o.id, content: o.content })),
        correctOptionId: correctOption?.id ?? '',
      };
    });

    return {
      contentRevision: exercise.content_revision,
      issuedAt: new Date().toISOString(),
      teil1: {
        label: exercise.label ?? '',
        instruction: exercise.instruction,
        durationMinutes: exercise.duration_minutes,
        body: exercise.body,
        gaps,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async submit(_dto: SubmitSprachbausteineDto): Promise<SubmitSprachbausteineResponseDto> {
    return { score: 0 };
  }
}
