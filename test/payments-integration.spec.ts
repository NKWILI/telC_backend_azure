/**
 * Idempotency is a claim about a unique index, and a mock has no unique index.
 *
 * The double-click case is the reason this file exists: two requests carrying
 * one key, in flight at once, must leave exactly one row. A mocked Prisma will
 * happily "create" twice and report success both times.
 *
 * Since tiers arrived it carries a second claim a mock cannot check: a payment
 * and its per-tier lines are written in one insert, so no payment can exist
 * without the breakdown that explains its amount.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import { PrismaService } from '../src/shared/services/prisma.service';
import { PricingService } from '../src/modules/centers/pricing.service';
import { PaymentsService } from '../src/modules/centers/payments.service';
import { CenterSeatsService } from '../src/modules/centers/center-seats.service';

const prisma = new PrismaService();
const payments = new PaymentsService(
  prisma,
  new PricingService(),
  new CenterSeatsService(prisma),
);

const identity = (centerId: string) => ({ centerId }) as never;

async function wipe() {
  // Students first. `center_id` is ON DELETE SET NULL, so deleting the center
  // would leave them behind carrying a tier and no center — harmless here, but
  // they would pile up in the branch across runs.
  await prisma.student.deleteMany({
    where: { email: { startsWith: 'payments-test-' } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Payments Test' } },
  });
}

async function makeCenter(over: Record<string, unknown> = {}) {
  return prisma.center.create({
    data: {
      name: `Payments Test ${Date.now()}-${Math.random()}`,
      country: 'Cameroon',
      city: 'Douala',
      subscription: { create: { plan: 'TRIAL', seats: 3 } },
      ...over,
    },
  });
}

/** A seat row is what stamps a price, and therefore what grandfathers it. */
async function holdSeats(
  centerId: string,
  tier: 'START' | 'PRO' | 'PREMIUM',
  quantity: number,
  unitPriceXaf: number,
) {
  await prisma.centerSeat.create({
    data: {
      center_id: centerId,
      tier,
      quantity,
      unit_price_xaf: unitPriceXaf,
    },
  });
}

async function makeStudents(
  centerId: string,
  tier: 'START' | 'PRO' | 'PREMIUM',
  count: number,
) {
  for (let i = 0; i < count; i++) {
    await prisma.student.create({
      data: {
        email: `payments-test-${tier}-${i}-${Date.now()}-${Math.random()}@example.com`,
        center_id: centerId,
        tier,
      },
    });
  }
}

