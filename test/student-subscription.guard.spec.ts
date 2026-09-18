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
  ) => ({ center_id: centerId, ...(sub ?? { plan: null }) });

  const contextFor = (student: unknown): ExecutionContext => {
    request = { student };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
  };

  const authenticated = contextFor;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
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
    prisma.$queryRaw.mockResolvedValue([studentRow(centerId, sub)]);
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

    it('refuses with ACTIVATION_REQUIRED and a reason, distinct from an auth failure', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(-8) }));

      const error = await guard
        .canActivate(authenticated({ studentId: 'student-1' }))
        .catch((e: unknown) => e);

      // One code the app catches everywhere, sending the student to the
      // activation screen; the reason picks the sentence it shows (D19).
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        message: 'ACTIVATION_REQUIRED',
        reason: 'CENTER_UNPAID',
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
    it('admits a student who was using the app on their own before codes were required', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { center_id: null, plan: null, tier: null, grandfathered_access: true },
      ]);

      await expect(
        guard.canActivate(authenticated({ studentId: 'student-1' })),
      ).resolves.toBe(true);
    });

    it('sends a new account with no code to the activation screen', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          center_id: null,
          plan: null,
          tier: null,
          grandfathered_access: false,
        },
      ]);

      const error = await guard
        .canActivate(authenticated({ studentId: 'student-1' }))
        .catch((e: unknown) => e);

      expect((error as ForbiddenException).getResponse()).toMatchObject({
        message: 'ACTIVATION_REQUIRED',
        reason: 'NO_CODE',
      });
    });

    it('admits a guest, which writes no student row, until guest mode is decided', async () => {
      // `/api/auth/guest` mints an id and writes nothing, so the lookup finds
      // no row. Whether guests should learn at all is B16, still open; until
      // then they keep the access they have today.
      prisma.$queryRaw.mockResolvedValue([]);
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
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('admits when the student row is gone; identity is not this guard to police', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

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
      prisma.$queryRaw.mockRejectedValue(new Error('connection lost'));

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

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('joins the subscription in, rather than fetching it separately', async () => {
      givenStudent('center-1', subscription({ paid_until: daysFromNow(30) }));

      await guard.canActivate(authenticated({ studentId: 'student-1' }));

      // The SQL is asserted because the Prisma-shaped version of this lookup
      // passed a "one call" check while issuing three statements: students,
      // then centers, then center_subscriptions. Counting calls cannot see
      // that; the join can only be checked by looking at the query.
      const [sql, param] = prisma.$queryRaw.mock.calls[0];
      const text = Array.isArray(sql) ? sql.join('?') : String(sql);

      expect(text).toMatch(/LEFT JOIN\s+center_subscriptions/i);
      expect(text).not.toMatch(/\bFROM\s+centers\b/i);
      expect(param).toBe('student-1');
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
