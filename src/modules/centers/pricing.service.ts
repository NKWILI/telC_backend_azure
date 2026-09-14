import { BadRequestException, Injectable } from '@nestjs/common';
import type { Tier } from '@prisma/client';

/**
 * What each tier costs, per seat per month, in whole XAF.
 *
 * Constants rather than a database table on purpose: git then carries a free
 * history of when a price changed and why, a change gets a review instead of
 * an UPDATE someone runs at night, and three tiers changing twice a year does
 * not justify an admin surface.
 *
 * START is a launch price. It rises to 4,800 once the first centers are
 * signed, and every center already holding Start keeps 4,500, because the
 * price they agreed to is stamped on their seat row rather than read from
 * here.
 */
export const TIER_PRICES_XAF: Record<Tier, number> = {
  START: 4_500,
  PRO: 10_000,
  PREMIUM: 20_000,
};

/**
 * Cheapest first. This is the order a quote lists its lines in, so a cart
 * cannot reshuffle between two requests over the same mix.
 */
const TIER_ORDER: readonly Tier[] = ['START', 'PRO', 'PREMIUM'];

/**
 * The fewest seats a paid plan may buy, counted across every tier rather than
 * within one.
 *
 * Ten per tier would mean a school with twelve students, two of them sitting
 * the exam, had to buy ten Pro seats to cover those two. That is 100,000 XAF
 * for two students, and the school would simply decline Pro. The floor exists
 * to set a contract minimum, not to make the middle tier unreachable.
 */
export const MIN_PAID_SEATS_TOTAL = 10;

/**
 * The largest order this service will price, across all tiers.
 *
 * `amount_xaf` is a Postgres INTEGER, so it stops at 2,147,483,647. At 20,000
 * a Premium seat that ceiling arrives around 107,000 seats — reachable by
 * mistyping — and the failure would be a database error at insert rather than
 * a refusal anyone could act on.
 */
export const MAX_SEATS_TOTAL = 10_000;

/** Seats wanted per tier. A tier absent or zero is simply not being bought. */
export type SeatMix = Partial<Record<Tier, number>>;

export interface TierContext {
  /**
   * The price already stamped on this center's seat row for this tier, or null
   * if it holds none of this tier yet.
   */
  stampedPriceXaf: number | null;
  /** Students already provisioned in this tier. */
  studentCount: number;
}

/** What pricing needs to know about a center. Nothing else about it matters. */
export type CenterTierContext = Partial<Record<Tier, TierContext>>;

export interface QuoteLine {
  tier: Tier;
  seats: number;
  unitPriceXaf: number;
  amountXaf: number;
}

export interface Quote {
  lines: QuoteLine[];
  totalSeats: number;
  totalXaf: number;
}

export interface QuoteRefusal {
  code:
    | 'SEATS_BELOW_MINIMUM'
    | 'SEATS_BELOW_STUDENT_COUNT'
    | 'SEATS_ABOVE_MAXIMUM';
  /** Present when one tier is at fault. A center holds several, so "too few
   *  seats" is useless without saying which. */
  tier?: Tier;
  /** The number the caller has to reach. Without it they can only guess. */
  requiredSeats: number;
}

/**
 * The single authority on what a center owes.
 *
 * Pure by design: no database, no HTTP, no clock. Everything it needs arrives
 * as a mix and a context, which is what lets every rule here be tested
 * directly instead of through a request.
 *
 * The price is never an input. A caller says how many seats of which tier it
 * wants; what that costs is decided here. An endpoint that accepts an amount
 * is a bug, not a convenience.
 */
@Injectable()
export class PricingService {
  quote(mix: SeatMix, context: CenterTierContext): Quote {
    const wanted = this.normalise(mix);

    const refusal = this.explain(mix, context);
    if (refusal) {
      throw new BadRequestException({
        message: refusal.code,
        ...(refusal.tier ? { tier: refusal.tier } : {}),
        requiredSeats: refusal.requiredSeats,
      });
    }

    const lines = TIER_ORDER.filter((tier) => wanted[tier]).map<QuoteLine>(
      (tier) => {
        const seats = wanted[tier] as number;
        const unitPriceXaf = this.priceFor(tier, context);

        return {
          tier,
          seats,
          unitPriceXaf,
          // Two integers multiplied, so the result is exact. XAF has no minor
          // units; there is nothing here to round and nothing to lose.
          amountXaf: seats * unitPriceXaf,
        };
      },
    );

    return {
      lines,
      totalSeats: lines.reduce((total, line) => total + line.seats, 0),
      totalXaf: lines.reduce((total, line) => total + line.amountXaf, 0),
    };
  }

  /**
   * Which rule a mix fails and the number it must reach, or null when it
   * clears all of them.
   *
   * Separate from `quote` so a caller can explain a refusal without provoking
   * one, and so the reasons stay distinguishable: "buy at least ten" and "you
   * already have twelve Start students" ask for different actions.
   */
  explain(mix: SeatMix, context: CenterTierContext): QuoteRefusal | null {
    const wanted = this.normalise(mix);
    const totalSeats = TIER_ORDER.reduce(
      (total, tier) => total + (wanted[tier] ?? 0),
      0,
    );

    if (totalSeats > MAX_SEATS_TOTAL) {
      return { code: 'SEATS_ABOVE_MAXIMUM', requiredSeats: MAX_SEATS_TOTAL };
    }

    // Per-tier student floors come first. When both they and the total are
    // unmet, a tier floor is the higher bar and therefore the number that
    // actually unblocks the center.
    for (const tier of TIER_ORDER) {
      const students = context[tier]?.studentCount ?? 0;
      if (students > (wanted[tier] ?? 0)) {
        return {
          code: 'SEATS_BELOW_STUDENT_COUNT',
          tier,
          requiredSeats: students,
        };
      }
    }

    if (totalSeats < MIN_PAID_SEATS_TOTAL) {
      return {
        code: 'SEATS_BELOW_MINIMUM',
        requiredSeats: MIN_PAID_SEATS_TOTAL,
      };
    }

    return null;
  }

  /**
   * A tier the center already holds keeps the price it agreed to; a tier it
   * does not hold pays today's list price.
   *
   * There is one price column per tier, so buying more seats cannot introduce
   * a second price for the same tier. Repricing the row would raise the price
   * on seats the center already has, which is not what adding seats should do.
   */
  private priceFor(tier: Tier, context: CenterTierContext): number {
    return context[tier]?.stampedPriceXaf ?? TIER_PRICES_XAF[tier];
  }

  /**
   * Drops absent and zero tiers, and refuses anything that is not a seat
   * count. Zero is treated as "not buying this tier" rather than an error, so
   * a client can send a full mix with some tiers at zero.
   */
  private normalise(mix: SeatMix): SeatMix {
    const wanted: SeatMix = {};

    for (const tier of TIER_ORDER) {
      const seats = mix[tier];
      if (seats === undefined || seats === 0) continue;

      if (!Number.isInteger(seats) || seats < 0) {
        throw new BadRequestException('SEATS_INVALID');
      }

      wanted[tier] = seats;
    }

    if (Object.keys(wanted).length === 0) {
      throw new BadRequestException('SEAT_MIX_EMPTY');
    }

    return wanted;
  }
}
