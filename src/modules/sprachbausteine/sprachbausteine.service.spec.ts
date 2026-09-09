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

  // This test used to assert the opposite: that getExercise() leaked no correct
  // answers. 7678440 introduced it; this reverses it deliberately. Kept on the
  // same surface rather than deleted so that whoever changes this next has to
  // confront the decision instead of rediscovering it. Reasoning and its cost:
  // docs/adr/0001-answer-key-with-exercise.md.
  it('exposes the correct option and word ids with the exercise', async () => {
    const result = await service.getExercise(1);
    expect(result.teil1.gaps[0].correctOptionId).toBe('21b');
    expect(result.teil2.gaps[0].correctWordId).toBe('wa');
  });

  it('never leaks raw database column names', async () => {
    const result = await service.getExercise(1);
    // The answers are public now; the schema is not. is_correct/correct_word_id
    // appearing here would mean a Prisma row was spread into the response
    // wholesale rather than projected field by field.
    expect(JSON.stringify(result)).not.toContain('is_correct');
    expect(JSON.stringify(result)).not.toContain('correct_word_id');
    expect(JSON.stringify(result)).not.toContain('sort_order');
  });

  it('serves the same key that submit scores against', async () => {
    // Two producers now compute the answer key: getExercise() projects it and
    // getAnswerKey() scores against it. This is the test that stops them drifting.
    prisma.sprachbausteineExercise.findUnique.mockResolvedValue(teil1);
    prisma.sprachbausteineTeil2Exercise.findUnique.mockResolvedValue(teil2);
    const exercise = await service.getExercise(1);

    const teil1Result = await service.submit('student-1', {
      modelltestNumber: 1,
      teil_id: '1',
      contentRevision: 'sb-1-v1',
      answers: { '21': exercise.teil1.gaps[0].correctOptionId },
    });
    expect(teil1Result.score).toBe(100);

    const teil2Result = await service.submit('student-1', {
      modelltestNumber: 1,
      teil_id: '2',
      contentRevision: 'sb-2-v1',
      answers: { '31': exercise.teil2.gaps[0].correctWordId },
    });
    expect(teil2Result.score).toBe(100);
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
    // Asserts the score specifically, not the whole response: this test exists
    // to prove the client's score: 100 was ignored, and should not fail merely
    // because the response gained a field.
    expect(result.score).toBe(0);
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
    expect(result.score).toBe(100);
  });

  it('returns the Teil 1 answer key with the score, so the client can correct', async () => {
    // The exercise response deliberately withholds the answers (see the first
    // test). Releasing them here instead is what lets a student see WHICH gaps
    // were wrong, without ever letting them see it before they answer.
    prisma.sprachbausteineExercise.findUnique.mockResolvedValue(teil1);

    const result = await service.submit('student-1', {
      modelltestNumber: 1,
      teil_id: '1',
      contentRevision: 'sb-1-v1',
      answers: { '21': '21a' },
    });

    // Same encoding the client submits, so it can compare directly.
    expect(result.answerKey).toEqual({ '21': '21b' });
  });

  it('returns the Teil 2 answer key with the score', async () => {
    prisma.sprachbausteineTeil2Exercise.findUnique.mockResolvedValue(teil2);

    const result = await service.submit('student-1', {
      modelltestNumber: 1,
      teil_id: '2',
      contentRevision: 'sb-2-v1',
      answers: { '31': 'wa' },
    });

    expect(result.answerKey).toEqual({ '31': 'wa' });
  });

  it('releases the answer key only after the attempt is recorded', async () => {
    // Ordering matters: if the key were returned on a submission that failed to
    // persist, a client could harvest answers by submitting and discarding the
    // error, which is the exposure the exercise endpoint was hardened against.
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
