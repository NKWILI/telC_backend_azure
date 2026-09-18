/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { historyFields, teilStats } from './student-history';

describe('historyFields', () => {
  it('describes a completed attempt the same way for every skill', () => {
    expect(
      historyFields('LESEN', {
        attemptId: 'a-1',
        teil: 3,
        score: 67,
        completedAt: new Date('2026-09-19T08:00:00Z'),
        durationSeconds: 400,
        modelltestId: 'mt-1',
      }),
    ).toEqual({
      attemptId: 'a-1',
      skill: 'lesen',
      teil: 3,
      score: 67,
      maxScore: 100,
      status: 'completed',
      completedAt: '2026-09-19T08:00:00.000Z',
      durationSeconds: 400,
      modelltestId: 'mt-1',
    });
  });

  it('marks a writing attempt still being corrected as pending', () => {
    const fields = historyFields('SCHREIBEN', {
      attemptId: 'a-2',
      teil: 1,
      score: null,
      completedAt: null,
    });

    expect(fields).toMatchObject({
      status: 'pending',
      score: null,
      completedAt: null,
    });
  });
});

describe('teilStats', () => {
  const row = {
    teil: 1,
    attempts: 3,
    best_score: 90,
    last_score: 60,
    last_at: new Date('2026-09-18T10:00:00Z'),
  };

  it('gives each Teil its count, best and latest score, and zeros where none', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([row]) };

    const stats = await teilStats(prisma, 's-1', 'HOEREN', [1, 2]);

    expect(stats[1]).toEqual({
      attempts: 3,
      bestScore: 90,
      lastScore: 60,
      lastAttemptAt: '2026-09-18T10:00:00.000Z',
      maxScore: 100,
    });
    expect(stats[2]).toEqual({
      attempts: 0,
      bestScore: null,
      lastScore: null,
      lastAttemptAt: null,
      maxScore: 100,
    });
  });

  it('ignores a Teil the route does not list', async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ ...row, teil: 9 }]),
    };

    const stats = await teilStats(prisma, 's-1', 'HOEREN', [1]);

    expect(Object.keys(stats)).toEqual(['1']);
  });

  it('gives zeros rather than failing when the table cannot be read', async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('down')),
    };

    const stats = await teilStats(prisma, 's-1', 'LESEN', [1]);

    expect(stats[1].attempts).toBe(0);
  });
});
