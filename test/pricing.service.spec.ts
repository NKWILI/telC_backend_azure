import {
  PricingService,
  TIER_PRICES_XAF,
  MIN_PAID_SEATS_TOTAL,
  MAX_SEATS_TOTAL,
  type SeatMix,
  type CenterTierContext,
} from '../src/modules/centers/pricing.service';

/** A center that holds nothing and has no students yet. */
const FRESH: CenterTierContext = {};

const holding = (
  tier: 'START' | 'PRO' | 'PREMIUM',
  stampedPriceXaf: number,
  studentCount = 0,
): CenterTierContext => ({ [tier]: { stampedPriceXaf, studentCount } });

const withStudents = (
  tier: 'START' | 'PRO' | 'PREMIUM',
  studentCount: number,
): CenterTierContext => ({
  [tier]: { stampedPriceXaf: null, studentCount },
});

describe('PricingService', () => {
  const service = new PricingService();
  const quote = (mix: SeatMix, context: CenterTierContext = FRESH) =>
    service.quote(mix, context);

  describe('the published prices', () => {
    it('charges the launch price for the smallest allowed order', () => {
      expect(quote({ START: 10 })).toEqual({
        lines: [
          { tier: 'START', seats: 10, unitPriceXaf: 4500, amountXaf: 45000 },
        ],
        totalSeats: 10,
        totalXaf: 45000,
      });
    });

    it.each([
      ['START', 4500],
      ['PRO', 10000],
      ['PREMIUM', 20000],
    ] as const)('prices %s at %i a seat', (tier, price) => {
      expect(TIER_PRICES_XAF[tier]).toBe(price);
    });

    it('prices a mix of all three, itemised', () => {
      // The arrangement the pricing page sells, and the sum a school sees.
      const result = quote({ START: 5, PRO: 3, PREMIUM: 2 });

      expect(result.lines).toEqual([
        { tier: 'START', seats: 5, unitPriceXaf: 4500, amountXaf: 22500 },
        { tier: 'PRO', seats: 3, unitPriceXaf: 10000, amountXaf: 30000 },
        { tier: 'PREMIUM', seats: 2, unitPriceXaf: 20000, amountXaf: 40000 },
      ]);
      expect(result.totalSeats).toBe(10);
      expect(result.totalXaf).toBe(92500);
    });

    it('lists tiers cheapest first, so a cart does not reshuffle', () => {
      const result = quote({ PREMIUM: 2, START: 5, PRO: 3 });

      expect(result.lines.map((line) => line.tier)).toEqual([
        'START',
        'PRO',
        'PREMIUM',
      ]);
    });

    it('omits a tier the center did not ask for', () => {
      const result = quote({ START: 10 });

      expect(result.lines).toHaveLength(1);
    });

    it('returns whole XAF, exactly', () => {
      const result = quote({ START: 7, PRO: 3 });

      expect(Number.isInteger(result.totalXaf)).toBe(true);
      expect(result.totalXaf).toBe(7 * 4500 + 3 * 10000);
    });
  });

  /**
   * The rule that falls out of one row per tier plus a stamped price: a tier a
   * center already holds keeps the price it agreed to. Repricing the row would
   * raise the price on seats it already has, which is not what buying more
   * seats should do.
   */
  describe('a tier the center already holds keeps its price', () => {
    it('quotes a larger Start holding at the price already agreed', () => {
      // THE MIX IS THE TOTAL A CENTER WILL HOLD, not an increment. A center
      // with ten Start seats wanting five more sends fifteen, which is also
      // why the student floor can be compared against it directly.
      const result = quote({ START: 15 }, holding('START', 4500, 10));

      expect(result.lines[0]).toMatchObject({
        seats: 15,
        unitPriceXaf: 4500,
        amountXaf: 67500,
      });
    });

    it('keeps a price below the list price, which is the point', () => {
      const result = quote({ START: 10 }, holding('START', 3800));

      expect(result.lines[0]).toMatchObject({
        unitPriceXaf: 3800,
        amountXaf: 38000,
      });
    });

    it('uses the list price for a tier they do not hold yet', () => {
      // Holds Start cheaply; buying Pro for the first time pays list.
      const result = quote({ START: 5, PRO: 5 }, holding('START', 3800, 5));

      expect(result.lines[0].unitPriceXaf).toBe(3800);
      expect(result.lines[1].unitPriceXaf).toBe(TIER_PRICES_XAF.PRO);
    });

    it('reads the price from the context rather than a constant of its own', () => {
      // An invented price would still pass every case above, because they all
      // use real ones. This cannot be satisfied by a hard-coded 4500.
      const result = quote({ START: 10 }, holding('START', 1));

      expect(result.totalXaf).toBe(10);
    });
  });

  describe('the ten-seat floor is a total, not per tier', () => {
    it('accepts ten seats spread across tiers', () => {
      // Five Start plus five Pro is a valid purchase. Ten per tier would mean
      // a school with two exam students had to buy ten Pro seats.
      expect(() => quote({ START: 5, PRO: 5 })).not.toThrow();
    });

    it('accepts one seat in a tier when the total reaches ten', () => {
      expect(() => quote({ START: 9, PRO: 1 })).not.toThrow();
    });

    it('refuses nine seats however they are split', () => {
      expect(() => quote({ START: 4, PRO: 5 })).toThrow('SEATS_BELOW_MINIMUM');
    });

    it('names the total it needs, not a per-tier number', () => {
      const refusal = service.explain({ START: 4, PRO: 5 }, FRESH);

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_MINIMUM',
        requiredSeats: MIN_PAID_SEATS_TOTAL,
      });
      expect(refusal).not.toHaveProperty('tier');
    });
  });

  describe('a tier cannot hold fewer seats than it has students', () => {
    it('refuses Start seats below the Start students already provisioned', () => {
      expect(() => quote({ START: 10 }, withStudents('START', 12))).toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });

    it('names the tier, because a center holds several', () => {
      // "Too few seats" is useless when three tiers exist. The refusal has to
      // say which one and how many.
      const refusal = service.explain(
        { START: 10, PRO: 2 },
        { START: { stampedPriceXaf: null, studentCount: 12 } },
      );

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        tier: 'START',
        requiredSeats: 12,
      });
    });

    it('counts each tier separately, since a Start student cannot sit in a Pro seat', () => {
      // Twelve seats in total, but the Start line is still short.
      expect(() =>
        quote({ START: 10, PRO: 2 }, withStudents('START', 12)),
      ).toThrow('SEATS_BELOW_STUDENT_COUNT');
    });

    it('accepts exactly as many seats as students', () => {
      expect(() =>
        quote({ START: 12 }, withStudents('START', 12)),
      ).not.toThrow();
    });

    it('refuses dropping a tier that still has students in it', () => {
      // Asking for no Pro seats while two Pro students exist would strand them.
      expect(() => quote({ START: 10 }, withStudents('PRO', 2))).toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });
  });

  describe('inputs that are not a seat mix', () => {
    it('refuses an empty mix', () => {
      expect(() => quote({})).toThrow('SEAT_MIX_EMPTY');
    });

    it('refuses a mix of only zeros', () => {
      expect(() => quote({ START: 0, PRO: 0 })).toThrow('SEAT_MIX_EMPTY');
    });

    it.each([-1, 10.5, NaN, Infinity])('refuses %s seats', (seats) => {
      expect(() => quote({ START: seats })).toThrow('SEATS_INVALID');
    });

    it('refuses a total above the maximum', () => {
      // amount_xaf is a 32-bit integer. At 20,000 a Premium seat the ceiling
      // arrives far sooner than at 4,500, so the cap is on the total.
      expect(() => quote({ PREMIUM: MAX_SEATS_TOTAL + 1 })).toThrow(
        'SEATS_ABOVE_MAXIMUM',
      );
    });

    it('keeps the largest allowed order inside the integer column', () => {
      const result = quote({ PREMIUM: MAX_SEATS_TOTAL });

      expect(result.totalXaf).toBeLessThan(2_147_483_647);
    });
  });

  describe('explain reports without refusing', () => {
    it('returns null for a mix that clears every rule', () => {
      expect(service.explain({ START: 10 }, FRESH)).toBeNull();
    });

    it('reports the student floor before the minimum, being the higher bar', () => {
      // Both unmet: four seats, twelve students. The number that actually
      // unblocks them is twelve, so that is the one to report.
      const refusal = service.explain({ START: 4 }, withStudents('START', 12));

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeats: 12,
      });
    });
  });
});
