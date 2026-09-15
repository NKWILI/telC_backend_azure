/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { NotFoundException } from '@nestjs/common';
import { CenterSubscriptionService } from '../src/modules/centers/center-subscription.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { PricingService } from '../src/modules/centers/pricing.service';
import { CenterSeatsService } from '../src/modules/centers/center-seats.service';

describe('CenterSubscriptionService', () => {
  const identity = { centerUserId: 'owner-1', centerId: 'center-1' } as never;
  const DAY = 24 * 60 * 60 * 1000;

  const row = (over: Record<string, unknown> = {}) => ({
    plan: 'TRIAL',
    trial_started_at: null,
    trial_ends_at: null,
    paid_until: null,
    ...over,
  });

  let prisma: any;
  let service: CenterSubscriptionService;

  beforeEach(() => {
    prisma = {
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue(row()),
      },
      student: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      centerSeat: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      center: {
        // Existence plus the student body, which is what sets the floor a
        // quote cannot go under.
        findUnique: jest.fn().mockResolvedValue({ _count: { students: 0 } }),
      },
      get deviceSession(): never {
        throw new Error('Student sessions must never be touched here');
      },
    };
    service = new CenterSubscriptionService(
      prisma,
      new SubscriptionPolicyService(),
      new PricingService(),
      // A real one over the mocked client, not a stub. `quote` is only
      // meaningful if the context it prices from is really loaded, and passing
      // a stub here is how this spec came to construct the service with three
      // of its four dependencies and still pass.
      new CenterSeatsService(prisma),
    );
  });

  describe('getSubscription', () => {
    it('reads only the signed center', async () => {
      await service.getSubscription(identity);

      expect(prisma.centerSubscription.findUnique).toHaveBeenCalledWith({
        where: { center_id: 'center-1' },
      });
    });

    it('returns the derived status alongside the stored facts', async () => {
      const result = await service.getSubscription(identity);

      expect(result).toEqual({
        status: 'TRIAL_PENDING',
        plan: 'TRIAL',
        seatsHeld: 0,
        trialStartedAt: null,
        trialEndsAt: null,
        paidUntil: null,
        graceEndsAt: null,
        studentsMayLearn: false,
      });
    });

    it('exposes no database ids or raw column names', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue({
        ...row(),
        id: 'subscription-secret-id',
        center_id: 'center-1',
        created_at: new Date(),
      });

      const result = await service.getSubscription(identity);

      expect(JSON.stringify(result)).not.toContain('subscription-secret-id');
      expect(Object.keys(result)).not.toContain('center_id');
      expect(Object.keys(result)).not.toContain('id');
    });

    it('treats a missing subscription as a fault, not a supported state', async () => {
      // Every center gets one at registration and the migration backfilled the
      // rest, so absence means something is wrong rather than "not set up yet".
      prisma.centerSubscription.findUnique.mockResolvedValue(null);

      await expect(service.getSubscription(identity)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  /**
   * The seat limit now comes from the seat rows, because that is where seats
   * live. `CenterSubscription.seats` held a second, rival number: two places
   * each claiming to know a center's seat count, and nobody reading the code
   * able to say which was true. A stale number that still looks authoritative
   * is worse than no number, because it eventually reaches an invoice.
   */
  describe('the seat limit comes from center_seats', () => {
    it('sums the quantities the center holds', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 7 },
        { tier: 'PRO', quantity: 3 },
      ]);

      const result = await service.getUsage(identity);

      expect(result.seatsLimit).toBe(10);
    });

    it('reports no seats for a center holding none', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([]);

      const result = await service.getUsage(identity);

      expect(result.seatsLimit).toBe(0);
      expect(result.seatsAvailable).toBe(0);
    });

    it('reads the seat rows of the signed center only', async () => {
      await service.getUsage(identity);

      expect(prisma.centerSeat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { center_id: 'center-1' } }),
      );
    });

    it('breaks the count down per tier, since a seat belongs to one', async () => {
      // "Two seats left" is useless to a center holding three tiers and full
      // in one of them — which is exactly what provisioning now refuses on.
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 2 },
        { tier: 'PRO', quantity: 5 },
      ]);
      prisma.student.groupBy.mockResolvedValue([
        { tier: 'START', _count: { _all: 2 } },
        { tier: 'PRO', _count: { _all: 1 } },
      ]);

      const result = await service.getUsage(identity);

      expect(result.perTier).toEqual([
        { tier: 'START', seatsHeld: 2, seatsUsed: 2, seatsAvailable: 0 },
        { tier: 'PRO', seatsHeld: 5, seatsUsed: 1, seatsAvailable: 4 },
      ]);
    });

    it('lists tiers cheapest first, so a dashboard does not reshuffle', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'PREMIUM', quantity: 1 },
        { tier: 'START', quantity: 1 },
        { tier: 'PRO', quantity: 1 },
      ]);

      const result = await service.getUsage(identity);

      expect(result.perTier.map((t) => t.tier)).toEqual([
        'START',
        'PRO',
        'PREMIUM',
      ]);
    });

    it('omits a tier the center holds no seats in', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 1 },
      ]);

      const result = await service.getUsage(identity);

      expect(result.perTier).toHaveLength(1);
    });

    it('counts a tier with students but no seats, rather than hiding it', async () => {
      // A center that dropped a tier while students still sat in it. Hiding
      // the row would hide the overage the dashboard needs to show.
      prisma.centerSeat.findMany.mockResolvedValue([]);
      prisma.student.groupBy.mockResolvedValue([
        { tier: 'PRO', _count: { _all: 3 } },
      ]);

      const result = await service.getUsage(identity);

      expect(result.perTier).toEqual([
        { tier: 'PRO', seatsHeld: 0, seatsUsed: 3, seatsAvailable: 0 },
      ]);
    });
  });

  describe('the subscription view no longer carries a rival seat count', () => {
    it('reports seats held, drawn from the seat rows', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 4 },
      ]);

      const view = await service.getSubscription(identity);

      expect(view.seatsHeld).toBe(4);
      // The old column is gone, not renamed in place.
      expect(view).not.toHaveProperty('seats');
    });
  });

  describe('getUsage', () => {
    it('counts only students belonging to the signed center', async () => {
      await service.getUsage(identity);

      expect(prisma.student.count).toHaveBeenCalledWith({
        where: { center_id: 'center-1' },
      });
    });

    it('reports used, limit and available together', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 3 },
      ]);
      prisma.student.count.mockResolvedValue(2);
      prisma.student.groupBy.mockResolvedValue([
        { tier: 'START', _count: { _all: 2 } },
      ]);

      await expect(service.getUsage(identity)).resolves.toEqual({
        seatsUsed: 2,
        seatsLimit: 3,
        seatsAvailable: 1,
        unassignedSeatsUsed: 0,
        perTier: [
          { tier: 'START', seatsHeld: 3, seatsUsed: 2, seatsAvailable: 1 },
        ],
        status: 'TRIAL_PENDING',
      });
    });

    it('reports legacy students with no tier outside the tier breakdown', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 3 },
      ]);
      prisma.student.count.mockResolvedValue(3);
      prisma.student.groupBy.mockResolvedValue([
        { tier: 'START', _count: { _all: 2 } },
        { tier: null, _count: { _all: 1 } },
      ]);

      const result = await service.getUsage(identity);

      expect(result.unassignedSeatsUsed).toBe(1);
      expect(
        result.perTier.reduce((sum, row) => sum + row.seatsUsed, 0) +
          result.unassignedSeatsUsed,
      ).toBe(result.seatsUsed);
    });

    it('takes the limit from the seat rows, with no status-dependent branch', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        row({ plan: 'PAID', paid_until: new Date(Date.now() + DAY) }),
      );
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 20 },
        { tier: 'PRO', quantity: 5 },
      ]);
      prisma.student.count.mockResolvedValue(10);

      const result = await service.getUsage(identity);

      expect(result.seatsLimit).toBe(25);
      expect(result.seatsAvailable).toBe(15);
      expect(result.status).toBe('ACTIVE');
    });

    it('reports zero available rather than a negative when over the limit', async () => {
      // A center that drops from ten seats to five keeps its students; being
      // over the limit blocks new provisioning, it does not evict anyone.
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 5 },
      ]);
      prisma.student.count.mockResolvedValue(10);

      const result = await service.getUsage(identity);

      expect(result.seatsUsed).toBe(10);
      expect(result.seatsLimit).toBe(5);
      expect(result.seatsAvailable).toBe(0);
    });

    it('keeps reporting the seat limit while blocked', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        row({ plan: 'PAID', paid_until: new Date(Date.now() - 30 * DAY) }),
      );
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', quantity: 10 },
      ]);
      prisma.student.count.mockResolvedValue(4);

      const result = await service.getUsage(identity);

      expect(result.status).toBe('BLOCKED');
      expect(result.seatsLimit).toBe(10);
      expect(result.seatsUsed).toBe(4);
    });
  });
  /**
   * The quote path had no test of its own at all: the controller spec mocks
   * this service away, and this spec could not reach `quote` because it built
   * the service without its seat loader. That is how a missing constructor
   * argument sat in two specs with the suite green — ts-jest transpiles without
   * type-checking, so `Expected 4 arguments, but got 3` failed nothing.
   */
  describe('quote', () => {
    it('prices the signed center own holdings, never a center named by the caller', async () => {
      prisma.centerSeat.findMany.mockResolvedValue([
        { tier: 'START', unit_price_xaf: 3800 },
      ]);

      const result = await service.quote(identity, { START: 10 });

      expect(prisma.centerSeat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { center_id: 'center-1' } }),
      );
      // The stamped price, not the list price: proof the context was really
      // loaded and handed to pricing.
      expect(result.lines[0].unitPriceXaf).toBe(3800);
      expect(result.totalXaf).toBe(38000);
    });

    it('charges list price to a center holding nothing yet', async () => {
      const result = await service.quote(identity, { START: 5, PRO: 5 });

      expect(result.totalXaf).toBe(5 * 4500 + 5 * 10000);
      expect(result.totalSeats).toBe(10);
    });

    it('counts existing students, so a mix cannot strand them', async () => {
      prisma.student.groupBy.mockResolvedValue([
        { tier: 'PRO', _count: { _all: 6 } },
      ]);

      await expect(service.quote(identity, { START: 10 })).rejects.toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });

    /**
     * A center token can outlive its center: the auth guard caches the
     * identity and does not recheck the row. `dev` answered 404 here. Losing
     * the check turned a deleted center into a foreign-key error at insert on
     * the payment path — a 500 — and into a cheerful list-price quote on this
     * one, while the controller still documents 404.
     */
    it('refuses a token whose center no longer exists', async () => {
      prisma.center.findUnique.mockResolvedValue(null);

      await expect(service.quote(identity, { START: 10 })).rejects.toThrow(
        'CENTER_NOT_FOUND',
      );
    });

    it('refuses fewer seats than the center has students, tier or no tier', async () => {
      // The floor that must hold before provisioning assigns any tier. Today
      // every student is untiered, so a per-tier count alone reads as zero.
      prisma.center.findUnique.mockResolvedValue({
        _count: { students: 40 },
      });

      await expect(service.quote(identity, { START: 10 })).rejects.toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });

    it('does not read the subscription row to quote', async () => {
      // Pricing depends on seats and students, not on subscription status, so
      // a blocked or lapsed center can still be quoted.
      await service.quote(identity, { START: 10 });

      expect(prisma.centerSubscription.findUnique).not.toHaveBeenCalled();
    });
  });
});
