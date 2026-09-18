import { NotFoundException } from '@nestjs/common';
import { SpeakingService } from '../src/modules/speaking/services/speaking.service';

describe('SpeakingService', () => {
  const prisma = {
    modelltest: { findUnique: jest.fn() },
    speakingExercise: { findMany: jest.fn() },
    speakingAttempt: { findMany: jest.fn() },
    studentActivity: { groupBy: jest.fn(), findMany: jest.fn() },
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

  it('reads history from kept evaluations, in the old fields and the shared ones', async () => {
    prisma.speakingAttempt.findMany.mockResolvedValue([
      {
        attempt_id: 'attempt-1',
        teil_number: 1,
        score: 78,
        evaluation: { strengths: 'Gut', areas_for_improvement: 'Grammatik' },
        duration_seconds: 150,
        created_at: new Date('2026-09-01T10:00:00Z'),
      },
    ]);
    expect((await service.getSessions('student-1'))[0]).toEqual({
      sessionId: 'attempt-1',
      teilNumber: 1,
      completedAt: '2026-09-01T10:00:00.000Z',
      overallScore: 78,
      strengths: 'Gut',
      areasForImprovement: 'Grammatik',
      attemptId: 'attempt-1',
      skill: 'sprechen',
      teil: 1,
      score: 78,
      maxScore: 100,
      status: 'completed',
      durationSeconds: 150,
      modelltestId: null,
    });
  });

  it("adds the student's numbers per Teil", async () => {
    prisma.studentActivity.groupBy.mockResolvedValue([
      { teil: 1, _count: { _all: 2 }, _max: { score: 80 } },
    ]);
    prisma.studentActivity.findMany.mockResolvedValue([
      { teil: 1, score: 70, created_at: new Date('2026-09-02T10:00:00Z') },
    ]);

    const [teil1] = await service.getTeils(1, 'student-1');

    expect(teil1).toMatchObject({
      part: 1,
      attempts: 2,
      bestScore: 80,
      lastScore: 70,
    });
  });
});
