/**
 * Idempotency is a claim about a unique index, and a mock has no unique index.
 *
 * The double-click case is the reason this file exists: two requests carrying
 * one key, in flight at once, must leave exactly one row. A mocked Prisma will
 * happily "create" twice and report success both times.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import { PrismaService } from '../src/shared/services/prisma.service';
import { PricingService } from '../src/modules/centers/pricing.service';
import { PaymentsService } from '../src/modules/centers/payments.service';

const prisma = new PrismaService();
const payments = new PaymentsService(prisma, new PricingService());

const identity = (centerId: string) => ({ centerId }) as never;

async function wipe() {
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

describe('payments against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  describe('creating one', () => {
    it('records what the server priced, not what anyone asked for', async () => {
      const center = await makeCenter();

      const payment = await payments.create(identity(center.id), 10, 'key-1');

      expect(payment).toMatchObject({
        seats: 10,
        unitPriceXaf: 4800,
        amountXaf: 48000,
        status: 'PENDING',
      });
    });

    it('prices a partner center from its own terms', async () => {
      const center = await makeCenter({ unit_price_xaf: 4500 });

      const payment = await payments.create(identity(center.id), 10, 'key-1');

      expect(payment.amountXaf).toBe(45000);
    });

    it('grants nothing', async () => {
      // The whole point of the phase boundary. A pending payment must leave
      // the subscription exactly as it found it; only Phase 7 may move it.
      const center = await makeCenter();
      const before = await prisma.centerSubscription.findUniqueOrThrow({
        where: { center_id: center.id },
      });

      await payments.create(identity(center.id), 10, 'key-1');

      const after = await prisma.centerSubscription.findUniqueOrThrow({
        where: { center_id: center.id },
      });
      expect(after.paid_until).toBeNull();
      expect(after.seats).toBe(before.seats);
    });

    it('refuses a seat count the pricing floors reject', async () => {
      const center = await makeCenter();

      await expect(
        payments.create(identity(center.id), 9, 'key-1'),
      ).rejects.toThrow('SEATS_BELOW_MINIMUM');

      const rows = await prisma.payment.count({
        where: { center_id: center.id },
      });
      // Nothing recorded. A refused quote must not leave a payment behind.
      expect(rows).toBe(0);
    });
  });

  describe('the same key twice', () => {
    it('creates exactly one row when two requests race', async () => {
      const center = await makeCenter();

      const results = await Promise.allSettled([
        payments.create(identity(center.id), 10, 'same-key'),
        payments.create(identity(center.id), 10, 'same-key'),
      ]);

      // Both succeed: the loser of the insert race is answered from the row
      // that won, because a double-click is one intent, not a failure.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const rows = await prisma.payment.findMany({
        where: { center_id: center.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('returns the original record rather than a second one', async () => {
      const center = await makeCenter();

      const first = await payments.create(identity(center.id), 10, 'same-key');
      const replay = await payments.create(identity(center.id), 10, 'same-key');

      expect(replay.id).toBe(first.id);
      expect(replay.createdAt).toEqual(first.createdAt);
    });

    it('refuses the same key carrying different seats', async () => {
      const center = await makeCenter();
      const first = await payments.create(identity(center.id), 10, 'same-key');

      // A different intent wearing the same name. Handing back the original
      // would tell a client it had bought 20 seats when it had bought 10.
      await expect(
        payments.create(identity(center.id), 20, 'same-key'),
      ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');

      const rows = await prisma.payment.findMany({
        where: { center_id: center.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].seats).toBe(first.seats);
    });

    it('lets two different centers use the same key text', async () => {
      // The key is unique per center, not globally. Two centers picking the
      // same uuid must not collide with each other.
      const a = await makeCenter();
      const b = await makeCenter();

      await payments.create(identity(a.id), 10, 'shared-text');
      await expect(
        payments.create(identity(b.id), 10, 'shared-text'),
      ).resolves.toBeDefined();
    });
  });

  describe('reading them back', () => {
    it('refuses to show another center a payment', async () => {
      const mine = await makeCenter();
      const theirs = await makeCenter();
      const payment = await payments.create(identity(theirs.id), 10, 'key-1');

      // 404, never 403. A 403 would confirm the id exists.
      await expect(payments.get(identity(mine.id), payment.id)).rejects.toThrow(
        'PAYMENT_NOT_FOUND',
      );
    });

    it('lists newest first, scoped to one center', async () => {
      const center = await makeCenter();
      await payments.create(identity(center.id), 10, 'key-1');
      await payments.create(identity(center.id), 11, 'key-2');

      const history = await payments.list(identity(center.id), {
        page: 1,
        pageSize: 20,
      });

      expect(history.total).toBe(2);
      expect(history.payments[0].seats).toBe(11);
    });
  });
});
