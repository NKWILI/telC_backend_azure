import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import type { SessionHistoryItemDto, TeilListItemDto } from '../dto';

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getTeils(modelltestNumber = 1): Promise<TeilListItemDto[]> {
    const modelltest = await this.prisma.modelltest.findUnique({
      where: { number: modelltestNumber },
      select: { id: true },
    });
    if (!modelltest)
      throw new NotFoundException(`Modelltest ${modelltestNumber} not found`);
    const exercises = await this.prisma.speakingExercise.findMany({
      where: { modelltest_id: modelltest.id },
      orderBy: { part: 'asc' },
      select: {
        part: true,
        title: true,
        subtitle: true,
        topic_title: true,
        topic_description: true,
        topic_points: true,
        instructions: true,
        duration_minutes: true,
        prep_duration_seconds: true,
        image_url: true,
        exam_image_url: true,
      },
    });
    return exercises.map((exercise) => ({
      id: exercise.part,
      part: exercise.part,
      title: exercise.title,
      subtitle: exercise.subtitle ?? '',
      topicTitle: exercise.topic_title,
      topicDescription: exercise.topic_description,
      topicPoints: this.toTopicPoints(exercise.topic_points),
      durationMinutes: exercise.duration_minutes,
      prepDurationSeconds: exercise.prep_duration_seconds,
      imagePath: exercise.image_url,
      examImagePath: exercise.exam_image_url,
      instructions: exercise.instructions,
    }));
  }

  async getSessions(
    studentId: string,
    teilNumber?: number,
    limit = 50,
  ): Promise<SessionHistoryItemDto[]> {
    try {
      const rows = await this.prisma.examSession.findMany({
        where: {
          student_id: studentId,
          status: { in: ['completed', 'interrupted'] },
          completed_at: { not: null },
          ...(teilNumber !== undefined && teilNumber >= 1 && teilNumber <= 3
            ? { teil_number: teilNumber }
            : {}),
        },
        include: {
          teil_evaluations: {
            select: {
              overall_score: true,
              strengths: true,
              areas_for_improvement: true,
            },
          },
        },
        orderBy: { completed_at: 'desc' },
        take: limit,
      });
      return rows.map((row) => {
        const evaluation = row.teil_evaluations[0];
        return {
          sessionId: row.session_id,
          teilNumber: row.teil_number,
          completedAt: (row.completed_at as Date)?.toISOString() ?? '',
          overallScore: evaluation?.overall_score ?? null,
          strengths: evaluation?.strengths ?? null,
          areasForImprovement: evaluation?.areas_for_improvement ?? null,
        };
      });
    } catch (err) {
      this.logger.error(`Error in getSessions: ${(err as Error).message}`);
      return [];
    }
  }

  private toTopicPoints(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      value.some((point) => typeof point !== 'string')
    ) {
      this.logger.warn('Speaking exercise has invalid topic_points JSON');
      return [];
    }
    return value.filter((point): point is string => typeof point === 'string');
  }
}
