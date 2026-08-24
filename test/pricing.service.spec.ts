import {
  PricingService,
  MAX_SEATS,
  type CenterBillingTerms,
} from '../src/modules/centers/pricing.service';

const STANDARD: CenterBillingTerms = {
  unitPriceXaf: 4800,
  minSeats: 10,
  studentCount: 0,
};

const PARTNER: CenterBillingTerms = {
  unitPriceXaf: 4500,
  minSeats: 10,
  studentCount: 0,
};

const terms = (over: Partial<CenterBillingTerms> = {}): CenterBillingTerms => ({
  ...STANDARD,
  ...over,
});

describe('PricingService', () => {
  const service = new PricingService();

  describe('what a center owes', () => {
    it('charges the standard price for the smallest allowed order', () => {
      expect(service.quote(STANDARD, 10)).toEqual({
        seats: 10,
        unitPriceXaf: 4800,
        amountXaf: 48000,
      });
    });

    it('charges a partner their contracted price, not the standard one', () => {
      // The number that makes the whole billing-terms column worth having.
      expect(service.quote(PARTNER, 10).amountXaf).toBe(45000);
    });

    it('multiplies by seats', () => {
      expect(service.quote(STANDARD, 25).amountXaf).toBe(120000);
    });

    it('reads the price from the terms rather than a constant of its own', () => {
      // An invented price would still pass every test above, because they all
      // use the real one. This one cannot be satisfied by a hard-coded 4800.
      expect(service.quote(terms({ unitPriceXaf: 1 }), 10).amountXaf).toBe(10);
    });

    it('returns whole XAF, never a fraction', () => {
      const quote = service.quote(terms({ unitPriceXaf: 4801 }), 13);

      expect(Number.isInteger(quote.amountXaf)).toBe(true);
      expect(quote.amountXaf).toBe(62413);
    });
  });

  describe('the two floors', () => {
    it('refuses fewer seats than the plan allows', () => {
      expect(() => service.quote(STANDARD, 9)).toThrow('SEATS_BELOW_MINIMUM');
    });

    it('accepts exactly the minimum', () => {
      expect(() => service.quote(STANDARD, 10)).not.toThrow();
    });

    it('refuses fewer seats than the center already has students', () => {
      // 12 students cannot be carried on 10 paid seats. Removing students is
      // possible even while blocked, so the way out of this is open.
      expect(() => service.quote(terms({ studentCount: 12 }), 10)).toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });

    it('accepts exactly as many seats as students', () => {
      expect(() =>
        service.quote(terms({ studentCount: 12 }), 12),
      ).not.toThrow();
    });

    it('tells the two refusals apart', () => {
      // The dashboard has to say which rule was broken: "buy at least 10" and
      // "you already have 30 students" call for different actions.
      expect(() => service.quote(terms({ studentCount: 0 }), 9)).toThrow(
        'SEATS_BELOW_MINIMUM',
      );
      expect(() => service.quote(terms({ studentCount: 30 }), 20)).toThrow(
        'SEATS_BELOW_STUDENT_COUNT',
      );
    });

    it('reports the student count when that is the binding floor', () => {
      // A center told only "too few seats" cannot work out what number to
      // send next. The failure carries the floor it is asking them to clear.
      const error = service.explain(terms({ studentCount: 12 }), 10);

      expect(error).toMatchObject({
        code: 'SEATS_BELOW_STUDENT_COUNT',
        requiredSeats: 12,
      });
    });

    it('reports the plan minimum when that is the binding floor', () => {
      const error = service.explain(terms({ studentCount: 3 }), 9);

      expect(error).toMatchObject({
        code: 'SEATS_BELOW_MINIMUM',
        requiredSeats: 10,
      });
    });
  });

  describe('inputs that are not seat counts', () => {
    it.each([0, -1, -100])('refuses %s seats', (seats) => {
      expect(() => service.quote(STANDARD, seats)).toThrow();
    });

    it.each([10.5, NaN, Infinity])('refuses %s', (seats) => {
      expect(() => service.quote(STANDARD, seats)).toThrow('SEATS_INVALID');
    });

    it('refuses a seat count large enough to overflow the amount column', () => {
      // amount_xaf is a Postgres INTEGER, capped near 2.15 billion. At 4,800
      // XAF a seat that ceiling is about 447,000 seats — reachable by typing,
      // and the failure would be a database error rather than a refusal.
      expect(() => service.quote(STANDARD, MAX_SEATS + 1)).toThrow(
        'SEATS_ABOVE_MAXIMUM',
      );
    });

    it('accepts the largest seat count it allows', () => {
      const quote = service.quote(STANDARD, MAX_SEATS);

      expect(quote.amountXaf).toBeLessThan(2_147_483_647);
    });
  });
});
