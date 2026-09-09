import { UnprocessableEntityException } from '@nestjs/common';
import { LesenService } from './lesen.service';

describe('LesenService answer security', () => {
  const prisma = {
    modelltest: { findUnique: jest.fn() },
    lesenTeil1Exercise: { findFirst: jest.fn(), findUnique: jest.fn() },
    lesenTeil2Exercise: { findFirst: jest.fn(), findUnique: jest.fn() },
    lesenTeil3Exercise: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  let service: LesenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LesenService(prisma as any);
    prisma.modelltest.findUnique.mockResolvedValue({ id: 'mt-1' });
  });

  // Fixtures shared by the exercise tests below. Teil 1's correct title is a
  // real titles[].id, Teil 2's correct option sits at sortOrder 0 ("6a"), and
  // Teil 3's situation points at the announcement that renders as "a".
  const teil1Row = {
    label: 'T1',
    instruction: 'I',
    createdAt: new Date(),
    texts: [
      {
        textNumber: 1,
        von: null,
        an: null,
        body: 'Body',
        correctTitleId: 'title-a',
      },
    ],
    titles: [{ id: 'title-a', content: 'Title', sortOrder: 0 }],
  };
  const teil2Row = {
    contentRevision: 'revision',
    label: 'T2',
    instruction: 'I',
    cautionNote: 'C',
    topSender: 'S',
    topReceiver: 'R',
    topBody: 'B',
    quotedThread: 'Q',
    questions: [
      {
        questionNumber: 6,
        prompt: 'P',
        options: [{ content: 'A', isCorrect: true, sortOrder: 0 }],
      },
    ],
  };
  const teil3Row = {
    label: 'T3',
    instruction: 'I',
    announcements: [{ id: 'ann-1', title: 'A', content: 'C', sortOrder: 0 }],
    situations: [
      {
        situationNumber: 11,
        content: 'S',
        noMatch: false,
        correctAnnouncementId: 'ann-1',
      },
    ],
  };

  function mockExerciseRows() {
    prisma.lesenTeil1Exercise.findFirst.mockResolvedValue(teil1Row);
    prisma.lesenTeil2Exercise.findFirst.mockResolvedValue(teil2Row);
    prisma.lesenTeil3Exercise.findFirst.mockResolvedValue(teil3Row);
  }

  // This test used to assert the opposite: that getExercise() leaked no
  // answers. Reversed deliberately — see
  // docs/adr/0001-answer-key-with-exercise.md. Kept on the same surface so the
  // next person to change it confronts the decision rather than rediscovering it.
  it('exposes the correct answer for Teile 1, 2 and 3', async () => {
    mockExerciseRows();
    const result = await service.getExercise(1);

    expect(result.teil1.texts[0].correctTitleId).toBe('title-a');
    expect(result.teil2.questions[0].correctOptionId).toBe('6a');
    expect(result.teil3.situations[0].correctAnswer).toBe('a');
  });

  it('marks a Teil 3 situation with no matching announcement as X', async () => {
    mockExerciseRows();
    prisma.lesenTeil3Exercise.findFirst.mockResolvedValue({
      ...teil3Row,
      situations: [
        {
          situationNumber: 12,
          content: 'S',
          noMatch: true,
          correctAnnouncementId: null,
        },
      ],
    });
    const result = await service.getExercise(1);

    expect(result.teil3.situations[0].correctAnswer).toBe('X');
  });

  it('never leaks raw database column names', async () => {
    mockExerciseRows();
    const json = JSON.stringify(await service.getExercise(1));

    // The answers are public now; the schema is not. These appearing would mean
    // a Prisma row was spread into the response instead of projected field by
    // field — which would also expose columns nobody reviewed.
    expect(json).not.toContain('isCorrect');
    expect(json).not.toContain('correctAnnouncementId');
    expect(json).not.toContain('sortOrder');
    expect(json).not.toContain('noMatch');
  });

  it('serves the same answers that submit scores against', async () => {
    // getExercise() and getSubmissionRules() now both produce this key, from
    // different queries. This is the test that stops the two drifting apart.
    mockExerciseRows();
    prisma.lesenTeil1Exercise.findUnique.mockResolvedValue(teil1Row);
    prisma.lesenTeil2Exercise.findUnique.mockResolvedValue(teil2Row);
    prisma.lesenTeil3Exercise.findUnique.mockResolvedValue(teil3Row);
    const exercise = await service.getExercise(1);
    const base = { id: 'a', exercise_type_id: 'reading', tested_at: 'now' };

    const teil1 = await service.submit({
      ...base,
      teil_id: '1',
      answers: { '1': exercise.teil1.texts[0].correctTitleId },
    });
    const teil2 = await service.submit({
      ...base,
      teil_id: '2',
      answers: { '6': exercise.teil2.questions[0].correctOptionId },
    });
    const teil3 = await service.submit({
      ...base,
      teil_id: '3',
      answers: { '11': exercise.teil3.situations[0].correctAnswer },
    });

    expect(teil1.score).toBe(100);
    expect(teil2.score).toBe(100);
    expect(teil3.score).toBe(100);
  });

  it('scores Lesen submissions server-side and ignores score_percent', async () => {
    prisma.lesenTeil2Exercise.findUnique.mockResolvedValue({
      questions: [
        { questionNumber: 6, options: [{ isCorrect: true, sortOrder: 2 }] },
        {
          questionNumber: 7,
          options: [
            { isCorrect: true, sortOrder: 0 },
            { isCorrect: false, sortOrder: 1 },
          ],
        },
      ],
    });
    const result = await service.submit({
      id: 'attempt',
      exercise_type_id: 'reading',
      teil_id: '2',
      tested_at: 'now',
      score_percent: 100,
      answers: { '6': '6c', '7': '7b' },
    });
    expect(result).toEqual({ score: 50 });
  });

  it('rejects unknown question IDs and answer values outside the exercise options', async () => {
    prisma.lesenTeil2Exercise.findUnique.mockResolvedValue({
      questions: [
        {
          questionNumber: 6,
          options: [
            { isCorrect: true, sortOrder: 0 },
            { isCorrect: false, sortOrder: 1 },
          ],
        },
      ],
    });
    const base = {
      id: 'attempt',
      exercise_type_id: 'reading',
      teil_id: '2',
      tested_at: 'now',
    };

    await expect(
      service.submit({ ...base, answers: { '99': '99a' } }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.submit({ ...base, answers: { '6': '6z' } }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects an unknown Modelltest and an unknown Teil', async () => {
    prisma.modelltest.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.submit({
        id: 'attempt',
        exercise_type_id: 'reading',
        teil_id: '1',
        tested_at: 'now',
        answers: { '1': 'title-a' },
      }),
    ).rejects.toThrow('Modelltest not found');

    await expect(
      service.submit({
        id: 'attempt',
        exercise_type_id: 'reading',
        teil_id: '4',
        tested_at: 'now',
        answers: { '1': 'a' },
      }),
    ).rejects.toThrow('Lesen Teil not found');
  });
});
