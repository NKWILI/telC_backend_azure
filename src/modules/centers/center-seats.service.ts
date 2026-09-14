import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { CenterTierContext } from './pricing.service';

/**
 * The part of the client this loader touches.
 *
 * Structural rather than `PrismaService` so a transaction client satisfies it
 * too. Pricing a payment has to read seats and students inside the same
 * transaction that writes the payment, or the price and the student floor are
 * decided against a snapshot that can move before the insert lands.
 */
export type SeatContextReader = Pick<PrismaService, 'centerSeat' | 'student'>;

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
   *
   * `client` exists so a caller can read inside its own transaction. Quoting
   * passes nothing, because a quote is a question and a stale answer to it
   * costs nothing; creating a payment passes its transaction, because the
   * price it reads is the price the center is charged.
   */
  async tierContextFor(
    centerId: string,
    client: SeatContextReader = this.prisma,
  ): Promise<CenterTierContext> {
    const [seats, studentsByTier] = await Promise.all([
      client.centerSeat.findMany({
        where: { center_id: centerId },
        select: { tier: true, unit_price_xaf: true },
      }),
      client.student.groupBy({
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
