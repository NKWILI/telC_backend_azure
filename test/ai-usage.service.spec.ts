/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';
import { AiUsageService } from '../src/shared/services/ai-usage.service';

/**
 * The two decisions here that are not about SQL.
 *
 * One: the clock belongs to the database. Two: for the caller that has already
 * delivered a result, a failure to write the meter must not take that result
 * away.
 */
describe('AiUsageService', () => {
  let prisma: any;
  let service: AiUsageService;

  beforeEach(() => {
    prisma = {
      aiUsage: {
        create: jest.fn().mockResolvedValue({ id: 'usage-1' }),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new AiUsageService(prisma);
  });

  describe('record', () => {
    it('writes the student and the operation, and nothing else', async () => {
      await service.record('student-1', 'SPEAKING_EVALUATION');

      expect(prisma.aiUsage.create).toHaveBeenCalledWith({
        data: { student_id: 'student-1', operation: 'SPEAKING_EVALUATION' },
      });
    });

    it('never supplies created_at', async () => {
      // The window is compared against these timestamps. A caller able to set
      // one could date a row into the past and refill its own allowance, so
      // the column is left to its database default.
      await service.record('student-1', 'SPEAKING_EVALUATION');

      const data = prisma.aiUsage.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('created_at');
    });

    it('lets a write failure reach the caller', async () => {
      // The plain form is for callers that can still refuse the operation.
      // They need to know.
      prisma.aiUsage.create.mockRejectedValue(new Error('offline'));

      await expect(
        service.record('student-1', 'SPEAKING_EVALUATION'),
      ).rejects.toThrow('offline');
    });
  });

  describe('recordDelivered', () => {
    it('swallows a write failure, because the student already has the result', async () => {
      // Failing the response here would take away work the student has earned
      // in order to protect a number. The row is lost and they get one free
      // operation, which is the cheaper of the two mistakes.
      prisma.aiUsage.create.mockRejectedValue(new Error('offline'));

      await expect(
        service.recordDelivered('student-1', 'SPEAKING_EVALUATION'),
      ).resolves.toBeUndefined();
    });

    it('says so loudly, because a meter that stops counting is invisible', async () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      prisma.aiUsage.create.mockRejectedValue(new Error('offline'));

      await service.recordDelivered('student-1', 'SPEAKING_EVALUATION');

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('student-1'),
        expect.anything(),
      );
      logged.mockRestore();
    });

    it('still writes the row when nothing is wrong', async () => {
      await service.recordDelivered('student-1', 'SPEAKING_EVALUATION');

      expect(prisma.aiUsage.create).toHaveBeenCalled();
    });
  });

  describe('countSince', () => {
    it('scopes by student, operation and the cutoff together', async () => {
      const since = new Date('2026-09-15T00:00:00.000Z');

      await service.countSince('student-1', 'SPEAKING_EVALUATION', since);

      expect(prisma.aiUsage.count).toHaveBeenCalledWith({
        where: {
          student_id: 'student-1',
          operation: 'SPEAKING_EVALUATION',
          created_at: { gte: since },
        },
      });
    });
  });

  describe('oldestSince', () => {
    it('asks for the earliest row in the window', async () => {
      const since = new Date('2026-09-15T00:00:00.000Z');

      await service.oldestSince('student-1', 'SPEAKING_EVALUATION', since);

      expect(prisma.aiUsage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { created_at: 'asc' } }),
      );
    });

    it('can skip rows that must expire before capacity returns', async () => {
      const since = new Date('2026-09-15T00:00:00.000Z');

      await service.oldestSince('student-1', 'SPEAKING_EVALUATION', since, 7);

      expect(prisma.aiUsage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 7 }),
      );
    });

    it('reports null rather than a date when the window is empty', async () => {
      await expect(
        service.oldestSince(
          'student-1',
          'SPEAKING_EVALUATION',
          new Date('2026-09-15T00:00:00.000Z'),
        ),
      ).resolves.toBeNull();
    });
  });
});
