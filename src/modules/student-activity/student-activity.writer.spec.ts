/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { recordActivity } from './student-activity.writer';

describe('recordActivity', () => {
  const tx: any = {
    student: { findUnique: jest.fn() },
    studentActivity: { create: jest.fn() },
  };
  beforeEach(() => {
    tx.studentActivity.create.mockReset();
    tx.student.findUnique.mockReset().mockResolvedValue({ id: 'student-1' });
  });

  const base = {
    studentId: 'student-1',
    skill: 'HOEREN' as const,
    teil: 2,
    score: 80,
    attemptId: 'attempt-1',
  };

  it('writes one summary row, in percent unless told otherwise', async () => {
    await recordActivity(tx, {
      ...base,
      modelltestId: 'mt-1',
      durationSeconds: 300,
    });

    expect(tx.studentActivity.create).toHaveBeenCalledWith({
      data: {
        student_id: 'student-1',
        skill: 'HOEREN',
        teil: 2,
        score: 80,
        max_score: 100,
        duration_seconds: 300,
        modelltest_id: 'mt-1',
        attempt_id: 'attempt-1',
        erasure_id: null,
      },
    });
  });

  it('records nothing for a guest, who has no student row', async () => {
    tx.student.findUnique.mockResolvedValue(null);

    await expect(recordActivity(tx, base)).resolves.toBe(false);
    expect(tx.studentActivity.create).not.toHaveBeenCalled();
  });

  it('keeps the completion time the caller knows', async () => {
    const completedAt = new Date('2026-09-01T10:00:00Z');
    await recordActivity(tx, { ...base, completedAt });

    expect(tx.studentActivity.create.mock.calls[0][0].data.created_at).toBe(
      completedAt,
    );
  });

  it.each([
    ['a score above the maximum', { score: 101 }],
    ['a negative score', { score: -1 }],
    ['a Teil that is not a number from 1', { teil: 0 }],
    ['a score that is not a number', { score: Number.NaN }],
  ])('refuses %s instead of storing it', async (_label, over) => {
    await expect(recordActivity(tx, { ...base, ...over })).rejects.toThrow(
      /Invalid activity/,
    );
    expect(tx.studentActivity.create).not.toHaveBeenCalled();
  });
});
