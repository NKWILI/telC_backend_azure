/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CenterSubscriptionGuard } from '../src/modules/centers/guards/center-subscription.guard';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

const record = (overrides: Record<string, unknown>) => ({
  plan: 'TRIAL',
  seats: 3,
  trial_started_at: null,
  trial_ends_at: null,
  paid_until: null,
  ...overrides,
});

describe('CenterSubscriptionGuard', () => {
  let prisma: any;
  let guard: CenterSubscriptionGuard;

  const contextFor = (centerUser: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ centerUser }) }),
    }) as ExecutionContext;

  const authenticated = () => contextFor({ centerId: 'center-1' });

  beforeEach(() => {
    prisma = { centerSubscription: { findUnique: jest.fn() } };
    guard = new CenterSubscriptionGuard(
      prisma,
      new SubscriptionPolicyService(),
    );
  });

  describe('centers that may still provision', () => {
    it('admits a brand-new center whose trial has not started', async () => {
      // The state every center registers into. Refusing here would stop a new
      // customer creating the student whose activation starts their trial.
      prisma.centerSubscription.findUnique.mockResolvedValue(record({}));

      await expect(guard.canActivate(authenticated())).resolves.toBe(true);
    });

    it('admits a center on trial', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        record({
          trial_started_at: daysFromNow(-3),
          trial_ends_at: daysFromNow(27),
        }),
      );

      await expect(guard.canActivate(authenticated())).resolves.toBe(true);
    });

    it('admits a paid center', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        record({ plan: 'PAID', paid_until: daysFromNow(30) }),
      );

      await expect(guard.canActivate(authenticated())).resolves.toBe(true);
    });

    it('admits a center inside its grace period', async () => {
      // Grace exists so a late transfer does not stop the business running.
      prisma.centerSubscription.findUnique.mockResolvedValue(
        record({ plan: 'PAID', paid_until: daysFromNow(-2) }),
      );

      await expect(guard.canActivate(authenticated())).resolves.toBe(true);
    });
  });

  describe('centers that may not', () => {
    const blocked = () =>
      prisma.centerSubscription.findUnique.mockResolvedValue(
        record({ plan: 'PAID', paid_until: daysFromNow(-8) }),
      );

    it('refuses a center whose paid period lapsed beyond grace', async () => {
      blocked();

      await expect(guard.canActivate(authenticated())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses a center whose trial ran out', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        record({
          trial_started_at: daysFromNow(-31),
          trial_ends_at: daysFromNow(-1),
        }),
      );

      await expect(guard.canActivate(authenticated())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('says which subscription state caused it, not just "forbidden"', async () => {
      blocked();

      const error = await guard
        .canActivate(authenticated())
        .catch((e: unknown) => e);

      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        message: 'SUBSCRIPTION_INACTIVE',
        subscriptionStatus: 'BLOCKED',
      });
    });
  });

  describe('failure directions', () => {
    it('refuses a center with no subscription row', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(authenticated())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('answers 503 when the database is unreachable, never a silent pass', async () => {
      prisma.centerSubscription.findUnique.mockRejectedValue(
        new Error('connection lost'),
      );

      const error = await guard
        .canActivate(authenticated())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when no center is on the request at all', async () => {
      // CenterAuthGuard runs first and would have rejected this. Reaching here
      // without a center means the guards are misordered, and passing would
      // turn that mistake into an unguarded route.
      const error = await guard
        .canActivate(contextFor(undefined))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.centerSubscription.findUnique).not.toHaveBeenCalled();
    });
  });

  it('costs one query', async () => {
    prisma.centerSubscription.findUnique.mockResolvedValue(
      record({ plan: 'PAID', paid_until: daysFromNow(30) }),
    );

    await guard.canActivate(authenticated());

    expect(prisma.centerSubscription.findUnique).toHaveBeenCalledTimes(1);
  });
});
