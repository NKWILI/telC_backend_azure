import {
  PricingService,
  TIER_PRICES_XAF,
  MIN_PAID_SEATS_TOTAL,
  MAX_SEATS_TOTAL,
  MAX_AMOUNT_XAF,
  type SeatMix,
  type CenterPricingContext,
} from '../src/modules/centers/pricing.service';

/** A center that holds nothing and has no students yet. */
const FRESH: CenterPricingContext = { tiers: {}, totalStudents: 0 };

const holding = (
  tier: 'START' | 'PRO' | 'PREMIUM',
  stampedPriceXaf: number,
  studentCount = 0,
): CenterPricingContext => ({
  tiers: { [tier]: { stampedPriceXaf, studentCount } },
  totalStudents: studentCount,
});

const withStudents = (
  tier: 'START' | 'PRO' | 'PREMIUM',
  studentCount: number,
): CenterPricingContext => ({
  tiers: { [tier]: { stampedPriceXaf: null, studentCount } },
  totalStudents: studentCount,
});

/**
 * Students the center governs who sit in no tier at all.
 *
 * These are students provisioned before tiers existed. They still occupy
 * seats, so they still set a floor.
 */
const untiered = (totalStudents: number): CenterPricingContext => ({
  tiers: {},
  totalStudents,
});

