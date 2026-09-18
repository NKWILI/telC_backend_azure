/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CenterActivationCodesService } from '../src/modules/centers/center-activation-codes.service';

/**
 * The Users page: what a center holds, and the two things it may do to a code.
 *
 * There is deliberately no create and no delete. Codes exist because a trial
 * started or a payment succeeded, which is what keeps the number of codes and
 * the number of paid seats in agreement.
 */
describe('CenterActivationCodesService', () => {
  const identity = {
    centerUserId: 'owner-1',
    centerId: 'center-1',
  } as never;

  const codeRow = (over: Record<string, unknown> = {}) => ({
    id: 'code-1',
    center_id: 'center-1',
    code: 'LQ-7K2P-94QX',
    tier: 'START',
    status: 'ACTIVATED',
    student_id: null,
    linked_name: null,
    linked_email: null,
    connected_at: null,
    connected_ip: null,
    expires_at: null,
    created_at: new Date('2027-01-01T00:00:00.000Z'),
    ...over,
  });

  let prisma: any;
  let service: CenterActivationCodesService;

  beforeEach(() => {
    prisma = {
      activationCode: {
        findMany: jest.fn().mockResolvedValue([codeRow()]),
        findFirst: jest.fn().mockResolvedValue(codeRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      activationCodeEvent: { create: jest.fn().mockResolvedValue({}) },
      student: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      centerSeat: { findMany: jest.fn().mockResolvedValue([]) },
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          trial_started_at: new Date('2027-01-01T00:00:00.000Z'),
          paid_until: null,
        }),
      },
      $transaction: jest.fn(async (work: any) => work(prisma)),
    };
    service = new CenterActivationCodesService(prisma);
  });

  describe('listing', () => {
    it('lists only the signed center codes, newest first', async () => {
      await service.list(identity, {});

      expect(prisma.activationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { center_id: 'center-1' },
          orderBy: { created_at: 'desc' },
        }),
      );
    });

    it('filters in the client vocabulary and queries in the database one', async () => {
      await service.list(identity, { status: 'connected', planId: 'pro' });

      expect(prisma.activationCode.findMany.mock.calls[0][0].where).toEqual({
        center_id: 'center-1',
        status: 'CONNECTED',
        tier: 'PRO',
      });
    });

    it('treats "all" as no filter, which is what the dropdown sends', async () => {
      await service.list(identity, { status: 'all', planId: 'all' });

      expect(prisma.activationCode.findMany.mock.calls[0][0].where).toEqual({
        center_id: 'center-1',
      });
    });

    it('never returns the redemption IP to a center', async () => {
      prisma.activationCode.findMany.mockResolvedValue([
        codeRow({ connected_ip: '41.202.1.1' }),
      ]);

      const codes = await service.list(identity, {});

      expect(JSON.stringify(codes)).not.toContain('41.202.1.1');
    });
  });

  describe('the seat summary', () => {
    it('counts bought seats from the seat rows and used ones from connected codes', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 7 },
        { tier: 'PRO', quantity: 3 },
      ]);
      prisma.activationCode.groupBy.mockResolvedValue([
        { tier: 'START', _count: { _all: 5 } },
        { tier: 'PRO', _count: { _all: 1 } },
      ]);

      await expect(service.seats(identity)).resolves.toEqual({
        bought: { start: 7, pro: 3, premium: 0 },
        used: { start: 5, pro: 1, premium: 0 },
        boughtTotal: 10,
        usedTotal: 6,
      });
      expect(prisma.activationCode.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { center_id: 'center-1', status: 'CONNECTED' },
        }),
      );
    });
  });

  describe('deactivating', () => {
    it('takes a waiting code back', async () => {
      // Before the write, then the re-read after it: the response is what the
      // database now holds, not what the service hoped it wrote.
      prisma.activationCode.findFirst
        .mockResolvedValueOnce(codeRow())
        .mockResolvedValueOnce(codeRow({ status: 'DEACTIVATED' }));

      const code = await service.deactivate(identity, 'code-1');

      expect(prisma.activationCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'code-1',
            center_id: 'center-1',
            status: { in: ['ACTIVATED', 'CONNECTED'] },
          },
          data: { status: 'DEACTIVATED' },
        }),
      );
      expect(code.status).toBe('deactivated');
    });

    it('cuts a connected student off, and keeps their name so the center knows who', async () => {
      prisma.activationCode.findFirst
        .mockResolvedValueOnce(
          codeRow({
            status: 'CONNECTED',
            student_id: 'student-1',
            linked_name: 'Amina Nguema',
            linked_email: 'amina@example.com',
          }),
        )
        .mockResolvedValueOnce(
          codeRow({
            status: 'DEACTIVATED',
            student_id: 'student-1',
            linked_name: 'Amina Nguema',
            linked_email: 'amina@example.com',
          }),
        );

      const code = await service.deactivate(identity, 'code-1');

      // Only this center's hold on the student is released: a student who has
      // since joined another school must not lose that school.
      expect(prisma.student.updateMany).toHaveBeenCalledWith({
        where: { id: 'student-1', center_id: 'center-1' },
        data: { center_id: null, tier: null },
      });
      expect(code.linkedName).toBe('Amina Nguema');
    });

    it('records who did it, and to whom', async () => {
      prisma.activationCode.findFirst.mockResolvedValue(
        codeRow({ status: 'CONNECTED', student_id: 'student-1' }),
      );

      await service.deactivate(identity, 'code-1');

      expect(prisma.activationCodeEvent.create).toHaveBeenCalledWith({
        data: {
          code_id: 'code-1',
          center_id: 'center-1',
          center_user_id: 'owner-1',
          from_status: 'CONNECTED',
          to_status: 'DEACTIVATED',
          student_id: 'student-1',
        },
      });
    });

    it('answers an already-deactivated code with the code, not an error', async () => {
      prisma.activationCode.findFirst.mockResolvedValue(
        codeRow({ status: 'DEACTIVATED' }),
      );

      const code = await service.deactivate(identity, 'code-1');

      expect(code.status).toBe('deactivated');
      expect(prisma.activationCode.updateMany).not.toHaveBeenCalled();
      expect(prisma.activationCodeEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('activating', () => {
    it('gives a deactivated code back, emptied, so the seat can go to someone new', async () => {
      prisma.activationCode.findFirst.mockResolvedValue(
        codeRow({ status: 'DEACTIVATED', linked_name: 'Amina Nguema' }),
      );

      await service.activate(identity, 'code-1');

      expect(prisma.activationCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'code-1',
            center_id: 'center-1',
            status: { in: ['DEACTIVATED'] },
          },
          data: {
            status: 'ACTIVATED',
            student_id: null,
            linked_name: null,
            linked_email: null,
            connected_at: null,
            connected_ip: null,
          },
        }),
      );
    });

    it('refuses to activate a code a student is using', async () => {
      prisma.activationCode.findFirst.mockResolvedValue(
        codeRow({ status: 'CONNECTED' }),
      );

      await expect(service.activate(identity, 'code-1')).rejects.toThrow(
        new ConflictException('INVALID_CODE_TRANSITION'),
      );
    });
  });

  describe('what every action requires', () => {
    it('answers another center code as not found, never as forbidden', async () => {
      prisma.activationCode.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(identity, 'code-9')).rejects.toThrow(
        new NotFoundException('CODE_NOT_FOUND'),
      );
      expect(prisma.activationCode.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'code-9', center_id: 'center-1' },
        }),
      );
    });

    it('refuses a center that has not finalized its account', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue({
        trial_started_at: null,
        paid_until: null,
      });

      await expect(service.deactivate(identity, 'code-1')).rejects.toThrow(
        new ForbiddenException('ACCOUNT_NOT_FINALIZED'),
      );
      expect(prisma.activationCode.updateMany).not.toHaveBeenCalled();
    });

    it('still lets an unfinalized center read its codes', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue({
        trial_started_at: null,
        paid_until: null,
      });

      await expect(service.list(identity, {})).resolves.toHaveLength(1);
    });
  });
});
