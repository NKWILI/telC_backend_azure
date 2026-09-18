import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ListeningService } from '../src/modules/listening/listening.service';

const questions = [
  {
    question_number: 41,
    prompt: 'Statement 41',
    correct_answer: '-',
    sort_order: 0,
  },
  {
    question_number: 42,
    prompt: 'Statement 42',
    correct_answer: '+',
    sort_order: 1,
  },
];
const exercise = {
  id: 'exercise-1',
  modelltest_id: 'mt-1',
  part: 1,
  title: 'Teil 1',
  subtitle: 'Hörverstehen, Teil 1',
  instruction: 'Instruction',
  content_revision: 'modelltest-1-teil-1-v1',
  duration_minutes: 10,
  audio_url: '',
  bundled_audio_asset: '',
  image_url: 'https://r2.example/1.png',
  transcript: null,
  questions,
};

describe('ListeningService', () => {
  const prisma: any = {
    modelltest: { findUnique: jest.fn() },
    listeningExercise: { findMany: jest.fn(), findFirst: jest.fn() },
    listeningAttempt: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    student: {
      findUnique: jest.fn(() => Promise.resolve({ id: 'student-1' })),
    },
    studentActivity: { create: jest.fn() },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn((work: any) => work(prisma)),
  };
  let service: ListeningService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListeningService(prisma as any);
    prisma.modelltest.findUnique.mockResolvedValue({ id: 'mt-1' });
    prisma.listeningAttempt.findMany.mockResolvedValue([]);
    prisma.listeningAttempt.create.mockResolvedValue({});
    prisma.listeningAttempt.findUnique.mockResolvedValue(null);
    prisma.studentActivity.create.mockResolvedValue({});
  });

  it('retrieves Modelltest 1 Teile 1, 2, and 3 from the database', async () => {
    prisma.listeningExercise.findFirst.mockImplementation(({ where }) =>
      Promise.resolve({
        ...exercise,
        part: where.part,
        content_revision: `revision-${where.part}`,
      }),
    );
    for (const part of [1, 2, 3]) {
      const result = await service.getExercise(String(part), 1);
      expect(result.content_revision).toBe(`revision-${part}`);
    }
  });

  it('resolves different Modelltests independently', async () => {
    prisma.listeningExercise.findFirst.mockImplementation(({ where }) =>
      Promise.resolve({
        ...exercise,
        content_revision: `modelltest-${where.modelltest.number}`,
      }),
    );
    expect((await service.getExercise('1', 1)).content_revision).toBe(
      'modelltest-1',
    );
    expect((await service.getExercise('1', 2)).content_revision).toBe(
      'modelltest-2',
    );
  });

  it('returns an answer-safe exercise projection', async () => {
    prisma.listeningExercise.findFirst.mockResolvedValue(exercise);
    const result = await service.getExercise('1', 1);
    expect(result.questions).toEqual([
      { id: 'q41', prompt: 'Statement 41' },
      { id: 'q42', prompt: 'Statement 42' },
    ]);
    expect(JSON.stringify(result)).not.toContain('correct_answer');
    expect((result as any).answerKey).toBeUndefined();
  });

  it('returns 404 for an invalid Teil or missing exercise', async () => {
    await expect(service.getExercise('4', 1)).rejects.toThrow(
      NotFoundException,
    );
    prisma.listeningExercise.findFirst.mockResolvedValue(null);
    await expect(service.getExercise('1', 99)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists Modelltest-specific Teile with Modelltest-specific progress', async () => {
    prisma.listeningExercise.findMany.mockResolvedValue([exercise]);
    prisma.listeningAttempt.findMany.mockResolvedValue([{ exercise_id: '1' }]);
    const result = await service.getTeils('student-1', 1);
    expect(result[0]).toMatchObject({
      id: '1',
      progress: 100,
      imagePath: exercise.image_url,
    });
    expect(prisma.listeningAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ modelltest_id: 'mt-1' }),
      }),
    );
  });

  it('returns 404 when the requested Modelltest does not exist', async () => {
    prisma.modelltest.findUnique.mockResolvedValue(null);
    await expect(service.getTeils('student-1', 99)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('maps session rows and filters by Teil', async () => {
    prisma.listeningAttempt.findMany.mockResolvedValue([
      {
        attempt_id: 'attempt-1',
        created_at: new Date('2026-08-20T10:00:00.000Z'),
        completed_at: new Date('2026-08-20T10:05:00.000Z'),
        score: 80,
        feedback: 'Good',
        duration_seconds: 300,
      },
    ]);

    const result = await service.getSessions('student-1', 2);

    expect(result[0]).toMatchObject({
      id: 'attempt-1',
      date: '2026-08-20T10:05:00.000Z',
      score: 80,
      feedback: 'Good',
      durationSeconds: 300,
    });
    expect(prisma.listeningAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { student_id: 'student-1', exercise_id: '2' },
      }),
    );
  });

  it('returns an empty session list when history lookup fails', async () => {
    prisma.listeningAttempt.findMany.mockRejectedValue(new Error('offline'));
    await expect(service.getSessions('student-1')).resolves.toEqual([]);
  });

  it('scores submissions server-side and persists exercise identity', async () => {
    prisma.listeningExercise.findFirst.mockResolvedValue(exercise);
    const result = await service.submit('student-1', {
      type: '1',
      modelltestNumber: 1,
      timed: false,
      content_revision: exercise.content_revision,
      answers: { q41: '-', q42: '-' },
    });
    expect(result).toEqual({
      attemptId: expect.any(String),
      score: 50,
      answerKey: { q41: '-', q42: '+' },
    });
    expect(prisma.listeningAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        score: 50,
        modelltest_id: 'mt-1',
        listening_exercise_id: 'exercise-1',
      }),
    });
  });

  it('rejects the submission when attempt persistence fails', async () => {
    prisma.listeningExercise.findFirst.mockResolvedValue(exercise);
    prisma.listeningAttempt.create.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      service.submit('student-1', {
        type: '1',
        modelltestNumber: 1,
        timed: false,
        content_revision: exercise.content_revision,
        answers: { q41: '-', q42: '+' },
      }),
    ).rejects.toThrow('database unavailable');
  });

  it('rejects stale revisions, unknown questions, and invalid answer values', async () => {
    prisma.listeningExercise.findFirst.mockResolvedValue(exercise);
    const base = {
      type: '1',
      timed: false,
      content_revision: exercise.content_revision,
    };
    await expect(
      service.submit('s', {
        ...base,
        content_revision: 'old',
        answers: { q41: '-' },
      }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.submit('s', { ...base, answers: { q99: '-' } }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.submit('s', { ...base, answers: { q41: 'a' } }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("scopes each Teil's numbers to the Modelltest being listed", async () => {
    prisma.listeningExercise.findMany.mockResolvedValue([
      {
        part: 1,
        title: 'Teil 1',
        subtitle: null,
        instruction: 'I',
        image_url: null,
        duration_minutes: 10,
      },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        teil: 1,
        attempts: 2,
        best_score: 90,
        last_score: 80,
        last_at: new Date('2026-09-18T10:00:00Z'),
      },
    ]);

    const [teil1] = await service.getTeils('student-1', 2);

    expect(teil1).toMatchObject({ attempts: 2, bestScore: 90 });
    expect(JSON.stringify(prisma.$queryRaw.mock.calls[0])).toContain('mt-1');
  });

  describe('activity (D26)', () => {
    const ID = '6f1c1f5e-2b1a-4b8e-9a51-0c0de0c0de00';
    const submit = (over: Record<string, unknown> = {}) =>
      service.submit('student-1', {
        type: '2',
        modelltestNumber: 1,
        timed: false,
        content_revision: exercise.content_revision,
        answers: { q41: '-', q42: '+' },
        ...over,
      });

    beforeEach(() => {
      prisma.listeningExercise.findFirst.mockResolvedValue(exercise);
    });

    it('records the attempt as Hören activity in the same transaction', async () => {
      await submit({ durationSeconds: 300 });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const attemptId =
        prisma.listeningAttempt.create.mock.calls[0][0].data.attempt_id;
      expect(prisma.studentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          student_id: 'student-1',
          skill: 'HOEREN',
          teil: 2,
          score: 100,
          max_score: 100,
          duration_seconds: 300,
          modelltest_id: 'mt-1',
          attempt_id: attemptId,
        }),
      });
    });

    it('stores a named attempt once, answering the repeat from the first', async () => {
      prisma.listeningAttempt.findUnique.mockResolvedValue({
        student_id: 'student-1',
        score: 50,
      });

      const result = await submit({ attemptId: ID });

      expect(result.attemptId).toBe(ID);
      expect(result.score).toBe(50);
      expect(prisma.listeningAttempt.create).not.toHaveBeenCalled();
      expect(prisma.studentActivity.create).not.toHaveBeenCalled();
    });
  });
});
