/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CodeRedemptionService } from '../src/modules/centers/code-redemption.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A student turning a code into access.
 *
 * Done once. After this the student simply logs in, and whether access still
 * holds is read on every request — so what matters here is that one code
 * becomes one student's, exactly once, and only while it is worth anything.
 */
describe('CodeRedemptionService.redeem', () => {
  const student = { studentId: 'student-1' };
  const ip = '41.202.1.1';

  const activeTrial = () => ({
    plan: 'TRIAL',
    trial_started_at: new Date(Date.now() - DAY_MS),
    trial_ends_at: new Date(Date.now() + 13 * DAY_MS),
    paid_until: null,
  });

  const codeRow = (over: Record<string, unknown> = {}) => ({
    id: 'code-1',
    center_id: 'center-1',
    code: 'LQ-7K2P-94QX',
    tier: 'START',
    status: 'ACTIVATED',
    student_id: null,
    expires_at: new Date(Date.now() + 13 * DAY_MS),
    center: { name: 'Institut Goethe Douala', subscription: activeTrial() },
    ...over,
  });

  let prisma: any;
  let service: CodeRedemptionService;

  beforeEach(() => {
    prisma = {
      activationCode: {
        findUnique: jest.fn().mockResolvedValue(codeRow()),
        // The student's connected codes, read inside the transaction.
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activationCodeEvent: { create: jest.fn().mockResolvedValue({}) },
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          first_name: 'Amina',
          last_name: 'Nguema',
          email: 'amina@example.com',
          center_id: null,
          center: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (work: any) => work(prisma)),
    };
    service = new CodeRedemptionService(
      prisma,
      new SubscriptionPolicyService(),
    );
  });

  it('gives the student the code seat, and tells them what they now have', async () => {
    const result = await service.redeem(student, 'lq-7k2p-94qx', ip);

    expect(prisma.student.update).toHaveBeenCalledWith({
      where: { id: 'student-1' },
      data: { center_id: 'center-1', tier: 'START' },
    });
    expect(result).toEqual(
      expect.objectContaining({
        planId: 'start',
        centerName: 'Institut Goethe Douala',
      }),
    );
  });

  it('claims the code with a predicate, so two students cannot both win it', async () => {
    await service.redeem(student, 'LQ-7K2P-94QX', ip);

    const claim = prisma.activationCode.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: 'code-1', status: 'ACTIVATED' });
    expect(claim.data).toEqual(
      expect.objectContaining({
        status: 'CONNECTED',
        student_id: 'student-1',
        linked_name: 'Amina Nguema',
        linked_email: 'amina@example.com',
        connected_ip: ip,
      }),
    );
  });

  it('tells the loser of a race the code is taken, and changes nothing else', async () => {
    prisma.activationCode.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
      new ConflictException('CODE_ALREADY_USED'),
    );
    expect(prisma.student.update).not.toHaveBeenCalled();
  });

  it('records the redemption in the code history', async () => {
    await service.redeem(student, 'LQ-7K2P-94QX', ip);

    expect(prisma.activationCodeEvent.create).toHaveBeenCalledWith({
      data: {
        code_id: 'code-1',
        center_id: 'center-1',
        center_user_id: null,
        from_status: 'ACTIVATED',
        to_status: 'CONNECTED',
        student_id: 'student-1',
      },
    });
  });

  describe('refuses', () => {
    it('something that is not a code, before looking anything up', async () => {
      await expect(service.redeem(student, 'hello', ip)).rejects.toThrow(
        new BadRequestException('CODE_INVALID'),
      );
      expect(prisma.activationCode.findUnique).not.toHaveBeenCalled();
    });

    it('a code that does not exist, with the same answer as a malformed one', async () => {
      prisma.activationCode.findUnique.mockResolvedValue(null);

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new BadRequestException('CODE_INVALID'),
      );
    });

    it('a code another student holds', async () => {
      prisma.activationCode.findUnique.mockResolvedValue(
        codeRow({ status: 'CONNECTED', student_id: 'student-2' }),
      );

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new ConflictException('CODE_ALREADY_USED'),
      );
    });

    it('a code the center took back', async () => {
      prisma.activationCode.findUnique.mockResolvedValue(
        codeRow({ status: 'DEACTIVATED' }),
      );

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new ConflictException('CODE_DEACTIVATED'),
      );
    });

    it('a code past its date', async () => {
      prisma.activationCode.findUnique.mockResolvedValue(
        codeRow({ expires_at: new Date(Date.now() - DAY_MS) }),
      );

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new BadRequestException('CODE_EXPIRED'),
      );
    });

    it('a code from a center that has stopped paying', async () => {
      prisma.activationCode.findUnique.mockResolvedValue(
        codeRow({
          expires_at: null,
          center: {
            name: 'Institut Goethe Douala',
            subscription: {
              plan: 'PAID',
              trial_started_at: null,
              trial_ends_at: null,
              paid_until: new Date(Date.now() - 30 * DAY_MS),
            },
          },
        }),
      );

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new ForbiddenException('CENTER_NOT_ACTIVE'),
      );
    });

    it('a second code for a student who already has a working one', async () => {
      prisma.activationCode.findMany.mockResolvedValue([
        codeRow({ id: 'code-0', status: 'CONNECTED', student_id: 'student-1' }),
      ]);

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new ConflictException('STUDENT_ALREADY_ACTIVE'),
      );
      expect(prisma.activationCode.updateMany).not.toHaveBeenCalled();
    });

    // Review finding 2: a student linked by an old per-student key has a
    // school but no code, so "holds a code" alone missed them, and redeeming
    // another school's code silently moved them — possibly to a lower tier.
    it('a student an older key still ties to a school that is paying', async () => {
      prisma.student.findUnique.mockResolvedValue({
        id: 'student-1',
        first_name: 'Amina',
        last_name: 'Nguema',
        email: 'amina@example.com',
        center_id: 'center-9',
        center: { subscription: activeTrial() },
      });

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new ConflictException('STUDENT_ALREADY_ACTIVE'),
      );
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    // Review finding 3: the check above runs before the write, so two
    // requests could both pass it. The database refuses the second connected
    // code; that refusal must reach the student as the same answer.
    it('a second connected code the database refuses, answered the same way', async () => {
      prisma.activationCode.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: 'activation_codes_one_connected_per_student' },
        }),
      );

      await expect(service.redeem(student, 'LQ-7K2P-94QX', ip)).rejects.toThrow(
        new ConflictException('STUDENT_ALREADY_ACTIVE'),
      );
    });
  });

  /**
   * One connected code per student is now a database rule. A student whose
   * code no longer works must therefore be able to replace it, or the rule
   * would lock out exactly the people it was not aimed at.
   */
  describe('replacing a code that no longer works', () => {
    const claimCall = () =>
      prisma.activationCode.updateMany.mock.calls.find(
        ([args]: any[]) => args.where.status === 'ACTIVATED',
      );
    const releaseCall = () =>
      prisma.activationCode.updateMany.mock.calls.find(
        ([args]: any[]) => args.where.status === 'CONNECTED',
      );

    it('releases a code that has run out, then redeems the new one', async () => {
      prisma.activationCode.findMany.mockResolvedValue([
        codeRow({
          id: 'code-0',
          status: 'CONNECTED',
          student_id: 'student-1',
          expires_at: new Date(Date.now() - DAY_MS),
        }),
      ]);

      await service.redeem(student, 'LQ-7K2P-94QX', ip);

      expect(releaseCall()[0]).toEqual({
        where: { id: 'code-0', status: 'CONNECTED' },
        data: { status: 'DEACTIVATED' },
      });
      expect(claimCall()).toBeDefined();
    });

    it('releases a code whose school stopped paying', async () => {
      prisma.activationCode.findMany.mockResolvedValue([
        codeRow({
          id: 'code-0',
          status: 'CONNECTED',
          student_id: 'student-1',
          expires_at: null,
          center: {
            name: 'Old school',
            subscription: {
              plan: 'PAID',
              trial_started_at: null,
              trial_ends_at: null,
              paid_until: new Date(Date.now() - 30 * DAY_MS),
            },
          },
        }),
      ]);

      await service.redeem(student, 'LQ-7K2P-94QX', ip);

      expect(releaseCall()).toBeDefined();
      expect(claimCall()).toBeDefined();
    });

    it('lets a student whose old school lapsed join a new one', async () => {
      prisma.student.findUnique.mockResolvedValue({
        id: 'student-1',
        first_name: 'Amina',
        last_name: 'Nguema',
        email: 'amina@example.com',
        center_id: 'center-9',
        center: {
          subscription: {
            plan: 'PAID',
            trial_started_at: null,
            trial_ends_at: null,
            paid_until: new Date(Date.now() - 30 * DAY_MS),
          },
        },
      });

      await service.redeem(student, 'LQ-7K2P-94QX', ip);

      expect(prisma.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { center_id: 'center-1', tier: 'START' },
      });
    });
  });

  it('answers a student re-entering their own code with their access, not an error', async () => {
    prisma.activationCode.findUnique.mockResolvedValue(
      codeRow({ status: 'CONNECTED', student_id: 'student-1' }),
    );

    const result = await service.redeem(student, 'LQ-7K2P-94QX', ip);

    expect(result.planId).toBe('start');
    expect(prisma.activationCode.updateMany).not.toHaveBeenCalled();
  });
});
