import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { CenterTierContext } from './pricing.service';

/**
 * Loads what a center holds, per tier: the price it has already agreed to and
 * how many students sit in that tier.
 *
 * Its own service because two callers need exactly this — quoting and creating
 * a payment — and written twice the two copies would drift. `PricingService`
 * stays pure and takes the result as an argument, the same split as
 * `SubscriptionPolicyService` and `StudentEntitlementService`.
 */
@Injectable()
export class CenterSeatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Two queries rather than four: the seat rows carry the stamped prices, and
   * one grouped count covers every tier at once instead of a count per tier.
   */
  async tierContextFor(centerId: string): Promise<CenterTierContext> {
    const [seats, studentsByTier] = await Promise.all([
      this.prisma.centerSeat.findMany({
        where: { center_id: centerId },
        select: { tier: true, unit_price_xaf: true },
      }),
      this.prisma.student.groupBy({
        by: ['tier'],
        where: { center_id: centerId },
        _count: { _all: true },
      }),
    ]);

    const context: CenterTierContext = {};

    for (const seat of seats) {
      context[seat.tier] = {
        stampedPriceXaf: seat.unit_price_xaf,
        studentCount: 0,
      };
    }

    for (const group of studentsByTier) {
      // A student carrying no tier sits in no seat, so there is nothing to
      // count them against. That is anyone provisioned before tiers existed,
      // and anyone whose center was deleted — the tier survives that delete,
      // so it must never be trusted without a center.
      if (!group.tier) continue;

      context[group.tier] = {
        stampedPriceXaf: context[group.tier]?.stampedPriceXaf ?? null,
        studentCount: group._count._all,
      };
    }

    return context;
  }
}
