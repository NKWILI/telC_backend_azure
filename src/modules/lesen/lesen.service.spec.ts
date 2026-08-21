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

  it('does not expose answers in Lesen Teile 1, 2, or 3', async () => {
    prisma.lesenTeil1Exercise.findFirst.mockResolvedValue({
      label: 'T1',
      instruction: 'I',
      createdAt: new Date(),
      texts: [
        {
          textNumber: 1,
          von: null,
          an: null,
          body: 'Body',
          correctTitleId: 'secret-title',
        },
      ],
      titles: [{ id: 'title-a', content: 'Title', sortOrder: 0 }],
    });
    prisma.lesenTeil2Exercise.findFirst.mockResolvedValue({
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
    });
    prisma.lesenTeil3Exercise.findFirst.mockResolvedValue({
      label: 'T3',
      instruction: 'I',
      announcements: [
        { id: 'announcement-secret', title: 'A', content: 'C', sortOrder: 0 },
      ],
      situations: [
        {
          situationNumber: 11,
          content: 'S',
          noMatch: false,
          correctAnnouncementId: 'announcement-secret',
        },
      ],
    });
    const result = await service.getExercise(1);
    const json = JSON.stringify(result);
    expect(json).not.toContain('correctMatches');
    expect(json).not.toContain('correctOptionId');
    expect(json).not.toContain('isCorrect');
    expect(json).not.toContain('secret-title');
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
