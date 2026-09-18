/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CenterTrialService,
  TRIAL_DURATION_DAYS,
} from '../src/modules/centers/center-trial.service';
import { ACTIVATION_CODE_PATTERN } from '../src/modules/centers/activation-code-format';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Starting the free trial.
 *
 * The clock starts when the manager presses the button, not when a student
 * first redeems: a school should know when its trial ends the moment it has a
 * code to hand out, and the code's own expiry is that same date.
 */
describe('CenterTrialService.start', () => {
  const identity = { centerUserId: 'owner-1', centerId: 'center-1' } as never;

  let prisma: any;
  let service: CenterTrialService;

  const subscription = (over: Record<string, unknown> = {}) => ({
    trial_started_at: null,
    trial_ends_at: null,
    paid_until: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue(subscription()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activationCode: {
        create: jest.fn(async ({ data }: any) => ({
          id: 'code-1',
          status: 'ACTIVATED',
          student_id: null,
          linked_name: null,
          linked_email: null,
          connected_at: null,
          created_at: new Date(),
          ...data,
        })),
      },
      $transaction: jest.fn(async (work: any) => work(prisma)),
    };
    service = new CenterTrialService(prisma);
  });

  it('starts a 14-day clock and issues exactly one code ending with it', async () => {
    const before = Date.now();

    const result = await service.start(identity);

    const write = prisma.centerSubscription.updateMany.mock.calls[0][0];
    const started = write.data.trial_started_at as Date;
    const ends = write.data.trial_ends_at as Date;

    expect(TRIAL_DURATION_DAYS).toBe(14);
    expect(started.getTime()).toBeGreaterThanOrEqual(before);
    expect(ends.getTime() - started.getTime()).toBe(14 * DAY_MS);

    expect(prisma.activationCode.create).toHaveBeenCalledTimes(1);
    const code = prisma.activationCode.create.mock.calls[0][0].data;
    expect(code).toEqual(
      expect.objectContaining({
        center_id: 'center-1',
        tier: 'START',
        expires_at: ends,
      }),
    );
    expect(code.code).toMatch(ACTIVATION_CODE_PATTERN);

    expect(result.trialEndsAt).toEqual(ends);
    expect(result.code).toEqual(
      expect.objectContaining({
        code: code.code,
        status: 'activated',
        planId: 'start',
        expiresAt: ends,
      }),
    );
  });

  it('claims the trial with a predicate, so two presses cannot start two', async () => {
    await service.start(identity);

    expect(prisma.centerSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          center_id: 'center-1',
          trial_started_at: null,
          paid_until: null,
        },
      }),
    );
  });

  it('refuses a second trial, and leaves the running clock alone', async () => {
    prisma.centerSubscription.findUnique.mockResolvedValue(
      subscription({ trial_started_at: new Date('2027-01-01T00:00:00.000Z') }),
    );

    await expect(service.start(identity)).rejects.toThrow(
      new ConflictException('TRIAL_ALREADY_USED'),
    );
    expect(prisma.centerSubscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.activationCode.create).not.toHaveBeenCalled();
  });

  it('refuses a center that has already paid', async () => {
    prisma.centerSubscription.findUnique.mockResolvedValue(
      subscription({ paid_until: new Date('2027-02-01T00:00:00.000Z') }),
    );

    await expect(service.start(identity)).rejects.toThrow(
      new ConflictException('ALREADY_PAID'),
    );
  });

  it('answers the loser of a race as already used, and issues nothing', async () => {
    // Both requests read "no trial yet"; the predicate lets only one through.
    prisma.centerSubscription.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.start(identity)).rejects.toThrow(
      new ConflictException('TRIAL_ALREADY_USED'),
    );
    expect(prisma.activationCode.create).not.toHaveBeenCalled();
  });

  it('draws a new code when the random one is already taken', async () => {
    let attempts = 0;
    prisma.$transaction.mockImplementation(async (work: any) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: 'test',
            // The shape a real P2002 has with the driver adapter: no \`target\`,
            // the column under driverAdapterError (see prisma-errors.spec.ts).
            meta: {
              modelName: 'ActivationCode',
              driverAdapterError: {
                cause: {
                  originalMessage:
                    'duplicate key value violates unique constraint "activation_codes_code_key"',
                  constraint: { fields: ['code'] },
                },
              },
            },
          },
        );
      }
      return work(prisma);
    });

    const result = await service.start(identity);

    expect(attempts).toBe(2);
    expect(result.code.code).toMatch(ACTIVATION_CODE_PATTERN);
  });

  it('refuses a center with no subscription, which is a fault not a state', async () => {
    prisma.centerSubscription.findUnique.mockResolvedValue(null);

    await expect(service.start(identity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
