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
 * A guard against a mistyped seat count, nothing more. The ceiling that
 * actually protects the database is `MAX_AMOUNT_XAF` below — seats alone
 * cannot tell you whether an amount fits, because a stamped price can be any
 * integer.
 */
export const MAX_SEATS_TOTAL = 10_000;

/**
 * The largest amount that fits the `amount_xaf` columns, which are Postgres
 * INTEGER.
 *
 * Checked against the computed total rather than inferred from the seat count.
 * `MAX_SEATS_TOTAL` bounds the amount only while every unit price stays under
 * roughly 214,748, and stamped prices are not bounded by anything — an
 * enterprise price, or a 300000-for-30000 typo in the by-hand stamping
 * workflow, puts a legal seat count over the ceiling. Refusing here turns
 * "integer out of range" at insert, which reaches the client as a 500, into a
 * refusal it can act on.
 */
export const MAX_AMOUNT_XAF = 2_147_483_647;

/** Seats wanted per tier. A tier absent or zero is simply not being bought. */
export type SeatMix = Partial<Record<Tier, number>>;

export interface TierContext {
  /**
   * The price already stamped on this center's seat row for this tier, or null
   * if it holds none of this tier yet.
   *
   * Zero is how a free trial seat is held, and is deliberately not a price
   * this center has agreed to pay — see `priceFor`.
   */
  stampedPriceXaf: number | null;
  /** Students already provisioned in this tier. */
  studentCount: number;
}

/**
 * What pricing needs to know about a center. Nothing else about it matters.
 *
 * `totalStudents` is every student the center governs, including those in no
 * tier, and it is not the sum of the per-tier counts. Nothing writes
 * `students.tier` until provisioning learns to, so today every per-tier count
 * is zero while `totalStudents` is the real number — and a student in no tier
 * still occupies a seat. Keeping both means the floor holds before tiers are
 * assigned and after.
 */
export interface CenterPricingContext {
  tiers: Partial<Record<Tier, TierContext>>;
  totalStudents: number;
}

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

export type QuoteRefusalCode =
  | 'SEAT_MIX_EMPTY'
  | 'SEATS_INVALID'
  | 'SEATS_BELOW_MINIMUM'
  | 'SEATS_BELOW_STUDENT_COUNT'
  | 'SEATS_ABOVE_MAXIMUM'
  | 'AMOUNT_ABOVE_MAXIMUM';

/**
 * Why a mix was refused, and every number needed to fix it in one attempt.
 *
 * The fields are named for their units because a center holds several tiers at
 * once, and "you need 3" and "you need 10" are answers to different questions.
 * An earlier version carried one `requiredSeats` that meant a per-tier floor,
 * a cross-tier total or a ceiling depending on the code, and reported only the
 * first rule it hit — so a school with three Pro students was told to reach
 * three, complied exactly, and was then told to reach ten.
 */
export interface QuoteRefusal {
  code: QuoteRefusalCode;
  /**
   * Per tier, the fewest seats that tier may hold, because that many students
   * already sit in it. Only tiers at fault appear.
   */
  requiredSeatsPerTier?: Partial<Record<Tier, number>>;
  /**
   * The fewest seats the mix may total. Present on every floor refusal, even
   * when a tier is also at fault, so one round trip is enough.
   */
  requiredSeatsTotal?: number;
  /** The most seats the mix may total, on `SEATS_ABOVE_MAXIMUM`. */
  maximumSeatsTotal?: number;
  /** The most any order may come to, on `AMOUNT_ABOVE_MAXIMUM`. */
  maximumAmountXaf?: number;
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
  quote(mix: SeatMix, context: CenterPricingContext): Quote {
    const refusal = this.explain(mix, context);

    if (refusal) {
      throw this.asException(refusal);
    }

    // Safe by construction: `explain` returns a refusal for every mix
    // `normaliseMix` would reject, so reaching here means it accepts this one.
    const lines = this.priceLines(this.normaliseMix(mix) as SeatMix, context);

    return {
      lines,
      totalSeats: lines.reduce((total, line) => total + line.seats, 0),
      totalXaf: lines.reduce((total, line) => total + line.amountXaf, 0),
    };
  }

  /**
   * The mix with absent and zero tiers dropped, or the refusal it earns.
   *
   * Public because a caller that needs to identify an intent before pricing it
   * — payment idempotency does — must use exactly the normalisation pricing
   * uses, or two requests meaning the same thing could be fingerprinted
   * differently.
   */
  requireMix(mix: SeatMix): SeatMix {
    const normalised = this.normaliseMix(mix);

    if ('code' in normalised) {
      throw this.asException(normalised);
    }

    return normalised;
  }

  /** One place builds the HTTP shape, so every refusal reaches a client alike. */
  asException(refusal: QuoteRefusal): BadRequestException {
    const { code, ...detail } = refusal;

    return new BadRequestException({ message: code, ...detail });
  }

