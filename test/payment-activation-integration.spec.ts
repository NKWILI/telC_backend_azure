/**
 * The one function that turns a payment into access.
 *
 * Everything here is a claim about rows and about concurrency, so it runs
 * against the disposable branch in `.env.test` and never against a mock. A
 * mocked Prisma will happily "activate" twice, add seats it should set, and
 * lose a paid_until extension, and report success every time.
 */
import { PrismaService } from '../src/shared/services/prisma.service';
import { PaymentActivationService } from '../src/modules/centers/payment-activation.service';
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const prisma = new PrismaService();
const activation = new PaymentActivationService(prisma);
const entitlement = new StudentEntitlementService(
  prisma,
  new SubscriptionPolicyService(),
);

const DAY_MS = 24 * 60 * 60 * 1000;
/** The database clock and this process's clock differ by network latency. */
const CLOCK_TOLERANCE_MS = 2 * 60 * 1000;

type TierName = 'START' | 'PRO' | 'PREMIUM';

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { startsWith: 'activation-test-' } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Activation Test' } },
  });
}

/** A fresh trial center: one Start seat at zero, as registration creates. */
async function makeCenter(paidUntil: Date | null = null) {
  return prisma.center.create({
    data: {
      name: `Activation Test ${Date.now()}-${Math.random()}`,
      country_code: 'CM',
      city_id: 'douala',
      subscription: {
        create: { plan: paidUntil ? 'PAID' : 'TRIAL', paid_until: paidUntil },
      },
      seats: { create: { tier: 'START', quantity: 1, unit_price_xaf: 0 } },
    },
  });
}

async function setSeats(
  centerId: string,
  rows: { tier: TierName; quantity: number; price: number }[],
) {
  await prisma.centerSeat.deleteMany({ where: { center_id: centerId } });
  for (const row of rows) {
    await prisma.centerSeat.create({
      data: {
        center_id: centerId,
        tier: row.tier,
        quantity: row.quantity,
        unit_price_xaf: row.price,
      },
    });
  }
}

/**
 * A payment exactly as creation would leave it, with prices chosen by the
 * test. Inserted directly because what is under test is what activation does
 * with the lines, not how they were priced.
 */
async function makePayment(
  centerId: string,
  lines: { tier: TierName; seats: number; price: number }[],
) {
  return prisma.payment.create({
    data: {
      center_id: centerId,
      total_seats: lines.reduce((t, l) => t + l.seats, 0),
      amount_xaf: lines.reduce((t, l) => t + l.seats * l.price, 0),
      idempotency_key: `activation-${Date.now()}-${Math.random()}`,
      request_hash: 'test',
      lines: {
        create: lines.map((l) => ({
          tier: l.tier,
          seats: l.seats,
          unit_price_xaf: l.price,
          amount_xaf: l.seats * l.price,
        })),
      },
    },
  });
}

async function makeStudent(centerId: string, tier: TierName) {
  return prisma.student.create({
    data: {
      email: `activation-test-${Date.now()}-${Math.random()}@example.com`,
      center_id: centerId,
      tier,
    },
  });
}

const seatsOf = (centerId: string) =>
  prisma.centerSeat.findMany({
    where: { center_id: centerId },
    orderBy: { tier: 'asc' },
    select: { tier: true, quantity: true, unit_price_xaf: true },
  });

const subscriptionOf = (centerId: string) =>
  prisma.centerSubscription.findUniqueOrThrow({
    where: { center_id: centerId },
  });

const expectNear = (actual: Date | null, expectedMs: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.getTime() - expectedMs)).toBeLessThan(
    CLOCK_TOLERANCE_MS,
  );
};

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.onModuleDestroy();
});

