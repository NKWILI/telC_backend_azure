/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

/**
 * One flat row, because the lookup is a single LEFT JOIN rather than a nested
 * Prisma select. The nested version reads as one query and issues three.
 */
const withSubscription = (overrides: Record<string, unknown>) => ({
  center_id: 'center-1',
  plan: 'TRIAL',
  seats: 3,
  trial_started_at: null,
  trial_ends_at: null,
  paid_until: null,
  tier: 'START',
  ...overrides,
});

describe('StudentEntitlementService', () => {
  let prisma: any;
  let service: StudentEntitlementService;

  /** The query returns an array; these helpers keep that detail in one place. */
  const givenRow = (row: unknown): void => {
    prisma.$queryRaw.mockResolvedValue(row ? [row] : []);
  };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    service = new StudentEntitlementService(
      prisma,
      new SubscriptionPolicyService(),
    );
  });

  it('reports a live trial', async () => {
    givenRow(
      withSubscription({
        trial_started_at: daysFromNow(-3),
        trial_ends_at: daysFromNow(27),
      }),
    );

    await expect(service.forStudent('student-1')).resolves.toMatchObject({
      status: 'TRIAL',
      studentsMayLearn: true,
    });
  });

  it('reports a block once a paid period lapses beyond grace', async () => {
    givenRow(withSubscription({ paid_until: daysFromNow(-8) }));

    await expect(service.forStudent('student-1')).resolves.toMatchObject({
      status: 'BLOCKED',
      studentsMayLearn: false,
    });
  });

  it('reports when grace ends, so a client can say what is about to happen', async () => {
    givenRow(withSubscription({ paid_until: daysFromNow(-2) }));

    const entitlement = await service.forStudent('student-1');

    expect(entitlement.status).toBe('GRACE_PERIOD');
    expect(entitlement.graceEndsAt).toBeInstanceOf(Date);
  });

  describe('students no center governs', () => {
    it('reports NONE rather than blocked for a student with no center', async () => {
      givenRow({ center_id: null, plan: null });

      // NONE is distinct from BLOCKED on purpose. A client must be able to
      // tell "you have no school" from "your school stopped paying", because
      // only one of those is worth showing an offer about.
      await expect(service.forStudent('student-1')).resolves.toEqual({
        status: 'NONE',
        studentsMayLearn: true,
        graceEndsAt: null,
        tier: null,
        studentExists: true,
        wasGoverned: false,
      });
    });

    it('reports NONE when the student row is gone', async () => {
      givenRow(null);

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'NONE',
        studentsMayLearn: true,
      });
    });
  });

  /**
   * The tier travels with the entitlement because it is the answer to the
   * second, narrower question: not "may this student learn" but "what may
   * this student do". Both are settled from the one LEFT JOIN that already
   * runs on every learning request.
   */
  describe('the tier', () => {
    it('reports the tier of a governed student', async () => {
      givenRow(withSubscription({ tier: 'PRO' }));

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        tier: 'PRO',
      });
    });

    it('reports no tier for a governed student who carries none', async () => {
      // Provisioned before tiers existed. They sit in no seat, so they hold
      // no tier — which is different from holding the cheapest one.
      givenRow(withSubscription({ tier: null }));

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'TRIAL_PENDING',
        tier: null,
      });
    });

    /**
     * `students.center_id` is ON DELETE SET NULL and `students.tier` is not,
     * so a deleted center leaves the tier behind. Reading it without a center
     * would hand a student Premium for ever on the strength of a row nobody
     * governs.
     */
    it('ignores a tier left behind by a deleted center', async () => {
      givenRow({ center_id: null, tier: 'PREMIUM' });

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'NONE',
        tier: null,
      });
    });

    it('ignores a stale tier when the subscription row is missing too', async () => {
      // Fails closed on status, and must not leak the tier either.
      givenRow({ center_id: 'center-1', plan: null, tier: 'PREMIUM' });

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'BLOCKED',
        studentsMayLearn: false,
        tier: null,
      });
    });
  });

  /**
   * Two different kinds of "no center", which the service used to collapse
   * into one answer.
   *
   * A genuine independent student has a row and no center. A guest token has
   * NO ROW AT ALL — `/api/auth/guest` mints a random uuid and writes nothing.
   * And a student a center released has a row, no center, and a tier left
   * behind by the release.
   *
   * Callers that only ask "may they learn" can treat all three alike. Callers
   * that spend money or gate a paid feature cannot.
   */
  describe('telling the three ungoverned cases apart', () => {
    it('reports a real independent student as existing, never governed', async () => {
      givenRow({ center_id: null, tier: null });

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'NONE',
        studentExists: true,
        wasGoverned: false,
      });
    });

    it('reports a guest token as not existing at all', async () => {
      // No row. Nothing can be attributed to this id — an ai_usage insert for
      // it fails on the foreign key — so a caller that meters must be able to
      // see that rather than being handed a cheerful allowance.
      givenRow(null);

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'NONE',
        studentExists: false,
        wasGoverned: false,
      });
    });

    it('reports a released student as formerly governed', async () => {
      // center_id is SET NULL on release while tier is not, so a leftover
      // tier is evidence that a center once governed this student. It is used
      // as evidence only — `tier` itself stays null, so nothing grants access
      // on the strength of it.
      givenRow({ center_id: null, tier: 'PREMIUM' });

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'NONE',
        studentExists: true,
        wasGoverned: true,
        tier: null,
      });
    });

    it('reports a governed student as governed', async () => {
      givenRow(withSubscription({ tier: 'PRO' }));

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        studentExists: true,
        wasGoverned: true,
      });
    });
  });

  it('fails closed when a center somehow has no subscription row', async () => {
    givenRow({ center_id: 'center-1', plan: null });

    await expect(service.forStudent('student-1')).resolves.toMatchObject({
      status: 'BLOCKED',
      studentsMayLearn: false,
    });
  });

  it('lets a database failure surface, rather than inventing an answer', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection lost'));

    // The caller decides what an outage means: the guard turns it into a 503,
    // and login omits the field rather than refusing a valid sign-in.
    await expect(service.forStudent('student-1')).rejects.toThrow(
      'connection lost',
    );
  });

  it('costs one query', async () => {
    givenRow(withSubscription({ paid_until: daysFromNow(30) }));

    await service.forStudent('student-1');

    // One statement, not one Prisma call. A nested `select` would satisfy the
    // latter while issuing three round trips.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
