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
