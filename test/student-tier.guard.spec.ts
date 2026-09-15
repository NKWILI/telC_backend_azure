/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StudentTierGuard } from '../src/shared/guards/student-tier.guard';
import { RequiresTier } from '../src/shared/decorators/requires-tier.decorator';
import type { StudentEntitlement } from '../src/shared/services/student-entitlement.service';

/**
 * What a student of a given tier may reach.
 *
 * The exam module is the line between Start and Pro, so this guard is what
 * makes Pro worth buying. Two properties matter more than the happy path:
 *
 *  - an ungoverned student keeps what they already had. Independent students
 *    predate centers entirely and hold no tier, and refusing them the exam
 *    module would take away something they have today for a reason that has
 *    nothing to do with them.
 *  - it cannot pass by accident. A guard that answers "allowed" when it has
 *    no entitlement to read is worse than no guard, because it looks like one.
 */
describe('StudentTierGuard', () => {
  const entitled = (over: Partial<StudentEntitlement> = {}) =>
    ({
      status: 'ACTIVE',
      studentsMayLearn: true,
      graceEndsAt: null,
      tier: 'PRO',
      studentExists: true,
      wasGoverned: true,
      ...over,
    }) as StudentEntitlement;

  let entitlement: { forStudent: jest.Mock };
  let guard: StudentTierGuard;

  /** A request as `JwtAuthGuard` leaves it, optionally pre-filled by the
   *  subscription guard. */
  const contextFor = (
    request: Record<string, unknown>,
    // `null` means "no decorator on this route". Not `undefined`: passing
    // undefined to a parameter with a default silently uses the default, which
    // is how this helper first tested the opposite of what it claimed.
    required: string | null = 'PRO',
  ): ExecutionContext => {
    const handler = () => undefined;
    if (required) {
      RequiresTier(required as never)({}, 'handler', {
        value: handler,
      } as never);
    }

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class Anonymous {},
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    entitlement = { forStudent: jest.fn().mockResolvedValue(entitled()) };
    guard = new StudentTierGuard(entitlement as never, new Reflector());
  });

  describe('who gets through', () => {
    it.each(['PRO', 'PREMIUM'])('admits a %s student', async (tier) => {
      entitlement.forStudent.mockResolvedValue(entitled({ tier } as never));

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).resolves.toBe(true);
    });

    it('refuses a Start student', async () => {
      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'START' }));

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toThrow('TIER_TOO_LOW');
    });

    it('refuses a governed student carrying no tier', async () => {
      // A center student provisioned before tiers existed sits in no seat.
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'ACTIVE', tier: null }),
      );

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toThrow('TIER_TOO_LOW');
    });

    /**
     * The regression this guard must not cause. Independent students hold no
     * tier and no center, and they have the exam module today.
     */
    it('admits a student no center has EVER governed', async () => {
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'NONE', tier: null, wasGoverned: false }),
      );

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).resolves.toBe(true);
    });

    /**
     * The paywall bypass this closes.
     *
     * `remove` releases a student by nulling `center_id` and keeping the
     * account, so they used to come back as simply "ungoverned" and be
     * admitted. A center could therefore provision a student, let them
     * activate, release them — freeing the seat, since the seat check counts
     * only students still carrying a center — and the released student kept
     * the exam module for nothing. Revenue loss scaling with roster size,
     * through a first-class UI action that looks like roster management.
     *
     * A genuine independent student is unaffected: they were never governed.
     */
    it('refuses a student a center RELEASED', async () => {
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'NONE', tier: null, wasGoverned: true }),
      );

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toThrow('TIER_TOO_LOW');
    });

    it('leaves a guest token to the guard whose job that is', async () => {
      // A guest has no row and never held a tier, so by this guard's rule it
      // is admitted — and that is deliberate. Guests reach the exam module
      // today, and whether a demo should include it is a product question
      // about guests, not about tiers. What a guest must not reach is an
      // operation that SPENDS money: `GuestBlockGuard` refuses speaking, and
      // `AiQuotaService` refuses anything it cannot meter.
      //
      // Keeping the two questions apart is why this guard does not grow a
      // guest branch it would then own the meaning of.
      entitlement.forStudent.mockResolvedValue(
        entitled({
          status: 'NONE',
          tier: null,
          wasGoverned: false,
          studentExists: false,
        }),
      );

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).resolves.toBe(true);
    });

    it('admits a request carrying no student at all', async () => {
      // Nobody to look up. Whether an anonymous caller may reach a route is a
      // different question, answered by JwtAuthGuard.
      await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
      expect(entitlement.forStudent).not.toHaveBeenCalled();
    });
  });

  describe('the refusal is useful', () => {
    it('says what the student holds and what the route needs', async () => {
      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'START' }));

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: 'TIER_TOO_LOW',
          tier: 'START',
          requiredTier: 'PRO',
        }),
      });
    });

    it('reports a null tier as null rather than inventing one', async () => {
      entitlement.forStudent.mockResolvedValue(
        entitled({ status: 'ACTIVE', tier: null }),
      );

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ tier: null, requiredTier: 'PRO' }),
      });
    });

    it('is a 403, not a 401', async () => {
      // The student is perfectly authenticated. Telling them to log in again
      // would send them round a loop that cannot help.
      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'START' }));

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('it cannot pass by accident', () => {
    it('reads the entitlement itself when nothing has already', async () => {
      // Not dependent on StudentSubscriptionGuard having run first. A guard
      // that only reads what another guard left behind passes everyone the
      // moment someone reorders the decorators.
      await guard.canActivate(contextFor({ student: { studentId: 's1' } }));

      expect(entitlement.forStudent).toHaveBeenCalledWith('s1');
    });

    it('reuses an entitlement already on the request', async () => {
      const request = {
        student: { studentId: 's1' },
        subscription: entitled({ tier: 'PREMIUM' }),
      };

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      // One lookup per request, not one per guard.
      expect(entitlement.forStudent).not.toHaveBeenCalled();
    });

    it('still refuses using an entitlement left by another guard', async () => {
      const request = {
        student: { studentId: 's1' },
        subscription: entitled({ tier: 'START' }),
      };

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        'TIER_TOO_LOW',
      );
    });

    it('refuses rather than passing when the lookup fails', async () => {
      entitlement.forStudent.mockRejectedValue(new Error('offline'));

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } })),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('admits everyone when a route requires no tier', async () => {
      // The guard is only meaningful with the decorator. Without it the route
      // has no tier requirement, and inventing one would gate routes nobody
      // meant to gate.
      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'START' }));

      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } }, null)),
      ).resolves.toBe(true);
    });
  });

  describe('the tier order', () => {
    it('admits Premium where Pro is required, but not the reverse', async () => {
      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'PREMIUM' }));
      await expect(
        guard.canActivate(contextFor({ student: { studentId: 's1' } }, 'PRO')),
      ).resolves.toBe(true);

      entitlement.forStudent.mockResolvedValue(entitled({ tier: 'PRO' }));
      await expect(
        guard.canActivate(
          contextFor({ student: { studentId: 's1' } }, 'PREMIUM'),
        ),
      ).rejects.toThrow('TIER_TOO_LOW');
    });
  });
});
