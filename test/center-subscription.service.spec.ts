/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { NotFoundException } from '@nestjs/common';
import { CenterSubscriptionService } from '../src/modules/centers/center-subscription.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

describe('CenterSubscriptionService', () => {
  const identity = { centerUserId: 'owner-1', centerId: 'center-1' } as never;
  const DAY = 24 * 60 * 60 * 1000;

  const row = (over: Record<string, unknown> = {}) => ({
    plan: 'TRIAL',
    seats: 3,
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
      },
      get deviceSession(): never {
        throw new Error('Student sessions must never be touched here');
      },
    };
    service = new CenterSubscriptionService(
      prisma,
      new SubscriptionPolicyService(),
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
        seats: 3,
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

  describe('getUsage', () => {
    it('counts only students belonging to the signed center', async () => {
      await service.getUsage(identity);

      expect(prisma.student.count).toHaveBeenCalledWith({
        where: { center_id: 'center-1' },
      });
    });

    it('reports used, limit and available together', async () => {
      prisma.student.count.mockResolvedValue(2);

      await expect(service.getUsage(identity)).resolves.toEqual({
        seatsUsed: 2,
        seatsLimit: 3,
        seatsAvailable: 1,
        status: 'TRIAL_PENDING',
      });
    });

    it('takes the limit from the column, with no status-dependent branch', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        row({
          plan: 'PAID',
          seats: 25,
          paid_until: new Date(Date.now() + DAY),
        }),
      );
      prisma.student.count.mockResolvedValue(10);

      const result = await service.getUsage(identity);

      expect(result.seatsLimit).toBe(25);
      expect(result.seatsAvailable).toBe(15);
      expect(result.status).toBe('ACTIVE');
    });

    it('reports zero available rather than a negative when over the limit', async () => {
      // A center that drops from ten seats to five keeps its students; being
      // over the limit blocks new provisioning, it does not evict anyone.
      prisma.centerSubscription.findUnique.mockResolvedValue(row({ seats: 5 }));
      prisma.student.count.mockResolvedValue(10);

      const result = await service.getUsage(identity);

      expect(result.seatsUsed).toBe(10);
      expect(result.seatsLimit).toBe(5);
      expect(result.seatsAvailable).toBe(0);
    });

    it('keeps reporting the seat limit while blocked', async () => {
      prisma.centerSubscription.findUnique.mockResolvedValue(
        row({
          plan: 'PAID',
          seats: 10,
          paid_until: new Date(Date.now() - 30 * DAY),
        }),
      );
      prisma.student.count.mockResolvedValue(4);

      const result = await service.getUsage(identity);

      expect(result.status).toBe('BLOCKED');
      expect(result.seatsLimit).toBe(10);
      expect(result.seatsUsed).toBe(4);
    });
  });
});
