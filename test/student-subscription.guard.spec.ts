/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StudentSubscriptionGuard } from '../src/shared/guards/student-subscription.guard';
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionRecord,
} from '../src/modules/centers/subscription-policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => new Date();
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

/**
 * The real policy service is used rather than a mock. It is pure, and the point
 * of this guard is that it agrees with the policy — a mocked policy would prove
 * only that the guard calls something.
 */
const subscription = (
  overrides: Partial<CenterSubscriptionRecord>,
): CenterSubscriptionRecord => ({
  plan: 'TRIAL' as CenterSubscriptionRecord['plan'],
  seats: 3,
  trial_started_at: null,
  trial_ends_at: null,
  paid_until: null,
  ...overrides,
});

describe('StudentSubscriptionGuard', () => {
  let prisma: any;
  let policy: SubscriptionPolicyService;
  let guard: StudentSubscriptionGuard;
  let request: any;

  /** Shapes the row the guard is expected to select in a single query. */
  const studentRow = (
    centerId: string | null,
    sub: CenterSubscriptionRecord | null,
  ) => ({
    center_id: centerId,
    center: centerId ? { subscription: sub } : null,
  });

  const contextFor = (student: unknown): ExecutionContext => {
    request = { student };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  };

  const authenticated = contextFor;

  beforeEach(() => {
    prisma = {
      student: { findUnique: jest.fn() },
    };
    policy = new SubscriptionPolicyService();
    // The real entitlement service, not a mock: these tests are about the
    // guard agreeing with the actual rule, and a mocked lookup would prove
    // only that the guard calls something.
    guard = new StudentSubscriptionGuard(
      new StudentEntitlementService(prisma, policy),
    );
  });

  const givenStudent = (
    centerId: string | null,
    sub: CenterSubscriptionRecord | null,
  ) => {
    prisma.student.findUnique.mockResolvedValue(studentRow(centerId, sub));
  };

  describe('states that may learn', () => {
    it('admits a student whose center is on trial', async () => {
      givenStudent(
        'center-1',
        subscription({
          trial_started_at: daysFromNow(-3),
          trial_ends_at: daysFromNow(27),
        }),
      );

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).resolves.toBe(true);
    });

    it('admits a student whose center has paid', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(30) }));

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).resolves.toBe(true);
    });

    it('admits a student whose center is inside the grace period', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(-2) }));

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).resolves.toBe(true);
    });
  });

  describe('states that may not learn', () => {
    it('refuses once the trial has ended', async () => {
      givenStudent(
        'center-1',
        subscription({
          trial_started_at: daysFromNow(-31),
          trial_ends_at: daysFromNow(-1),
        }),
      );

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses once grace has run out on a lapsed payment', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(-8) }));

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses while the trial has not started (TRIAL_PENDING)', async () => {
      givenStudent('center-1', subscription({}));

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses with SUBSCRIPTION_INACTIVE, distinct from an auth failure', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(-8) }));

      const error = await guard
        .canActivate(authenticated({ studentId: 'student-1' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        message: 'SUBSCRIPTION_INACTIVE',
      });
    });

    it('reports the status so a client can offer the student a way to continue', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(-8) }));

      const error = await guard
        .canActivate(authenticated({ studentId: 'student-1' }))
        .catch((e: unknown) => e);

      expect((error as ForbiddenException).getResponse()).toMatchObject({
        subscriptionStatus: 'BLOCKED',
      });
    });
  });

  describe('students no subscription governs', () => {
    it('admits a student who belongs to no center', async () => {
      givenStudent(null, null);

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).resolves.toBe(true);
    });

    it('admits a guest, who belongs to no center', async () => {
      // A real guest token carries a real studentId (TokenService
      // .generateGuestAccessToken), so the guard looks the row up like any
      // other. Guests have no center, so they pass on that basis rather than
      // by skipping the check.
      givenStudent(null, null);
      const context = authenticated({
        studentId: 'guest-student-1',
        deviceId: 'guest',
        isGuest: true,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('skips the lookup only when a token names no student at all', async () => {
      const context = authenticated({ deviceId: 'device-1' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
    });

    it('admits when the student row is gone; identity is not this guard to police', async () => {
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).resolves.toBe(true);
    });
  });

  describe('failure directions', () => {
    it('refuses a student whose center has no subscription row at all', async () => {
      // Every center is created with one. If it is missing, that is a data
      // fault, and the safe direction is to refuse rather than hand out access
      // that no row authorises.
      givenStudent('center-1', null);

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('answers 503 when the database is unreachable, never a silent pass', async () => {
      prisma.student.findUnique.mockRejectedValue(new Error('connection lost'));

      const error = await guard
        .canActivate(authenticated({ studentId: 'student-1' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error).not.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the guard defers to the policy service', () => {
    it('asks the policy service rather than comparing dates itself', async () => {
      const record = subscription({
        trial_started_at: daysFromNow(-3),
        trial_ends_at: daysFromNow(27),
      });
      givenStudent('center-1', record);
      const evaluate = jest.spyOn(policy, 'evaluate');

      await guard.canActivate(authenticated({ studentId: 'student-1' }));

      expect(evaluate).toHaveBeenCalledWith(record);
    });

    it('costs exactly one query per request', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(30) }));

      await guard.canActivate(authenticated({ studentId: 'student-1' }));

      expect(prisma.student.findUnique).toHaveBeenCalledTimes(1);
    });

    it('reads the subscription in that same query, not a second one', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(30) }));

      await guard.canActivate(authenticated({ studentId: 'student-1' }));

      const [args] = prisma.student.findUnique.mock.calls[0];
      expect(args.where).toEqual({ id: 'student-1' });
      expect(args.select.center.select.subscription).toBeDefined();
    });

    it('leaves the decision on the request for handlers to report', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(30) }));

      await guard.canActivate(authenticated({ studentId: 'student-1' }));

      expect(request.subscription).toMatchObject({
        status: 'ACTIVE',
        studentsMayLearn: true,
      });
    });
  });

  it('does not depend on the current clock being passed in', async () => {
    givenStudent(
      'center-1',
      subscription({ trial_started_at: daysFromNow(-1), trial_ends_at: now() }),
    );

    await expect(
      guard.canActivate(authenticated({ studentId: 'student-1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
