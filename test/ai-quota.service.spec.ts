/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException } from '@nestjs/common';
import {
  AiQuotaService,
  AI_QUOTA_WINDOW_HOURS,
  TIER_AI_ALLOWANCE,
} from '../src/shared/services/ai-quota.service';
import type { StudentEntitlement } from '../src/shared/services/student-entitlement.service';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The one authority on whether a student may run another AI operation.
 *
 * Pure decisions, mocked rows: what this file is about is the arithmetic and
 * the shape of the refusal, not whether Postgres can count. The counting is
 * `ai-usage-integration.spec`'s job.
 */
describe('AiQuotaService', () => {
  const entitled = (
    over: Partial<StudentEntitlement> = {},
  ): StudentEntitlement =>
    ({
      status: 'ACTIVE',
      studentsMayLearn: true,
      graceEndsAt: null,
      tier: 'START',
      ...over,
    }) as StudentEntitlement;

  let entitlement: { forStudent: jest.Mock };
  let usage: { countSince: jest.Mock; oldestSince: jest.Mock };
  let service: AiQuotaService;

  beforeEach(() => {
    entitlement = { forStudent: jest.fn().mockResolvedValue(entitled()) };
    usage = {
      countSince: jest.fn().mockResolvedValue(0),
      oldestSince: jest.fn().mockResolvedValue(null),
    };
    service = new AiQuotaService(entitlement as never, usage as never);
  });

  describe('the published allowances', () => {
    it.each([
      ['START', 2],
      ['PRO', 5],
      ['PREMIUM', 20],
    ] as const)('gives %s %i per window', async (tier, allowed) => {
      entitlement.forStudent.mockResolvedValue(entitled({ tier }));

      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision.allowedToday).toBe(allowed);
      expect(TIER_AI_ALLOWANCE[tier]).toBe(allowed);
    });

    it('counts over a rolling twenty-four hours', async () => {
      await service.check('s1', 'SPEAKING_EVALUATION');

      const since = usage.countSince.mock.calls[0][2] as Date;
      const hoursBack = (Date.now() - since.getTime()) / HOUR_MS;

      expect(AI_QUOTA_WINDOW_HOURS).toBe(24);
      expect(hoursBack).toBeCloseTo(24, 1);
    });

    it('asks only about the operation in question', async () => {
      await service.check('s1', 'SPEAKING_EVALUATION');

      expect(usage.countSince).toHaveBeenCalledWith(
        's1',
        'SPEAKING_EVALUATION',
        expect.any(Date),
      );
    });
  });

  describe('who gets the entry allowance', () => {
    /**
     * Nobody is paying for these calls, so they run at the cheapest rate
     * rather than at no rate. Refusing outright would break every independent
     * student who uses speaking today, and leaving them unmetered would let a
     * center remove a student to hand them unlimited AI.
     */
    it('gives a student no center governs the Start allowance', async () => {
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'NONE', tier: null }),
      );

      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision.allowedToday).toBe(TIER_AI_ALLOWANCE.START);
      expect(decision.tier).toBeNull();
    });

    it('gives a governed student with no tier the same', async () => {
      // One rule rather than two. Provisioning requires a tier, so this is
      // only reachable by a student who predates tiers entirely.
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'ACTIVE', tier: null }),
      );

      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision.allowedToday).toBe(TIER_AI_ALLOWANCE.START);
    });

    it('never makes a removed student better off than a Start student', async () => {
      // The loophole this closes: a center could otherwise release its
      // students to give them an unmetered allowance we pay for.
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'NONE', tier: null }),
      );
      const ungoverned = await service.check('s1', 'SPEAKING_EVALUATION');

      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'START' }));
      const start = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(ungoverned.allowedToday).toBeLessThanOrEqual(start.allowedToday);
    });
  });

  describe('the decision', () => {
    it('allows a student who has used nothing', async () => {
      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision).toMatchObject({
        allowed: true,
        usedToday: 0,
        allowedToday: 2,
      });
    });

    it('allows the last one in the allowance', async () => {
      usage.countSince.mockResolvedValue(1);

      await expect(
        service.check('s1', 'SPEAKING_EVALUATION'),
      ).resolves.toMatchObject({ allowed: true, usedToday: 1 });
    });

    it('refuses once the allowance is spent', async () => {
      usage.countSince.mockResolvedValue(2);

      await expect(
        service.check('s1', 'SPEAKING_EVALUATION'),
      ).resolves.toMatchObject({ allowed: false, usedToday: 2 });
    });

    it('refuses a student somehow over the allowance', async () => {
      // A tier move down, or a lost race. Still refused, never negative.
      usage.countSince.mockResolvedValue(9);

      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision.allowed).toBe(false);
      expect(decision.remaining).toBe(0);
    });

    it('reports what is left, for a client that wants to warn', async () => {
      usage.countSince.mockResolvedValue(1);

      await expect(
        service.check('s1', 'SPEAKING_EVALUATION'),
      ).resolves.toMatchObject({ remaining: 1 });
    });
  });

  describe('resetsAt', () => {
    it('is the oldest counted operation plus the window', async () => {
      // Not midnight. A rolling window has no midnight, and a fixed one would
      // be wrong for everyone outside a single timezone.
      const oldest = new Date(Date.now() - 20 * HOUR_MS);
      usage.countSince.mockResolvedValue(2);
      usage.oldestSince.mockResolvedValue(oldest);

      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision.resetsAt?.getTime()).toBe(
        oldest.getTime() + 24 * HOUR_MS,
      );
    });

    it('is null when nothing has been used', async () => {
      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision.resetsAt).toBeNull();
    });

    it('is asked for over the same window as the count', async () => {
      usage.countSince.mockResolvedValue(2);

      await service.check('s1', 'SPEAKING_EVALUATION');

      const countSince = usage.countSince.mock.calls[0][2] as Date;
      const oldestSince = usage.oldestSince.mock.calls[0][2] as Date;
      // A different cutoff would find a row that was not counted, and report
      // a reset time that has already passed.
      expect(oldestSince.getTime()).toBe(countSince.getTime());
    });
  });

  describe('assertWithinQuota', () => {
    it('returns quietly when the student may proceed', async () => {
      await expect(
        service.assertWithinQuota('s1', 'SPEAKING_EVALUATION'),
      ).resolves.toBeUndefined();
    });

    it('refuses with everything the app needs to sell an upgrade', async () => {
      const oldest = new Date(Date.now() - 20 * HOUR_MS);
      usage.countSince.mockResolvedValue(2);
      usage.oldestSince.mockResolvedValue(oldest);

      await expect(
        service.assertWithinQuota('s1', 'SPEAKING_EVALUATION'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: 'AI_QUOTA_EXCEEDED',
          tier: 'START',
          usedToday: 2,
          allowedToday: 2,
        }),
      });
    });

    it('is a 403, because it is a limit rather than a fault', async () => {
      usage.countSince.mockResolvedValue(2);

      await expect(
        service.assertWithinQuota('s1', 'SPEAKING_EVALUATION'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('carries resetsAt as an instant a client can render', async () => {
      const oldest = new Date(Date.now() - 20 * HOUR_MS);
      usage.countSince.mockResolvedValue(2);
      usage.oldestSince.mockResolvedValue(oldest);

      const refusal = await service
        .assertWithinQuota('s1', 'SPEAKING_EVALUATION')
        .catch((e: { response: { resetsAt: string } }) => e);

      expect(
        new Date(
          (refusal as { response: { resetsAt: string } }).response.resetsAt,
        ).getTime(),
      ).toBe(oldest.getTime() + 24 * HOUR_MS);
    });
  });

  describe('it does not decide what it was not asked', () => {
    it('says nothing about whether the center is entitled at all', async () => {
      // A blocked center is StudentSubscriptionGuard's refusal, and it must
      // reach the student as SUBSCRIPTION_INACTIVE rather than as a quota
      // message about a school that has stopped paying.
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'BLOCKED', studentsMayLearn: false, tier: null }),
      );

      const decision = await service.check('s1', 'SPEAKING_EVALUATION');

      expect(decision).toMatchObject({ allowed: true });
    });
  });
});
