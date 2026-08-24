import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * The largest order this service will price.
 *
 * `amount_xaf` is a Postgres INTEGER, so it stops at 2,147,483,647. At the
 * standard 4,800 XAF a seat that ceiling arrives at roughly 447,000 seats —
 * close enough to reach by mistyping a number, and the failure would surface
 * as a database error at insert rather than a refusal anyone could act on.
 * Refusing here keeps it a bad request instead of a stack trace.
 */
export const MAX_SEATS = 10_000;

/** What pricing needs to know about a center. Nothing else about it matters. */
export interface CenterBillingTerms {
  /** Whole XAF per seat per month, from the center's own contracted terms. */
  unitPriceXaf: number;
  /** The fewest seats this center's plan may buy. */
  minSeats: number;
  /** Students already provisioned, which is the other floor. */
  studentCount: number;
}

export interface Quote {
  seats: number;
  unitPriceXaf: number;
  amountXaf: number;
}

export interface QuoteRefusal {
  code: 'SEATS_BELOW_MINIMUM' | 'SEATS_BELOW_STUDENT_COUNT';
  /** The number the caller has to reach. Without it they can only guess. */
  requiredSeats: number;
}

/**
 * The single authority on what a center owes.
 *
 * Pure by design: no database, no HTTP, no clock. Everything it needs arrives
 * as `CenterBillingTerms`, which is what lets every rule here be tested
 * directly instead of through a request.
 *
 * The price is never an input. A caller says how many seats it wants; what
 * that costs is decided here from terms the center holds. An endpoint that
 * accepts an amount is a bug, not a convenience.
 */
@Injectable()
export class PricingService {
  quote(terms: CenterBillingTerms, seats: number): Quote {
    this.assertSeatsAreACount(seats);

    const refusal = this.explain(terms, seats);
    if (refusal) {
      // `message` carries the code, matching the shape the subscription guard
      // established in Phase 5, and `requiredSeats` rides alongside so the
      // dashboard can name the number instead of asking the center to guess.
      throw new BadRequestException({
        message: refusal.code,
        requiredSeats: refusal.requiredSeats,
      });
    }

    return {
      seats,
      unitPriceXaf: terms.unitPriceXaf,
      // Two integers multiplied, so the result is exact. XAF has no minor
      // units; there is nothing here to round and nothing to lose.
      amountXaf: seats * terms.unitPriceXaf,
    };
  }

  /**
   * Which floor a seat count fails, and the number it must reach, or null when
   * it clears both.
   *
   * Separate from `quote` so a caller can explain a refusal without provoking
   * one, and so the two floors stay distinguishable: "buy at least 10" and
   * "you already have 12 students" ask the center for different actions.
   */
  explain(terms: CenterBillingTerms, seats: number): QuoteRefusal | null {
    // The student count is checked first, because when both floors are
    // unmet it is the higher one and therefore the number that actually
    // unblocks the center.
    if (seats < terms.studentCount) {
      return {
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeats: terms.studentCount,
      };
    }

    if (seats < terms.minSeats) {
      return { code: 'SEATS_BELOW_MINIMUM', requiredSeats: terms.minSeats };
    }

    return null;
  }

  private assertSeatsAreACount(seats: number): void {
    if (!Number.isInteger(seats) || seats <= 0) {
      throw new BadRequestException('SEATS_INVALID');
    }

    if (seats > MAX_SEATS) {
      throw new BadRequestException('SEATS_ABOVE_MAXIMUM');
    }
  }
}
