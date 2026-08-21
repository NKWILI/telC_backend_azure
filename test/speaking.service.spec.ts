import { NotFoundException } from '@nestjs/common';
import { SpeakingService } from '../src/modules/speaking/services/speaking.service';

describe('SpeakingService', () => {
  const prisma = {
    modelltest: { findUnique: jest.fn() },
    speakingExercise: { findMany: jest.fn() },
    examSession: { findMany: jest.fn() },
  };
  let service: SpeakingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SpeakingService(prisma as any);
    prisma.modelltest.findUnique.mockResolvedValue({ id: 'mt-1' });
    prisma.speakingExercise.findMany.mockResolvedValue([
      {
        part: 1,
        title: 'Teil 1',
        subtitle: 'Subtitle',
        topic_title: 'Topic',
        topic_description: 'Description',
        topic_points: ['A', 'B'],
        instructions: 'Instructions',
        duration_minutes: 10,
        prep_duration_seconds: 300,
        image_url: 'image',
        exam_image_url: null,
      },
    ]);
  });

  it('selects and maps speaking content by Modelltest', async () => {
    const result = await service.getTeils(2);
    expect(prisma.modelltest.findUnique).toHaveBeenCalledWith({
      where: { number: 2 },
      select: { id: true },
    });
    expect(prisma.speakingExercise.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { modelltest_id: 'mt-1' } }),
    );
    expect(result[0]).toMatchObject({
      id: 1,
      part: 1,
      topicTitle: 'Topic',
      topicPoints: ['A', 'B'],
      imagePath: 'image',
    });
  });

  it('returns 404 for an invalid Modelltest', async () => {
    prisma.modelltest.findUnique.mockResolvedValue(null);
    await expect(service.getTeils(99)).rejects.toThrow(NotFoundException);
  });

  it('maps session history without changing examiner behavior', async () => {
    prisma.examSession.findMany.mockResolvedValue([
      {
        session_id: 'session-1',
        teil_number: 1,
        completed_at: new Date('2026-01-01T10:00:00Z'),
        teil_evaluations: [
          {
            overall_score: 78,
            strengths: 'Gut',
            areas_for_improvement: 'Grammatik',
          },
        ],
      },
    ]);
    expect((await service.getSessions('student-1'))[0]).toMatchObject({
      sessionId: 'session-1',
      overallScore: 78,
    });
  });
});
