/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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

/**
 * The signed identity now carries the manager too, because the profile gate
 * asks about the signed-in manager's phone.
 */
const identity = (centerId: string, centerUserId = `${centerId}-owner`) =>
  ({ centerId, centerUserId }) as never;

async function wipe() {
  await prisma.centerUser.deleteMany({
    where: { email: { startsWith: 'payments-test-' } },
  });
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

/**
 * A center whose profile is complete: country, city and a manager with a
 * phone. That is what it takes to be charged, and the default here because
 * most tests are about pricing rather than about onboarding.
 */
async function makeCenter(over: Record<string, unknown> = {}) {
  const center = await prisma.center.create({
    data: {
      name: `Payments Test ${Date.now()}-${Math.random()}`,
      country_code: 'CM',
      city_id: 'douala',
      subscription: { create: { plan: 'TRIAL' } },
      ...over,
    },
  });

  await prisma.centerUser.create({
    data: {
      id: `${center.id}-owner`,
      center_id: center.id,
      role: 'OWNER',
      first_name: 'Alain',
      last_name: 'Ngeukeu',
      email: `payments-test-owner-${center.id}@example.com`,
      password_hash: 'x',
      email_verified: true,
      phone: '+237690000000',
    },
  });

  return center;
}

/** A center that registered and stopped: no country, city or manager phone. */
async function makeDraftCenter(managerPhone: string | null = null) {
  const center = await prisma.center.create({
    data: {
      name: `Payments Test Draft ${Date.now()}-${Math.random()}`,
      subscription: { create: { plan: 'TRIAL' } },
    },
  });

  await prisma.centerUser.create({
    data: {
      id: `${center.id}-owner`,
      center_id: center.id,
      role: 'OWNER',
      first_name: 'Alain',
      last_name: 'Ngeukeu',
      email: `payments-test-draft-${center.id}@example.com`,
      password_hash: 'x',
      email_verified: true,
      phone: managerPhone,
    },
  });

  return center;
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

/**
 * Students with no tier, which is every student any center has today. They
 * still occupy a seat, so they still set a floor.
 */
async function makeUntieredStudents(centerId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await prisma.student.create({
      data: {
        email: `payments-test-untiered-${i}-${Date.now()}-${Math.random()}@example.com`,
        center_id: centerId,
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
      expect(after.plan).toBe(before.plan);
      // No seat row either. Holding seats is what a successful payment buys,
      // and it is now the only place a seat count lives.
      expect(
        await prisma.centerSeat.count({ where: { center_id: center.id } }),
      ).toBe(0);
    });

    it('leaves an existing seat row untouched, price included', async () => {
      // The stronger half of "grants nothing", and the one a center with a
      // seat row would actually notice. Counting rows on a center that holds
      // none would pass even if paying repriced or resized what it holds.
      const center = await makeCenter();
      await holdSeats(center.id, 'START', 4, 4_000);
      const before = await prisma.centerSeat.findFirstOrThrow({
        where: { center_id: center.id },
      });

      await payments.create(identity(center.id), { START: 12 }, 'key-1');

      const after = await prisma.centerSeat.findFirstOrThrow({
        where: { center_id: center.id },
      });
      expect(after.quantity).toBe(4);
      expect(after.unit_price_xaf).toBe(4_000);
      expect(after.updated_at).toEqual(before.updated_at);
    });

    it('records an amount that equals the sum of its lines', async () => {
      // The invariant the whole line model exists to protect. Nothing else
      // checks that the total and the breakdown agree.
      const center = await makeCenter();

      const payment = await payments.create(
        identity(center.id),
        { START: 4, PRO: 3, PREMIUM: 3 },
        'key-1',
      );

      const row = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { lines: true },
      });

      expect(row.amount_xaf).toBe(
        row.lines.reduce((total, line) => total + line.amount_xaf, 0),
      );
      expect(row.total_seats).toBe(
        row.lines.reduce((total, line) => total + line.seats, 0),
      );
      row.lines.forEach((line) => {
        expect(line.amount_xaf).toBe(line.seats * line.unit_price_xaf);
      });
    });

    /**
     * A trial seat is a seat row priced at zero, so a converting center
     * arrives here holding Start at 0. Honouring that as an agreed price would
     * quote it nothing and then break: `payment_lines.unit_price_xaf` must be
     * positive, and the failure is not a unique violation, so it would reach
     * the center as a 500 on the one route a lapsed center must always reach.
     */
    it('lets a trial center on a zero-priced seat actually pay', async () => {
      const center = await makeCenter();
      await holdSeats(center.id, 'START', 1, 0);
      await makeStudents(center.id, 'START', 1);

      const payment = await payments.create(
        identity(center.id),
        { START: 10 },
        'key-1',
      );

      expect(payment.lines[0].unitPriceXaf).toBe(4_500);
      expect(payment.amountXaf).toBe(45_000);
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

    /**
     * The floor as it actually behaves today.
     *
     * Nothing writes `students.tier` yet, so a per-tier count reads zero for
     * every real student. Counting only per tier meant a center with forty
     * students could buy ten seats — which is the whole product given away.
     * This is the case a mocked Prisma cannot judge, because the count comes
     * from the rows.
     */
    it('refuses ten seats to a center whose students are all untiered', async () => {
      const center = await makeCenter();
      await makeUntieredStudents(center.id, 12);

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).rejects.toThrow('SEATS_BELOW_STUDENT_COUNT');

      expect(
        await prisma.payment.count({ where: { center_id: center.id } }),
      ).toBe(0);
    });

    it('accepts a mix that seats every untiered student', async () => {
      const center = await makeCenter();
      await makeUntieredStudents(center.id, 12);

      const payment = await payments.create(
        identity(center.id),
        { START: 12 },
        'key-1',
      );

      expect(payment.totalSeats).toBe(12);
    });

    it('refuses a token whose center no longer exists', async () => {
      // A center token outlives its center: the guard caches the identity and
      // never rechecks the row. Without the existence read this is a
      // foreign-key error at insert, which reaches the center as a 500.
      const center = await makeCenter();
      // The manager goes first: center_users has no cascade, so a center
      // cannot be deleted while one exists.
      await prisma.centerUser.deleteMany({ where: { center_id: center.id } });
      await prisma.center.delete({ where: { id: center.id } });

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).rejects.toThrow('CENTER_NOT_FOUND');
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

  /**
   * The gate sits at payment, not at provisioning.
   *
   * None of country, city or the manager's phone is needed to run a trial — a
   * center can try the product on the strength of an email address. All three
   * are needed to take money: the phone is how an unpaid invoice gets chased,
   * and country decides currency and tax.
   */
  describe('a center must finish its profile before it can pay', () => {
    it('refuses a draft center, naming every field it still owes', async () => {
      const center = await makeDraftCenter();

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          message: 'CENTER_PROFILE_INCOMPLETE',
          missing: ['country', 'city', 'phone'],
        }),
      });
    });

    it('records nothing when it refuses', async () => {
      const center = await makeDraftCenter();

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).rejects.toThrow('CENTER_PROFILE_INCOMPLETE');

      expect(
        await prisma.payment.count({ where: { center_id: center.id } }),
      ).toBe(0);
    });

    it('still refuses when only the manager phone is missing', async () => {
      // Two of three is not complete. The phone is the one that matters most
      // for chasing money, so it cannot be the one that gets waived.
      const center = await prisma.center.create({
        data: {
          name: `Payments Test Draft No Phone ${Date.now()}`,
          country_code: 'CM',
          city_id: 'douala',
          subscription: { create: { plan: 'TRIAL' } },
        },
      });
      await prisma.centerUser.create({
        data: {
          id: `${center.id}-owner`,
          center_id: center.id,
          role: 'OWNER',
          first_name: 'Alain',
          last_name: 'Ngeukeu',
          email: `payments-test-nophone-${center.id}@example.com`,
          password_hash: 'x',
          email_verified: true,
          phone: null,
        },
      });

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ missing: ['phone'] }),
      });
    });

    it('treats whitespace as unanswered', async () => {
      const center = await makeDraftCenter('   ');

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).rejects.toThrow('CENTER_PROFILE_INCOMPLETE');
    });

    it('accepts a center that has finished its profile', async () => {
      const center = await makeCenter();

      await expect(
        payments.create(identity(center.id), { START: 10 }, 'key-1'),
      ).resolves.toMatchObject({ status: 'PENDING' });
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

    /**
     * The retry that used to be refused.
     *
     * The fingerprint covered the priced lines, so a stamped price changing
     * between an attempt and its retry made a byte-identical request look like
     * a different purchase. The client's documented answer to
     * IDEMPOTENCY_KEY_REUSED is a fresh key — which produces a second payment
     * for one intent, the exact failure the unique index exists to prevent.
     *
     * A fingerprint identifies what the caller asked for. The price is the
     * server's answer, and the original row stays the authority on it.
     */
    it('answers a retry from the original row after the price moved', async () => {
      const center = await makeCenter();
      const first = await payments.create(
        identity(center.id),
        { START: 10 },
        'same-key',
      );
      expect(first.lines[0].unitPriceXaf).toBe(4_500);

      // The by-hand stamping workflow, or the planned move to 4,800.
      await holdSeats(center.id, 'START', 10, 4_000);

      const replay = await payments.create(
        identity(center.id),
        { START: 10 },
        'same-key',
      );

      expect(replay.id).toBe(first.id);
      // Still the price it was actually charged, not a reprice.
      expect(replay.lines[0].unitPriceXaf).toBe(4_500);
      expect(
        await prisma.payment.count({ where: { center_id: center.id } }),
      ).toBe(1);
    });

    it('treats a mix with explicit zeros as the same intent', async () => {
      // `{start: 10}` and `{start: 10, pro: 0}` are the same purchase, and a
      // client filling in every field must not be told otherwise.
      const center = await makeCenter();
      const first = await payments.create(
        identity(center.id),
        { START: 10 },
        'same-key',
      );

      const replay = await payments.create(
        identity(center.id),
        { START: 10, PRO: 0, PREMIUM: 0 },
        'same-key',
      );

      expect(replay.id).toBe(first.id);
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