describe('activating a payment', () => {
  it('marks the payment succeeded, once', async () => {
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    const result = await activation.activate(payment.id);

    expect(result.outcome).toBe('ACTIVATED');
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(row.status).toBe('SUCCEEDED');
    expectNear(row.succeeded_at, Date.now());
  });

  it('turns a trial center into a paid one for thirty days', async () => {
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await activation.activate(payment.id);

    const subscription = await subscriptionOf(center.id);
    expect(subscription.plan).toBe('PAID');
    expectNear(subscription.paid_until, Date.now() + 30 * DAY_MS);
  });

  it('gives the center students access the moment it activates', async () => {
    // The point of all of it. SubscriptionPolicyService derives ACTIVE from
    // paid_until, so nothing else has to be switched on.
    const center = await makeCenter();
    const student = await makeStudent(center.id, 'START');
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await activation.activate(payment.id);

    await expect(entitlement.forStudent(student.id)).resolves.toMatchObject({
      status: 'ACTIVE',
      studentsMayLearn: true,
      tier: 'START',
    });
  });

  it('refuses a payment that does not exist', async () => {
    await expect(
      activation.activate('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow('PAYMENT_NOT_FOUND');
  });
});

describe('what activation writes into center_seats', () => {
  it('overwrites the zero-priced trial seat with the paid one', async () => {
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await activation.activate(payment.id);

    await expect(seatsOf(center.id)).resolves.toEqual([
      { tier: 'START', quantity: 10, unit_price_xaf: 4500 },
    ]);
  });

  it('SETS the quantity rather than adding to it, because the mix is a total', async () => {
    // A center holding ten that pays for fifteen holds fifteen, not twenty-five.
    const center = await makeCenter();
    await setSeats(center.id, [{ tier: 'START', quantity: 10, price: 4500 }]);
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 15, price: 4500 },
    ]);

    await activation.activate(payment.id);

    await expect(seatsOf(center.id)).resolves.toEqual([
      { tier: 'START', quantity: 15, unit_price_xaf: 4500 },
    ]);
  });

  it('stamps the price from the payment line, not today list price', async () => {
    // Grandfathering. The line carries the price the center agreed to at
    // quote time; stamping the current constant instead would reprice a
    // center that was promised 4,000.
    const center = await makeCenter();
    await setSeats(center.id, [{ tier: 'START', quantity: 10, price: 4000 }]);
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 12, price: 4000 },
      { tier: 'PRO', seats: 3, price: 10000 },
    ]);

    await activation.activate(payment.id);

    await expect(seatsOf(center.id)).resolves.toEqual([
      { tier: 'START', quantity: 12, unit_price_xaf: 4000 },
      { tier: 'PRO', quantity: 3, unit_price_xaf: 10000 },
    ]);
  });

  it('removes a tier the payment no longer covers, when no student holds it', async () => {
    const center = await makeCenter();
    await setSeats(center.id, [
      { tier: 'START', quantity: 10, price: 4500 },
      { tier: 'PRO', quantity: 5, price: 10000 },
    ]);
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 15, price: 4500 },
    ]);

    await activation.activate(payment.id);

    await expect(seatsOf(center.id)).resolves.toEqual([
      { tier: 'START', quantity: 15, unit_price_xaf: 4500 },
    ]);
  });

  it('keeps a tier the payment does not cover while a student still holds it', async () => {
    // Never strand a student without a seat. The quote refuses this case at
    // creation; this covers students moved into Pro between quote and payment.
    const center = await makeCenter();
    await setSeats(center.id, [
      { tier: 'START', quantity: 10, price: 4500 },
      { tier: 'PRO', quantity: 5, price: 10000 },
    ]);
    await makeStudent(center.id, 'PRO');
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 15, price: 4500 },
    ]);

    await activation.activate(payment.id);

    await expect(seatsOf(center.id)).resolves.toEqual([
      { tier: 'START', quantity: 15, unit_price_xaf: 4500 },
      { tier: 'PRO', quantity: 5, unit_price_xaf: 10000 },
    ]);
  });

  it('honours a payment even if the center is now over its seats', async () => {
    // Money has moved. Refusing would take it and grant nothing; being over
    // the limit already blocks new provisioning without evicting anyone.
    const center = await makeCenter();
    for (let i = 0; i < 12; i++) await makeStudent(center.id, 'START');
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await expect(activation.activate(payment.id)).resolves.toMatchObject({
      outcome: 'ACTIVATED',
    });
  });
});

