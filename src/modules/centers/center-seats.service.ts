import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import type { CenterPricingContext } from './pricing.service';

/**
 * The part of the client this loader touches.
 *
 * Structural rather than `PrismaService` so a transaction client satisfies it
 * too. Pricing a payment has to read seats and students inside the same
 * transaction that writes the payment, or the price and the student floor are
 * decided against a snapshot that can move before the insert lands.
 */
export type SeatContextReader = Pick<
  PrismaService,
  'center' | 'centerSeat' | 'student'
>;

/**
 * Loads what a center holds: the prices it has already agreed to, per tier,
 * and how many students it has to seat.
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
   * Three queries: the center itself, which also yields the total student
   * count; the seat rows, which carry the stamped prices; and one grouped
   * count that covers every tier at once instead of a count per tier.
   *
   * `client` exists so a caller can read inside its own transaction. Quoting
   * passes nothing, because a quote is a question and a stale answer to it
   * costs nothing; creating a payment passes its transaction, because the
   * price it reads is the price the center is charged.
   */
  async pricingContextFor(
    centerId: string,
    client: SeatContextReader = this.prisma,
  ): Promise<CenterPricingContext> {
    const [center, seats, studentsByTier] = await Promise.all([
      // Existence and the student body in one read. A center token can outlive
      // its center — the auth guard has a cache that does not recheck the row
      // — and without this the missing center surfaces as a foreign-key error
      // at insert, which reaches the client as a 500 instead of a 404.
      client.center.findUnique({
        where: { id: centerId },
        select: { _count: { select: { students: true } } },
      }),
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

    if (!center) {
      throw new NotFoundException('CENTER_NOT_FOUND');
    }

    const tiers: CenterPricingContext['tiers'] = {};

    for (const seat of seats) {
      tiers[seat.tier] = {
        stampedPriceXaf: seat.unit_price_xaf,
        studentCount: 0,
      };
    }

    for (const group of studentsByTier) {
      // A student carrying no tier sits in no particular tier's seats, so
      // there is nothing to count them against here. They are counted in
      // `totalStudents` below, because they still occupy a seat — and today
      // that is every student, since nothing writes `students.tier` yet.
      if (!group.tier) continue;

      tiers[group.tier] = {
        stampedPriceXaf: tiers[group.tier]?.stampedPriceXaf ?? null,
        studentCount: group._count._all,
      };
    }

    return { tiers, totalStudents: center._count.students };
  }
}
