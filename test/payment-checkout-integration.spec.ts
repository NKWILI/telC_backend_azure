/**
 * Starting a checkout, against real rows.
 *
 * The claims here are about what gets stored and how often the provider is
 * asked: a repeated checkout must reuse the session already opened rather than
 * open a second provider transaction for one payment. A mocked Prisma cannot
 * say whether the reference was really stored once.
 *
 * Runs against the disposable branch in `.env.test`.
 */
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../src/shared/services/prisma.service';
import { PaymentCheckoutService } from '../src/modules/centers/payment-checkout.service';
import { FakePaymentProvider } from '../src/modules/centers/payment-providers/fake-payment-provider';
import { DisabledPaymentProvider } from '../src/modules/centers/payment-providers/disabled-payment-provider';
import type {
  CheckoutRequest,
  PaymentProvider,
} from '../src/modules/centers/payment-providers/payment-provider';

const prisma = new PrismaService();
const SECRET = 'a-long-enough-fake-webhook-secret-for-tests';

/** The real fake, with a count of how often it was asked to open a session. */
class CountingProvider extends FakePaymentProvider {
  calls = 0;

  constructor() {
    super(SECRET);
  }

  override createCheckout(request: CheckoutRequest) {
    this.calls += 1;
    return super.createCheckout(request);
  }
}

/**
 * A provider that opens a NEW transaction on every call, as real providers do,
 * and holds each call until two have arrived.
 *
 * The hold is what makes the race real. Without it, `Promise.all` does not
 * guarantee both requests read "no session stored" before either writes: the
 * second usually finds the first one's session and returns early, and the
 * compare-and-swap is never exercised — a mutation removing it survived for
 * exactly that reason. Held here, both requests are past that read, both
 * providers have opened distinct transactions, and only the compare-and-swap
 * can make the two clicks agree.
 */
class RacingProvider extends FakePaymentProvider {
  private opened = 0;
  private releaseBoth!: () => void;
  private readonly bothInside = new Promise<void>((resolve) => {
    this.releaseBoth = resolve;
  });

  constructor() {
    super(SECRET);
  }

  override async createCheckout(request: CheckoutRequest) {
    this.opened += 1;
    const mine = this.opened;
    if (mine === 2) this.releaseBoth();
    await this.bothInside;

    const session = await super.createCheckout(request);
    const providerReference = `${session.providerReference}_${mine}`;

    return {
      providerReference,
      checkoutUrl: `https://checkout.fake-payments.invalid/${providerReference}`,
    };
  }
}

const identity = (centerId: string) => ({ centerId }) as never;

async function wipe() {
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Checkout Test' } },
  });
}

async function makeCenter() {
  return prisma.center.create({
    data: {
      name: `Checkout Test ${Date.now()}-${Math.random()}`,
      country_code: 'CM',
      city_id: 'douala',
      subscription: { create: { plan: 'TRIAL' } },
    },
  });
}

async function makePayment(
  centerId: string,
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'PENDING',
) {
  return prisma.payment.create({
    data: {
      center_id: centerId,
      total_seats: 10,
      amount_xaf: 45000,
      status,
      idempotency_key: `checkout-${Date.now()}-${Math.random()}`,
      request_hash: 'test',
      lines: {
        create: [
          { tier: 'START', seats: 10, unit_price_xaf: 4500, amount_xaf: 45000 },
        ],
      },
    },
  });
}

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.onModuleDestroy();
});

describe('starting a checkout', () => {
  it('opens a session and stores its reference and URL on the payment', async () => {
    const provider = new CountingProvider();
    const checkout = new PaymentCheckoutService(prisma, provider);
    const center = await makeCenter();
    const payment = await makePayment(center.id);

    const session = await checkout.startCheckout(
      identity(center.id),
      payment.id,
    );

    expect(session.paymentId).toBe(payment.id);
    expect(session.checkoutUrl).toContain('.invalid');
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(row.provider_reference).toBe(`fake_${payment.id}`);
    expect(row.checkout_url).toBe(session.checkoutUrl);
  });

  it('reuses the stored session instead of asking the provider again', async () => {
    // A retried or double-clicked checkout must not open a second provider
    // transaction for one payment — the second could be paid as well, and its
    // webhook would name a reference nothing holds.
    const provider = new CountingProvider();
    const checkout = new PaymentCheckoutService(prisma, provider);
    const center = await makeCenter();
    const payment = await makePayment(center.id);

    const first = await checkout.startCheckout(identity(center.id), payment.id);
    const second = await checkout.startCheckout(
      identity(center.id),
      payment.id,
    );

    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(provider.calls).toBe(1);
  });

  it('answers two simultaneous clicks with one stored session', async () => {
    const provider = new RacingProvider();
    const checkout = new PaymentCheckoutService(prisma, provider);
    const center = await makeCenter();
    const payment = await makePayment(center.id);

    const [a, b] = await Promise.all([
      checkout.startCheckout(identity(center.id), payment.id),
      checkout.startCheckout(identity(center.id), payment.id),
    ]);

    expect(a.checkoutUrl).toBe(b.checkoutUrl);
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    // The stored session is the one both clicks were given, reference and URL
    // together.
    expect(row.checkout_url).toBe(a.checkoutUrl);
    expect(a.checkoutUrl.endsWith(row.provider_reference ?? '')).toBe(true);
  });
});

describe('what a checkout refuses', () => {
  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'refuses a payment that is already %s, without asking the provider',
    async (status) => {
      // A paid payment must not be paid twice, and a failed one is finished:
      // the center starts a new payment instead.
      const provider = new CountingProvider();
      const checkout = new PaymentCheckoutService(prisma, provider);
      const center = await makeCenter();
      const payment = await makePayment(center.id, status);

      await expect(
        checkout.startCheckout(identity(center.id), payment.id),
      ).rejects.toThrow(ConflictException);
      await expect(
        checkout.startCheckout(identity(center.id), payment.id),
      ).rejects.toThrow('PAYMENT_NOT_PENDING');
      expect(provider.calls).toBe(0);
    },
  );

  it("refuses another center's payment as not found", async () => {
    // 404, never 403: a 403 would confirm the id exists.
    const provider = new CountingProvider();
    const checkout = new PaymentCheckoutService(prisma, provider);
    const mine = await makeCenter();
    const theirs = await makeCenter();
    const payment = await makePayment(theirs.id);

    await expect(
      checkout.startCheckout(identity(mine.id), payment.id),
    ).rejects.toThrow(NotFoundException);
    expect(provider.calls).toBe(0);
  });

  it('stores nothing when no provider is configured', async () => {
    const checkout = new PaymentCheckoutService(
      prisma,
      new DisabledPaymentProvider() as PaymentProvider,
    );
    const center = await makeCenter();
    const payment = await makePayment(center.id);

    await expect(
      checkout.startCheckout(identity(center.id), payment.id),
    ).rejects.toThrow(ServiceUnavailableException);

    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(row.provider_reference).toBeNull();
    expect(row.checkout_url).toBeNull();
  });
});