describe('PricingService', () => {
  const service = new PricingService();
  const quote = (mix: SeatMix, context: CenterPricingContext = FRESH) =>
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
      // Asserted through a quote rather than against the constant. Comparing
      // TIER_PRICES_XAF to itself pins the name and nothing else; this pins
      // the number a center is actually charged.
      const result = quote({ [tier]: 10 });

      expect(result.lines[0].unitPriceXaf).toBe(price);
      expect(result.totalXaf).toBe(price * 10);
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

    /**
     * A trial seat is held as a seat row priced at zero, so a trial center
     * arrives here holding Start at 0. Honouring that as an agreed price would
     * quote it 0 XAF for ten seats — a free plan shown to a paying customer —
     * and the payment would then fail its positive-amount constraint, turning
     * the one route a lapsed center must always reach into a 500.
     *
     * Zero is a granted seat, not a price. Converting means starting to pay.
     */
    it('charges list price to a center whose stamped price is zero', () => {
      const result = quote({ START: 10 }, holding('START', 0));

      expect(result.lines[0].unitPriceXaf).toBe(TIER_PRICES_XAF.START);
      expect(result.totalXaf).toBe(45000);
    });

    it('charges list price for the tier a trial center is converting out of', () => {
      // The real shape of a trial: one Start seat at zero, one student in it.
      const result = quote({ START: 10 }, holding('START', 0, 1));

      expect(result.totalXaf).toBe(45000);
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
        requiredSeatsTotal: MIN_PAID_SEATS_TOTAL,
      });
      // No tier is at fault: the shortfall is the total, and naming a tier
      // would send the center to change the wrong number.
      expect(refusal).not.toHaveProperty('requiredSeatsPerTier');
    });
  });

  /**
   * The floor that must hold whatever tiers exist.
   *
   * `dev` counted students center-wide, which always worked. Moving to a
   * per-tier count broke it silently for legacy students with a null tier: a
   * center with forty such students could buy ten seats. A student in no tier
   * still occupies a seat.
   */
  describe('seats can never be fewer than students, tiers or no tiers', () => {
    it('refuses ten seats to a center with forty untiered students', () => {
      expect(() => quote({ START: 10 }, untiered(40))).toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });

    it('asks for the whole student body, not the contract minimum', () => {
      const refusal = service.explain({ START: 10 }, untiered(40));

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsTotal: 40,
      });
      // No tier is at fault, because no student is in one.
      expect(refusal).not.toHaveProperty('requiredSeatsPerTier');
    });

    it('accepts a mix that covers every untiered student', () => {
      expect(() => quote({ START: 25, PRO: 15 }, untiered(40))).not.toThrow();
    });

    it('counts untiered students alongside tiered ones', () => {
      // Twelve students in total: eight in Pro, four in no tier. Buying eight
      // Pro seats covers the Pro students and strands the other four.
      const context: CenterPricingContext = {
        tiers: { PRO: { stampedPriceXaf: null, studentCount: 8 } },
        totalStudents: 12,
      };

      const refusal = service.explain({ PRO: 8, START: 2 }, context);

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsTotal: 12,
      });
    });

    it('takes the highest of the three floors', () => {
      // Pro needs 14 for its own students, the body needs 20 in total, and the
      // contract minimum is 10. Twenty is the number that unblocks them.
      const context: CenterPricingContext = {
        tiers: { PRO: { stampedPriceXaf: null, studentCount: 14 } },
        totalStudents: 20,
      };

      expect(service.explain({ PRO: 1 }, context)).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier: { PRO: 14 },
        requiredSeatsTotal: 20,
      });
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
        {
          tiers: { START: { stampedPriceXaf: null, studentCount: 12 } },
          totalStudents: 12,
        },
      );

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier: { START: 12 },
        // Twelve Start already clears the contract and student floors. The
        // optional Pro seats in the rejected cart do not raise the minimum.
        requiredSeatsTotal: 12,
      });
    });

    it('names every tier at fault at once, not the first one', () => {
      // A center short in two tiers should not have to discover them one
      // refusal at a time.
      const refusal = service.explain(
        { START: 1, PRO: 1 },
        {
          tiers: {
            START: { stampedPriceXaf: null, studentCount: 8 },
            PRO: { stampedPriceXaf: null, studentCount: 6 },
          },
          totalStudents: 14,
        },
      );

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier: { START: 8, PRO: 6 },
        requiredSeatsTotal: 14,
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

      expect(result.totalXaf).toBeLessThanOrEqual(MAX_AMOUNT_XAF);
    });

    /**
     * The seat cap bounds the amount only while every unit price stays under
     * roughly 214,748, and a stamped price is not bounded by anything. An
     * enterprise price, or a 300000-for-30000 typo when stamping a seat row by
     * hand, puts a legal seat count over the column ceiling — and Postgres
     * answering "integer out of range" reaches the client as a 500.
     */
    it('refuses an amount that would overflow the column, at a legal seat count', () => {
      const mix = { PREMIUM: MAX_SEATS_TOTAL };
      const enterprise = holding('PREMIUM', 300_000);

      // The seat count itself is allowed, so nothing but the amount can catch
      // this.
      expect(service.explain(mix, FRESH)).toBeNull();
      expect(() => quote(mix, enterprise)).toThrow('AMOUNT_ABOVE_MAXIMUM');
      expect(service.explain(mix, enterprise)).toMatchObject({
        code: 'AMOUNT_ABOVE_MAXIMUM',
        maximumAmountXaf: MAX_AMOUNT_XAF,
      });
    });
  });

  /**
   * The property `QuoteRefusal` promises: complying with a refusal works the
   * first time, and the number it names is really the minimum.
   *
   * Both halves were false. `requiredSeatsTotal` folded in the caller's own
   * ask for tiers that were NOT at fault, so it over-reported — a client that
   * rendered it would sell 25 seats where 10 would do. And per-tier floors
   * appeared only for tiers currently at fault, so complying with everything
   * the refusal said could earn a second, different refusal: exactly the
   * failure this field was introduced to end.
   */
  describe('a refusal names the real minimum, in full', () => {
    it('does not inflate the total with seats the caller merely asked for', () => {
      // PRO needs 5 for its students; START is not at fault at all. The
      // smallest mix that clears every rule is ten seats, not twenty-five.
      const context: CenterPricingContext = {
        tiers: { PRO: { stampedPriceXaf: null, studentCount: 5 } },
        totalStudents: 5,
      };

      expect(service.explain({ START: 20, PRO: 2 }, context)).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier: { PRO: 5 },
        requiredSeatsTotal: 10,
      });
      // And that minimum really is satisfiable.
      expect(service.explain({ START: 5, PRO: 5 }, context)).toBeNull();
    });

    it('names every tier that has students, not only the ones short today', () => {
      // START is already covered and PRO is not. Reporting only PRO lets a
      // client put the whole total into PRO and be refused again on START.
      const context: CenterPricingContext = {
        tiers: {
          START: { stampedPriceXaf: null, studentCount: 5 },
          PRO: { stampedPriceXaf: null, studentCount: 5 },
        },
        totalStudents: 10,
      };

      expect(service.explain({ START: 5, PRO: 3 }, context)).toMatchObject({
        requiredSeatsPerTier: { START: 5, PRO: 5 },
        requiredSeatsTotal: 10,
      });
    });

    /**
     * The general property, over several shapes rather than the one case the
     * old test happened to pick. Applying a refusal exactly as stated must
     * always clear every rule.
     */
    it.each([
      [
        'one tier short',
        {
          tiers: { PRO: { stampedPriceXaf: null, studentCount: 3 } },
          totalStudents: 3,
        },
        { PRO: 1 },
      ],
      [
        'two tiers, one short',
        {
          tiers: {
            START: { stampedPriceXaf: null, studentCount: 5 },
            PRO: { stampedPriceXaf: null, studentCount: 5 },
          },
          totalStudents: 10,
        },
        { START: 5, PRO: 3 },
      ],
      [
        'two tiers, both short',
        {
          tiers: {
            START: { stampedPriceXaf: null, studentCount: 8 },
            PRO: { stampedPriceXaf: null, studentCount: 6 },
          },
          totalStudents: 14,
        },
        { START: 1, PRO: 1 },
      ],
      [
        'untiered students only',
        { tiers: {}, totalStudents: 40 },
        { START: 10 },
      ],
      [
        'nothing wrong but the total',
        { tiers: {}, totalStudents: 0 },
        { START: 4 },
      ],
    ])(
      'accepts the mix its own refusal asked for: %s',
      (_case, context, mix) => {
        const refusal = service.explain(mix, context as CenterPricingContext);
        expect(refusal).not.toBeNull();

        // Apply it literally: every named tier floor, and the total made up
        // in whichever tier the center already uses most.
        const applied: SeatMix = { ...refusal!.requiredSeatsPerTier };
        const named = Object.values(applied).reduce(
          (total, seats) => total + (seats ?? 0),
          0,
        );
        const shortfall = (refusal!.requiredSeatsTotal ?? 0) - named;
        if (shortfall > 0) {
          applied.START = (applied.START ?? 0) + shortfall;
        }

        expect(
          service.explain(applied, context as CenterPricingContext),
        ).toBeNull();
      },
    );
  });

  describe('explain reports without refusing', () => {
    it('returns null for a mix that clears every rule', () => {
      expect(service.explain({ START: 10 }, FRESH)).toBeNull();
    });

    /**
     * The case that made the old ordering wrong. Three Pro students, one seat
     * asked for: the tier floor is three, which is below the ten-seat minimum.
     * Reporting only the tier floor told the center to reach three; it complied
     * exactly and was then told to reach ten. Both numbers, one refusal.
     */
    it('reports both floors when both are unmet', () => {
      const refusal = service.explain({ PRO: 1 }, withStudents('PRO', 3));

      expect(refusal).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeatsPerTier: { PRO: 3 },
        requiredSeatsTotal: MIN_PAID_SEATS_TOTAL,
      });
    });

    it('accepts the mix its own refusal asked for', () => {
      // The property that matters more than any single number: complying with
      // a refusal has to work the first time.
      const refusal = service.explain({ PRO: 1 }, withStudents('PRO', 3));

      expect(
        service.explain(
          { PRO: refusal?.requiredSeatsTotal },
          withStudents('PRO', 3),
        ),
      ).toBeNull();
    });

    it('never throws, whatever it is handed', () => {
      // Its whole purpose is answering "what is wrong with this cart", which
      // is not an error path. A UI must be able to ask about an empty one.
      expect(() => service.explain({}, FRESH)).not.toThrow();
      expect(service.explain({}, FRESH)).toMatchObject({
        code: 'SEAT_MIX_EMPTY',
      });
      expect(service.explain({ START: 1.5 }, FRESH)).toMatchObject({
        code: 'SEATS_INVALID',
      });
    });
  });
});
