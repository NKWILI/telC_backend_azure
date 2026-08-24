/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

const withSubscription = (overrides: Record<string, unknown>) => ({
  center_id: 'center-1',
  center: {
    subscription: {
      plan: 'TRIAL',
      seats: 3,
      trial_started_at: null,
      trial_ends_at: null,
      paid_until: null,
      ...overrides,
    },
  },
});

describe('StudentEntitlementService', () => {
  let prisma: any;
  let service: StudentEntitlementService;

  beforeEach(() => {
    prisma = { student: { findUnique: jest.fn() } };
    service = new StudentEntitlementService(
      prisma,
      new SubscriptionPolicyService(),
    );
  });

  it('reports a live trial', async () => {
    prisma.student.findUnique.mockResolvedValue(
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
    prisma.student.findUnique.mockResolvedValue(
      withSubscription({ paid_until: daysFromNow(-8) }),
    );

    await expect(service.forStudent('student-1')).resolves.toMatchObject({
      status: 'BLOCKED',
      studentsMayLearn: false,
    });
  });

  it('reports when grace ends, so a client can say what is about to happen', async () => {
    prisma.student.findUnique.mockResolvedValue(
      withSubscription({ paid_until: daysFromNow(-2) }),
    );

    const entitlement = await service.forStudent('student-1');

    expect(entitlement.status).toBe('GRACE_PERIOD');
    expect(entitlement.graceEndsAt).toBeInstanceOf(Date);
  });

  describe('students no center governs', () => {
    it('reports NONE rather than blocked for a student with no center', async () => {
      prisma.student.findUnique.mockResolvedValue({
        center_id: null,
        center: null,
      });

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
      prisma.student.findUnique.mockResolvedValue(null);

      await expect(service.forStudent('student-1')).resolves.toMatchObject({
        status: 'NONE',
        studentsMayLearn: true,
      });
    });
  });

  it('fails closed when a center somehow has no subscription row', async () => {
    prisma.student.findUnique.mockResolvedValue({
      center_id: 'center-1',
      center: { subscription: null },
    });

    await expect(service.forStudent('student-1')).resolves.toMatchObject({
      status: 'BLOCKED',
      studentsMayLearn: false,
    });
  });

  it('lets a database failure surface, rather than inventing an answer', async () => {
    prisma.student.findUnique.mockRejectedValue(new Error('connection lost'));

    // The caller decides what an outage means: the guard turns it into a 503,
    // and login omits the field rather than refusing a valid sign-in.
    await expect(service.forStudent('student-1')).rejects.toThrow(
      'connection lost',
    );
  });

  it('costs one query', async () => {
    prisma.student.findUnique.mockResolvedValue(
      withSubscription({ paid_until: daysFromNow(30) }),
    );

    await service.forStudent('student-1');

    expect(prisma.student.findUnique).toHaveBeenCalledTimes(1);
  });
});
