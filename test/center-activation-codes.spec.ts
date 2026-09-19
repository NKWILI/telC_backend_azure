/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  CenterActivationCodesService,
  seatWindowOf,
} from '../src/modules/centers/center-activation-codes.service';
import { hideSeatData } from '../src/modules/student-activity/seat-erasure';

// The hiding itself is proven on Postgres (seat-erasure-integration.spec.ts);
// here, only that a reset asks for it, for the right student and window.
jest.mock('../src/modules/student-activity/seat-erasure', () => ({
  hideSeatData: jest.fn().mockResolvedValue('erasure-1'),
}));

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
      activationCodeEvent: {
        create: jest.fn().mockResolvedValue({}),
        // The code history the reset limit is counted from. Empty: nothing
        // has happened to the code yet.
        findMany: jest.fn().mockResolvedValue([]),
      },
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

    // D39: the confirmation shows how many resets are left, so the list
    // carries it — worked out from the log, for every listed code at once.
    it('reports each code reset allowance, read in one query for the whole list', async () => {
      prisma.activationCode.findMany.mockResolvedValue([
        codeRow({ id: 'code-1' }),
        codeRow({ id: 'code-2', code: 'LQ-2222-2222' }),
      ]);
      prisma.activationCodeEvent.findMany.mockResolvedValue([
        {
          code_id: 'code-2',
          created_at: new Date('2027-01-05T00:00:00.000Z'),
          to_status: 'CONNECTED',
          previous_code: null,
        },
      ]);

      const codes = await service.list(identity, {});

      expect(prisma.activationCodeEvent.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.activationCodeEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code_id: { in: ['code-1', 'code-2'] } },
        }),
      );
      // Never redeemed: a reset is free and does not count.
      expect(codes[0].reset).toEqual(
        expect.objectContaining({ counted: false }),
      );
      // Redeemed during the trial: a reset counts, and one is left.
      expect(codes[1].reset).toEqual({
        counted: true,
        remaining: 1,
        availableAt: null,
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
      //
      // And the tier stays. A leftover tier is how the system tells a student a
      // school released from a genuine independent one — and independent
      // students are admitted to the exam module. Clearing it would turn
      // "deactivated" into "upgraded".
      expect(prisma.student.updateMany).toHaveBeenCalledWith({
        where: { id: 'student-1', center_id: 'center-1' },
        data: { center_id: null },
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

  /**
   * D39: a seat is handed on by giving it a NEW value. Deactivate-then-
   * activate put the same value back, and the previous student still knew it.
   */
  describe('resetting a code', () => {
    const connectedToAmina = () =>
      codeRow({
        status: 'CONNECTED',
        student_id: 'student-1',
        linked_name: 'Amina Nguema',
        linked_email: 'amina@example.com',
        connected_at: new Date('2027-01-02T00:00:00.000Z'),
        connected_ip: '41.202.1.1',
      });
    const resetWrite = () => prisma.activationCode.updateMany.mock.calls[0][0];

    beforeEach(() => {
      prisma.activationCode.findFirst
        .mockResolvedValueOnce(connectedToAmina())
        .mockResolvedValueOnce(codeRow({ code: 'LQ-NEW2-VALU' }));
    });

    it('draws a new value on the same row and empties the seat', async () => {
      const code = await service.reset(identity, 'code-1');

      const write = resetWrite();
      // Predicated on the value and status it was read with, so a redemption
      // or a second reset landing in between is noticed, not overwritten.
      expect(write.where).toEqual({
        id: 'code-1',
        center_id: 'center-1',
        code: 'LQ-7K2P-94QX',
        status: 'CONNECTED',
      });
      expect(write.data).toEqual({
        code: expect.stringMatching(/^LQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        status: 'ACTIVATED',
        student_id: null,
        linked_name: null,
        linked_email: null,
        connected_at: null,
        connected_ip: null,
      });
      expect(write.data.code).not.toBe('LQ-7K2P-94QX');
      expect(code.status).toBe('activated');
    });

    it("hides the student's work on the seat, from connecting until now (D39)", async () => {
      await service.reset(identity, 'code-1');

      expect(hideSeatData).toHaveBeenCalledWith(
        expect.anything(),
        {
          studentId: 'student-1',
          centerId: 'center-1',
          codeId: 'code-1',
          centerUserId: 'owner-1',
          since: new Date('2027-01-02T00:00:00.000Z'),
          until: null,
        },
        expect.any(Date),
      );
    });

    it('cuts the connected student off, keeping their tier', async () => {
      await service.reset(identity, 'code-1');

      expect(prisma.student.updateMany).toHaveBeenCalledWith({
        where: { id: 'student-1', center_id: 'center-1' },
        data: { center_id: null },
      });
    });

    it('logs the old value, which is what marks the event as a reset', async () => {
      await service.reset(identity, 'code-1');

      expect(prisma.activationCodeEvent.create).toHaveBeenCalledWith({
        data: {
          code_id: 'code-1',
          center_id: 'center-1',
          center_user_id: 'owner-1',
          from_status: 'CONNECTED',
          to_status: 'ACTIVATED',
          student_id: 'student-1',
          previous_code: 'LQ-7K2P-94QX',
        },
      });
    });

    it('refuses a third reset of a used seat in the period, saying when more come', async () => {
      const now = Date.now();
      const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000);
      prisma.centerSubscription.findUnique.mockResolvedValue({
        trial_started_at: null,
        trial_ends_at: null,
        paid_until: new Date(now + 10 * 86_400_000),
      });
      prisma.activationCodeEvent.findMany.mockResolvedValue([
        { created_at: at(9), to_status: 'CONNECTED', previous_code: null },
        { created_at: at(8), to_status: 'ACTIVATED', previous_code: 'LQ-A' },
        { created_at: at(7), to_status: 'CONNECTED', previous_code: null },
        { created_at: at(6), to_status: 'ACTIVATED', previous_code: 'LQ-B' },
        { created_at: at(5), to_status: 'CONNECTED', previous_code: null },
      ]);

      const error = await service
        .reset(identity, 'code-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        message: 'CODE_RESET_LIMIT_REACHED',
        resetsAvailableAt: expect.any(Date),
      });
      expect(prisma.activationCode.updateMany).not.toHaveBeenCalled();
    });

    it('answers a code that changed underneath it, instead of overwriting', async () => {
      prisma.activationCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reset(identity, 'code-1')).rejects.toThrow(
        new ConflictException('CODE_CHANGED'),
      );
      expect(prisma.activationCodeEvent.create).not.toHaveBeenCalled();
    });

    it('is refused to a center that has not finalized its account', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue({
        trial_started_at: null,
        trial_ends_at: null,
        paid_until: null,
      });

      await expect(service.reset(identity, 'code-1')).rejects.toThrow(
        new ForbiddenException('ACCOUNT_NOT_FINALIZED'),
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

describe('seatWindowOf', () => {
  const since = new Date('2027-01-02T00:00:00Z');
  const now = new Date('2027-02-01T00:00:00Z');
  const left = new Date('2027-01-20T00:00:00Z');
  const event = (
    to_status: any,
    created_at: Date,
    student_id = 'student-1',
  ) => ({
    to_status,
    created_at,
    student_id,
  });

  it('is open-ended for a student still on the seat, whatever the clocks say', () => {
    expect(
      seatWindowOf(
        { status: 'CONNECTED', student_id: 'student-1', connected_at: since },
        [],
      ),
    ).toEqual({ studentId: 'student-1', since, until: null });
  });

  it('ends when a deactivated seat was taken from them, sparing later work elsewhere', () => {
    expect(
      seatWindowOf(
        { status: 'DEACTIVATED', student_id: 'student-1', connected_at: since },
        [
          event('CONNECTED', since),
          event('DEACTIVATED', left),
          event('DEACTIVATED', left, 'someone-else'),
        ],
      ),
    ).toEqual({ studentId: 'student-1', since, until: left });
  });

  it('is nothing for a seat nobody held, or whose end was never logged', () => {
    expect(
      seatWindowOf(
        { status: 'ACTIVATED', student_id: null, connected_at: null },
        [],
      ),
    ).toBeNull();
    expect(
      seatWindowOf(
        { status: 'DEACTIVATED', student_id: 'student-1', connected_at: since },
        [],
      ),
    ).toBeNull();
  });
});