  /**
   * Which rule a mix fails and every number it must reach, or null when it
   * clears all of them.
   *
   * Separate from `quote` so a caller can explain a refusal without provoking
   * one. It therefore never throws — an unusable mix is reported, not raised,
   * because a UI asking "what is wrong with this cart" is not an error path.
   */
  explain(mix: SeatMix, context: CenterPricingContext): QuoteRefusal | null {
    const normalised = this.normaliseMix(mix);

    if ('code' in normalised) {
      return normalised;
    }

    const wanted = normalised;
    const totalSeats = TIER_ORDER.reduce(
      (total, tier) => total + (wanted[tier] ?? 0),
      0,
    );

    if (totalSeats > MAX_SEATS_TOTAL) {
      return {
        code: 'SEATS_ABOVE_MAXIMUM',
        maximumSeatsTotal: MAX_SEATS_TOTAL,
      };
    }

    // Every floor is computed before any is reported. They are not
    // alternatives: a center can be short in one tier AND short overall, and
    // reporting only the rule hit first sends it away with a number that does
    // not unblock it.
    const requiredSeatsPerTier: Partial<Record<Tier, number>> = {};

    for (const tier of TIER_ORDER) {
      const students = context.tiers[tier]?.studentCount ?? 0;
      if (students > (wanted[tier] ?? 0)) {
        requiredSeatsPerTier[tier] = students;
      }
    }

    // The smallest total that satisfies every tier floor, which can exceed the
    // contract minimum on its own.
    const floorFromTiers = TIER_ORDER.reduce(
      (total, tier) =>
        total + (requiredSeatsPerTier[tier] ?? wanted[tier] ?? 0),
      0,
    );

    // Three floors, and the center has to clear the highest. The student body
    // is its own floor rather than the sum of the tier counts, because a
    // student in no tier is counted nowhere above and still holds a seat.
    const requiredSeatsTotal = Math.max(
      MIN_PAID_SEATS_TOTAL,
      context.totalStudents,
      floorFromTiers,
    );

    if (Object.keys(requiredSeatsPerTier).length > 0) {
      return {
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier,
        requiredSeatsTotal,
      };
    }

    // Short overall while every tier is individually covered. That is what an
    // untiered student body looks like, so no tier is named: naming one would
    // send the center to change a number that is already correct.
    if (totalSeats < context.totalStudents) {
      return { code: 'SEATS_BELOW_STUDENT_COUNT', requiredSeatsTotal };
    }

    if (totalSeats < MIN_PAID_SEATS_TOTAL) {
      return { code: 'SEATS_BELOW_MINIMUM', requiredSeatsTotal };
    }

    // Last, because it is the only rule that needs prices. A mix that fails a
    // floor is refused on the floor, which is the more useful answer.
    const totalXaf = this.priceLines(wanted, context).reduce(
      (total, line) => total + line.amountXaf,
      0,
    );

    if (totalXaf > MAX_AMOUNT_XAF) {
      return { code: 'AMOUNT_ABOVE_MAXIMUM', maximumAmountXaf: MAX_AMOUNT_XAF };
    }

    return null;
  }

  private priceLines(
    wanted: SeatMix,
    context: CenterPricingContext,
  ): QuoteLine[] {
    return TIER_ORDER.filter((tier) => wanted[tier]).map<QuoteLine>((tier) => {
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
    });
  }

  /**
   * A tier the center already pays for keeps the price it agreed to; anything
   * else pays today's list price.
   *
   * There is one price column per tier, so buying more seats cannot introduce
   * a second price for the same tier. Repricing the row would raise the price
   * on seats the center already has, which is not what adding seats should do.
   *
   * A stamped price of zero is a granted seat, not an agreement — it is how a
   * free trial seat is held. Treating it as a price to honour would quote a
   * trial center 0 XAF for ten seats and then fail the insert, since a payment
   * line must be positive. So zero falls through to list price: converting
   * from a trial means starting to pay.
   */
  private priceFor(tier: Tier, context: CenterPricingContext): number {
    const stamped = context.tiers[tier]?.stampedPriceXaf;

    return stamped != null && stamped > 0 ? stamped : TIER_PRICES_XAF[tier];
  }

  /**
   * Drops absent and zero tiers, and reports anything that is not a seat
   * count. Zero is treated as "not buying this tier" rather than an error, so
   * a client can send a full mix with some tiers at zero.
   *
   * Returns a refusal rather than throwing, so `explain` can stay a pure
   * question.
   */
  private normaliseMix(mix: SeatMix): SeatMix | QuoteRefusal {
    const wanted: SeatMix = {};

    for (const tier of TIER_ORDER) {
      const seats = mix[tier];
      if (seats === undefined || seats === 0) continue;

      if (!Number.isInteger(seats) || seats < 0) {
        return { code: 'SEATS_INVALID' };
      }

      wanted[tier] = seats;
    }

    if (Object.keys(wanted).length === 0) {
      return { code: 'SEAT_MIX_EMPTY' };
    }

    return wanted;
  }
}