describe('payments against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  describe('creating one', () => {
    it('records what the server priced, not what anyone asked for', async () => {
      const center = await makeCenter();

      const payment = await payments.create(
        identity(center.id),
        { START: 5, PRO: 5 },
        'key-1',
      );

      expect(payment).toMatchObject({
        totalSeats: 10,
        // 5 x 4,500 + 5 x 10,000.
        amountXaf: 72_500,
        status: 'PENDING',
      });
      expect(payment.lines).toEqual([
        { tier: 'START', seats: 5, unitPriceXaf: 4_500, amountXaf: 22_500 },
        { tier: 'PRO', seats: 5, unitPriceXaf: 10_000, amountXaf: 50_000 },
      ]);
    });

    it('writes the lines in the same insert as the payment', async () => {
      // The claim the response cannot make on its own: the rows are really
      // there, and a payment can never be read back without its breakdown.
      const center = await makeCenter();

      const payment = await payments.create(
        identity(center.id),
        { START: 5, PREMIUM: 5 },
        'key-1',
      );

      const lines = await prisma.paymentLine.findMany({
        where: { payment_id: payment.id },
        orderBy: { tier: 'asc' },
      });

      expect(lines).toHaveLength(2);
      expect(
        lines.map((line) => [line.tier, line.seats, line.amount_xaf]),
      ).toEqual(
        expect.arrayContaining([
          ['START', 5, 22_500],
          ['PREMIUM', 5, 100_000],
        ]),
      );
    });

    it('keeps the price a center already agreed to for a tier it holds', async () => {
      // Grandfathering, end to end. The list price for Start is 4,500 today
      // and will rise; this center bought at 4,000 and keeps it.
      const center = await makeCenter();
      await holdSeats(center.id, 'START', 10, 4_000);

      const payment = await payments.create(
        identity(center.id),
        { START: 10 },
        'key-1',
      );

      expect(payment.lines[0].unitPriceXaf).toBe(4_000);
      expect(payment.amountXaf).toBe(40_000);
    });

    it('charges list price for a tier the center does not hold', async () => {
      // A stamped Start price is not a discount on Pro. Only the tier on the
      // seat row is grandfathered.
      const center = await makeCenter();
      await holdSeats(center.id, 'START', 10, 4_000);

      const payment = await payments.create(
        identity(center.id),
        { START: 10, PRO: 2 },
        'key-1',
      );

      expect(payment.lines).toEqual([
        { tier: 'START', seats: 10, unitPriceXaf: 4_000, amountXaf: 40_000 },
        { tier: 'PRO', seats: 2, unitPriceXaf: 10_000, amountXaf: 20_000 },
      ]);
    });

    it('grants nothing', async () => {
      // The whole point of the phase boundary. A pending payment must leave
      // the subscription exactly as it found it; only Phase 7 may move it.
      const center = await makeCenter();
      const before = await prisma.centerSubscription.findUniqueOrThrow({
        where: { center_id: center.id },
      });

      await payments.create(identity(center.id), { START: 10 }, 'key-1');

      const after = await prisma.centerSubscription.findUniqueOrThrow({
        where: { center_id: center.id },
      });
      expect(after.paid_until).toBeNull();
      expect(after.seats).toBe(before.seats);
      // No seat row either. Holding seats is what a successful payment buys.
      expect(
        await prisma.centerSeat.count({ where: { center_id: center.id } }),
      ).toBe(0);
    });

    it('refuses a mix the total floor rejects', async () => {
      const center = await makeCenter();

      await expect(
        payments.create(identity(center.id), { START: 4, PRO: 5 }, 'key-1'),
      ).rejects.toThrow('SEATS_BELOW_MINIMUM');

      const rows = await prisma.payment.count({
        where: { center_id: center.id },
      });
      // Nothing recorded. A refused quote must not leave a payment behind.
      expect(rows).toBe(0);
    });

    it('refuses fewer seats in a tier than it already has students', async () => {
      // Buying eleven seats overall does not cover twelve Pro students, and
      // the refusal has to name the tier — a center holds several.
      const center = await makeCenter();
      await makeStudents(center.id, 'PRO', 12);

      await expect(
        payments.create(identity(center.id), { START: 10, PRO: 1 }, 'key-1'),
      ).rejects.toThrow('SEATS_BELOW_STUDENT_COUNT');

      expect(
        await prisma.payment.count({ where: { center_id: center.id } }),
      ).toBe(0);
    });
  });

  describe('the same key twice', () => {
    it('creates exactly one row when two requests race', async () => {
      // Three tiers deliberately: the insert now writes four rows rather than
      // one, and the loser of the race has to leave none of them behind.
      const center = await makeCenter();
      const mix = { START: 4, PRO: 3, PREMIUM: 3 };

      const results = await Promise.allSettled([
        payments.create(identity(center.id), mix, 'same-key'),
        payments.create(identity(center.id), mix, 'same-key'),
      ]);

      // Both succeed: the loser of the insert race is answered from the row
      // that won, because a double-click is one intent, not a failure.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const rows = await prisma.payment.findMany({
        where: { center_id: center.id },
      });
      expect(rows).toHaveLength(1);
      // And exactly one set of lines. A second insert that lost the race must
      // not have left its breakdown behind, and there is no partial write:
      // three tiers means three lines, never four or six.
      expect(
        await prisma.paymentLine.count({ where: { payment_id: rows[0].id } }),
      ).toBe(3);
      // 4 x 4,500 + 3 x 10,000 + 3 x 20,000.
      expect(rows[0].amount_xaf).toBe(108_000);
    });

    it('returns the original record rather than a second one', async () => {
      const center = await makeCenter();
      const mix = { START: 4, PRO: 3, PREMIUM: 3 };

      const first = await payments.create(identity(center.id), mix, 'same-key');
      const replay = await payments.create(
        identity(center.id),
        mix,
        'same-key',
      );

      expect(replay.id).toBe(first.id);
      expect(replay.createdAt).toEqual(first.createdAt);
      expect(replay.lines).toEqual(first.lines);
    });

    it('refuses the same key carrying a different mix', async () => {
      const center = await makeCenter();
      const first = await payments.create(
        identity(center.id),
        { START: 10 },
        'same-key',
      );

      // A different intent wearing the same name. Handing back the original
      // would tell a client it had bought Pro seats when it had bought Start.
      await expect(
        payments.create(identity(center.id), { PRO: 10 }, 'same-key'),
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');

      const rows = await prisma.payment.findMany({
        where: { center_id: center.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].total_seats).toBe(first.totalSeats);
    });

    it('refuses a different mix that happens to total the same', async () => {
      // The collision that matters, and the reason the fingerprint covers
      // every line rather than the total. Ten Start and five Start plus five
      // Pro are both ten seats, and are not the same purchase.
      const center = await makeCenter();
      await payments.create(identity(center.id), { START: 10 }, 'same-key');

      await expect(
        payments.create(identity(center.id), { START: 5, PRO: 5 }, 'same-key'),
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');

      expect(
        await prisma.payment.count({ where: { center_id: center.id } }),
      ).toBe(1);
    });

    it('lets two different centers use the same key text', async () => {
      // The key is unique per center, not globally. Two centers picking the
      // same uuid must not collide with each other.
      const a = await makeCenter();
      const b = await makeCenter();

      await payments.create(identity(a.id), { START: 10 }, 'shared-text');
      await expect(
        payments.create(identity(b.id), { START: 10 }, 'shared-text'),
      ).resolves.toBeDefined();
    });
  });

  describe('reading them back', () => {
    it('refuses to show another center a payment', async () => {
      const mine = await makeCenter();
      const theirs = await makeCenter();
      const payment = await payments.create(
        identity(theirs.id),
        { START: 10 },
        'key-1',
      );

      // 404, never 403. A 403 would confirm the id exists.
      await expect(payments.get(identity(mine.id), payment.id)).rejects.toThrow(
        'PAYMENT_NOT_FOUND',
      );
    });

    it('lists newest first, scoped to one center, breakdown included', async () => {
      const center = await makeCenter();
      await payments.create(identity(center.id), { START: 10 }, 'key-1');
      await payments.create(identity(center.id), { PRO: 11 }, 'key-2');

      const history = await payments.list(identity(center.id), {
        page: 1,
        pageSize: 20,
      });

      expect(history.total).toBe(2);
      expect(history.payments[0].totalSeats).toBe(11);
      expect(history.payments[0].lines).toEqual([
        { tier: 'PRO', seats: 11, unitPriceXaf: 10_000, amountXaf: 110_000 },
      ]);
    });

    it('reads lines back cheapest first, whatever order they were stored in', async () => {
      // A payment and the quote that produced it have to read the same way.
      const center = await makeCenter();
      const created = await payments.create(
        identity(center.id),
        { PREMIUM: 4, START: 3, PRO: 3 },
        'key-1',
      );

      const read = await payments.get(identity(center.id), created.id);

      expect(read.lines.map((line) => line.tier)).toEqual([
        'START',
        'PRO',
        'PREMIUM',
      ]);
    });
  });
});
