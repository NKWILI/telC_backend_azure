import { UnprocessableEntityException } from '@nestjs/common';
import { SprachbausteineService } from './sprachbausteine.service';

describe('SprachbausteineService answer security', () => {
  const teil1 = {
    content_revision: 'sb-1-v1',
    image_url: 'image',
    label: 'T1',
    instruction: 'I',
    duration_minutes: 18,
    body: 'Body',
    gaps: [
      {
        gap_key: '21',
        options: [
          { content: 'A', is_correct: false, sort_order: 0 },
          { content: 'B', is_correct: true, sort_order: 1 },
        ],
      },
    ],
  };
  const teil2 = {
    contentRevision: 'sb-2-v1',
    imageUrl: 'image2',
    label: 'T2',
    instruction: 'I',
    durationMinutes: 18,
    body: 'Body',
    words: [{ id: 'word-a', letter: 'a', content: 'Word', sortOrder: 0 }],
    gaps: [{ gapKey: '31', correctWordId: 'word-a', sortOrder: 0 }],
  };
  const prisma = {
    modelltest: { findUnique: jest.fn() },
    sprachbausteineExercise: { findFirst: jest.fn(), findUnique: jest.fn() },
    sprachbausteineTeil2Exercise: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    sprachbausteineAttempt: { create: jest.fn(), findMany: jest.fn() },
  };
  let service: SprachbausteineService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SprachbausteineService(prisma as any);
    prisma.modelltest.findUnique.mockResolvedValue({ id: 'mt-1' });
    prisma.sprachbausteineExercise.findFirst.mockResolvedValue(teil1);
    prisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(teil2);
    prisma.sprachbausteineAttempt.create.mockResolvedValue({});
    prisma.sprachbausteineAttempt.findMany.mockResolvedValue([]);
  });

  it('does not expose correct option or word IDs', async () => {
    const result = await service.getExercise(1);
    expect(JSON.stringify(result)).not.toContain('correctOptionId');
    expect(JSON.stringify(result)).not.toContain('correctWordId');
    expect(JSON.stringify(result)).not.toContain('is_correct');
  });

  it('scores and persists Teil 1 answers server-side, ignoring client score', async () => {
    prisma.sprachbausteineExercise.findUnique.mockResolvedValue(teil1);
    const result = await service.submit('student-1', {
      modelltestNumber: 1,
      teil_id: '1',
      score: 100,
      contentRevision: 'sb-1-v1',
      answers: { '21': '21a' },
    });
    expect(result).toEqual({ score: 0 });
    expect(prisma.sprachbausteineAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        score: 0,
        answers: { '21': '21a' },
        content_revision: 'sb-1-v1',
      }),
    });
  });

  it('scores Teil 2 answers server-side', async () => {
    prisma.sprachbausteineTeil2Exercise.findUnique.mockResolvedValue(teil2);
    const result = await service.submit('student-1', {
      modelltestNumber: 1,
      teil_id: '2',
      contentRevision: 'sb-2-v1',
      answers: { '31': 'wa' },
    });
    expect(result).toEqual({ score: 100 });
  });

  it('rejects unknown gap IDs and answer values outside the exercise options', async () => {
    prisma.sprachbausteineExercise.findUnique.mockResolvedValue(teil1);
    const base = {
      modelltestNumber: 1,
      teil_id: '1' as const,
      contentRevision: 'sb-1-v1',
    };

    await expect(
      service.submit('student-1', { ...base, answers: { '99': '99a' } }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.submit('student-1', { ...base, answers: { '21': '21z' } }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects the submission when attempt persistence fails', async () => {
    prisma.sprachbausteineExercise.findUnique.mockResolvedValue(teil1);
    prisma.sprachbausteineAttempt.create.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      service.submit('student-1', {
        modelltestNumber: 1,
        teil_id: '1',
        contentRevision: 'sb-1-v1',
        answers: { '21': '21b' },
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('maps history rows and filters them by Teil', async () => {
    prisma.sprachbausteineAttempt.findMany.mockResolvedValue([
      {
        attempt_id: 'attempt-1',
        created_at: new Date('2026-08-20T10:00:00.000Z'),
        completed_at: null,
        score: 60,
        feedback: null,
        duration_seconds: 120,
      },
    ]);

    const result = await service.getSessions('student-1', 1);

    expect(result[0]).toMatchObject({
      id: 'attempt-1',
      date: '2026-08-20T10:00:00.000Z',
      score: 60,
      durationSeconds: 120,
    });
    expect(prisma.sprachbausteineAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { student_id: 'student-1', teil_id: '1' },
      }),
    );
  });

  it('derives per-Teil progress and degrades to zero on history failure', async () => {
    prisma.sprachbausteineAttempt.findMany.mockResolvedValue([
      { teil_id: '2' },
    ]);
    await expect(service.getTeils('student-1')).resolves.toEqual([
      expect.objectContaining({ id: '1', progress: 0 }),
      expect.objectContaining({ id: '2', progress: 100 }),
    ]);

    prisma.sprachbausteineAttempt.findMany.mockRejectedValue(
      new Error('offline'),
    );
    const fallback = await service.getTeils('student-1');
    expect(fallback.map((teil) => teil.progress)).toEqual([0, 0]);
  });
});