describe('paid_until', () => {
  it('extends from the current end while the center is still paid up', async () => {
    // Paying early must not throw away the days already bought.
    const center = await makeCenter(new Date(Date.now() + 10 * DAY_MS));
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await activation.activate(payment.id);

    expectNear(
      (await subscriptionOf(center.id)).paid_until,
      Date.now() + 40 * DAY_MS,
    );
  });

  it('extends from now when the center had lapsed', async () => {
    // A lapsed center must not buy thirty days that are already in the past.
    const center = await makeCenter(new Date(Date.now() - 20 * DAY_MS));
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await activation.activate(payment.id);

    expectNear(
      (await subscriptionOf(center.id)).paid_until,
      Date.now() + 30 * DAY_MS,
    );
  });
});

describe('exactly once', () => {
  it('ignores a repeated activation of the same payment', async () => {
    // A provider that retries a webhook, or delivers it twice.
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await activation.activate(payment.id);
    const first = (await subscriptionOf(center.id)).paid_until;

    await expect(activation.activate(payment.id)).resolves.toMatchObject({
      outcome: 'ALREADY_ACTIVE',
    });
    expect((await subscriptionOf(center.id)).paid_until).toEqual(first);
  });

  it('extends only once when the same payment is activated concurrently', async () => {
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    const results = await Promise.all([
      activation.activate(payment.id),
      activation.activate(payment.id),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual([
      'ACTIVATED',
      'ALREADY_ACTIVE',
    ]);
    // Thirty days, not sixty.
    expectNear(
      (await subscriptionOf(center.id)).paid_until,
      Date.now() + 30 * DAY_MS,
    );
  });

  it('keeps both extensions when two different payments activate at once', async () => {
    // A read-then-write of paid_until would lose one of them.
    const center = await makeCenter();
    const a = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);
    const b = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await Promise.all([activation.activate(a.id), activation.activate(b.id)]);

    expectNear(
      (await subscriptionOf(center.id)).paid_until,
      Date.now() + 60 * DAY_MS,
    );
  });
});

describe('failure', () => {
  it('marks a pending payment failed', async () => {
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);

    await expect(activation.markFailed(payment.id)).resolves.toMatchObject({
      outcome: 'MARKED_FAILED',
    });

    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(row.status).toBe('FAILED');
    expectNear(row.failed_at, Date.now());
    // And grants nothing.
    expect((await subscriptionOf(center.id)).paid_until).toBeNull();
  });

  it('never undoes a success', async () => {
    // A failure event arriving after the success, out of order.
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);
    await activation.activate(payment.id);

    await expect(activation.markFailed(payment.id)).resolves.toMatchObject({
      outcome: 'UNCHANGED',
    });
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(row.status).toBe('SUCCEEDED');
  });

  it('still activates a payment that succeeds after being marked failed', async () => {
    // The provider is the authority on whether money moved. A success that
    // arrives late has still taken the center's money.
    const center = await makeCenter();
    const payment = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);
    await activation.markFailed(payment.id);

    await expect(activation.activate(payment.id)).resolves.toMatchObject({
      outcome: 'ACTIVATED',
    });
    expect((await subscriptionOf(center.id)).plan).toBe('PAID');
  });
});

describe('the provider reference', () => {
  it('cannot be shared by two payments', async () => {
    // One provider transaction must never be applied to two payments.
    const center = await makeCenter();
    const a = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);
    const b = await makePayment(center.id, [
      { tier: 'START', seats: 10, price: 4500 },
    ]);
    await prisma.payment.update({
      where: { id: a.id },
      data: { provider_reference: 'ref-1' },
    });

    await expect(
      prisma.payment.update({
        where: { id: b.id },
        data: { provider_reference: 'ref-1' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of payments with no reference yet', async () => {
    const center = await makeCenter();
    await makePayment(center.id, [{ tier: 'START', seats: 10, price: 4500 }]);
    await makePayment(center.id, [{ tier: 'START', seats: 10, price: 4500 }]);

    await expect(
      prisma.payment.count({
        where: { center_id: center.id, provider_reference: null },
      }),
    ).resolves.toBe(2);
  });
});
