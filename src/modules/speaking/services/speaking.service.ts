import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/services/prisma.service';
import type { SessionHistoryItemDto, TeilListItemDto } from '../dto';
import {
  historyFields,
  teilStats,
} from '../../student-activity/student-history';

@Injectable()
export class SpeakingService {
  private readonly logger = new Logger(SpeakingService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getTeils(
    modelltestNumber = 1,
    studentId?: string,
  ): Promise<TeilListItemDto[]> {
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
    const stats = studentId
      ? await teilStats(
          this.prisma,
          studentId,
          'SPRECHEN',
          exercises.map((exercise) => exercise.part),
          modelltest.id,
        )
      : {};
    return exercises.map((exercise) => ({
      ...stats[exercise.part],
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
    // Read from the evaluations `evaluate` keeps (phase 11). The old source,
    // exam_sessions, was written only by the live Gemini flow, which stopped
    // in March 2026 and never stored a score.
    try {
      const rows = await this.prisma.speakingAttempt.findMany({
        where: {
          student_id: studentId,
          ...(teilNumber !== undefined && teilNumber >= 1 && teilNumber <= 3
            ? { teil_number: teilNumber }
            : {}),
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          attempt_id: true,
          teil_number: true,
          modelltest_id: true,
          score: true,
          evaluation: true,
          duration_seconds: true,
          created_at: true,
        },
      });
      return rows.map((row) => {
        const evaluation = (row.evaluation ?? {}) as {
          strengths?: string;
          areas_for_improvement?: string;
        };
        return {
          ...historyFields('SPRECHEN', {
            attemptId: row.attempt_id,
            teil: row.teil_number,
            score: row.score,
            completedAt: row.created_at,
            durationSeconds: row.duration_seconds,
            modelltestId: row.modelltest_id,
          }),
          sessionId: row.attempt_id,
          teilNumber: row.teil_number,
          completedAt: row.created_at.toISOString(),
          overallScore: row.score,
          strengths: evaluation.strengths ?? null,
          areasForImprovement: evaluation.areas_for_improvement ?? null,
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
