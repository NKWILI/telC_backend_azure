/**
 * The whole fake payment flow, end to end, against real rows.
 *
 * Every piece is proven on its own elsewhere — activation against Postgres,
 * checkout against Postgres, the webhook on the HTTP stack with activation
 * mocked. What none of them shows is the pieces agreeing with each other: that
 * the reference checkout stores is the one a webhook finds, that the price
 * creation computes is the price activation stamps, and that a student's
 * access actually switches on at the end.
 *
 * This is Checkpoint B's evidence, and the flow Herman's Notch Pay provider
 * has to keep working when it replaces the fake.
 *
 * Runs against the disposable branch in `.env.test`.
 */
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../src/shared/services/prisma.service';
import { PricingService } from '../src/modules/centers/pricing.service';
import { CenterSeatsService } from '../src/modules/centers/center-seats.service';
import { PaymentsService } from '../src/modules/centers/payments.service';
import { PaymentCheckoutService } from '../src/modules/centers/payment-checkout.service';
import { PaymentActivationService } from '../src/modules/centers/payment-activation.service';
import { PaymentWebhookService } from '../src/modules/centers/payment-webhook.service';
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import {
  FakePaymentProvider,
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '../src/modules/centers/payment-providers/fake-payment-provider';

const SECRET = 'a-long-enough-fake-webhook-secret-for-tests';

const prisma = new PrismaService();
const provider = new FakePaymentProvider(SECRET);
const payments = new PaymentsService(
  prisma,
  new PricingService(),
  new CenterSeatsService(prisma),
);
const checkout = new PaymentCheckoutService(prisma, provider);
const activation = new PaymentActivationService(prisma);
const webhooks = new PaymentWebhookService(prisma, activation, provider);
const entitlement = new StudentEntitlementService(
  prisma,
  new SubscriptionPolicyService(),
);

async function wipe() {
  // Managers first: center_users has no cascade from centers.
  await prisma.centerUser.deleteMany({
    where: { email: { startsWith: 'flow-test-' } },
  });
  await prisma.student.deleteMany({
    where: { email: { startsWith: 'flow-test-' } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Flow Test' } },
  });
}

/**
 * A center as it stands on the day it decides to pay: registered, profile
 * finished (so the payment gate lets it through), still on its one free Start
 * seat, with one student sitting in it.
 */
async function makeTrialCenter() {
  const center = await prisma.center.create({
    data: {
      name: `Flow Test ${Date.now()}-${Math.random()}`,
      country: 'Cameroon',
      city: 'Douala',
      subscription: { create: { plan: 'TRIAL' } },
      seats: { create: { tier: 'START', quantity: 1, unit_price_xaf: 0 } },
    },
  });
  const manager = await prisma.centerUser.create({
    data: {
      center_id: center.id,
      role: 'OWNER',
      first_name: 'Alain',
      last_name: 'Ngeukeu',
      email: `flow-test-owner-${center.id}@example.com`,
      password_hash: 'x',
      email_verified: true,
      phone: '+237690000000',
    },
  });
  const student = await prisma.student.create({
    data: {
      email: `flow-test-student-${center.id}@example.com`,
      center_id: center.id,
      tier: 'START',
    },
  });

  return {
    center,
    student,
    identity: { centerId: center.id, centerUserId: manager.id } as never,
  };
}

/** A webhook exactly as the provider would deliver it: bytes and signature. */
const delivery = (
  payload: { reference: string; outcome: 'SUCCEEDED' | 'FAILED' },
  secret = SECRET,
) => {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(secret, rawBody) },
  };
};

/** Create a payment and open its checkout, as a center clicking "pay" would. */
async function payAndCheckout(identity: never, key: string) {
  const payment = await payments.create(identity, { START: 10 }, key);
  const session = await checkout.startCheckout(identity, payment.id);
  return { payment, session };
}

const paymentStatus = async (id: string) =>
  (await prisma.payment.findUniqueOrThrow({ where: { id } })).status;

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.onModuleDestroy();
});

describe('the whole flow', () => {
  it('turns a trial center into a paying one and switches its students on', async () => {
    const { center, student, identity } = await makeTrialCenter();

    // Before paying: the trial has not started, so nobody is ACTIVE.
    await expect(entitlement.forStudent(student.id)).resolves.not.toMatchObject(
      { status: 'ACTIVE' },
    );

    const { payment, session } = await payAndCheckout(identity, 'flow-1');
    expect(payment.amountXaf).toBe(45000);

    const { rawBody, headers } = delivery({
      reference: session.providerReference,
      outcome: 'SUCCEEDED',
    });
    await expect(webhooks.handle(rawBody, headers)).resolves.toEqual({
      received: true,
      outcome: 'ACTIVATED',
    });

    // The student has access, the seats are the ones bought at the price
    // creation computed, and the trial seat at zero is gone.
    await expect(entitlement.forStudent(student.id)).resolves.toMatchObject({
      status: 'ACTIVE',
      studentsMayLearn: true,
      tier: 'START',
    });
    await expect(
      prisma.centerSeat.findMany({
        where: { center_id: center.id },
        select: { tier: true, quantity: true, unit_price_xaf: true },
      }),
    ).resolves.toEqual([{ tier: 'START', quantity: 10, unit_price_xaf: 4500 }]);
    expect(await paymentStatus(payment.id)).toBe('SUCCEEDED');
  });
});

describe('events that must not grant access', () => {
  it('ignores a success signed with the wrong secret', async () => {
    const { student, identity } = await makeTrialCenter();
    const { payment, session } = await payAndCheckout(identity, 'forged');

    const { rawBody, headers } = delivery(
      { reference: session.providerReference, outcome: 'SUCCEEDED' },
      'an-attackers-guess-at-the-webhook-secret-value',
    );

    await expect(webhooks.handle(rawBody, headers)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(await paymentStatus(payment.id)).toBe('PENDING');
    await expect(entitlement.forStudent(student.id)).resolves.not.toMatchObject(
      { status: 'ACTIVE' },
    );
  });

  it('ignores a failure rewritten into a success after signing', async () => {
    const { student, identity } = await makeTrialCenter();
    const { payment, session } = await payAndCheckout(identity, 'tampered');

    const genuine = delivery({
      reference: session.providerReference,
      outcome: 'FAILED',
    });
    const rewritten = Buffer.from(
      JSON.stringify({
        reference: session.providerReference,
        outcome: 'SUCCEEDED',
      }),
    );

    await expect(
      webhooks.handle(rewritten, genuine.headers),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await paymentStatus(payment.id)).toBe('PENDING');
    await expect(entitlement.forStudent(student.id)).resolves.not.toMatchObject(
      { status: 'ACTIVE' },
    );
  });

  it('applies a duplicated success once', async () => {
    const { center, identity } = await makeTrialCenter();
    const { session } = await payAndCheckout(identity, 'duplicate');
    const event = delivery({
      reference: session.providerReference,
      outcome: 'SUCCEEDED',
    });

    await webhooks.handle(event.rawBody, event.headers);
    const once = (
      await prisma.centerSubscription.findUniqueOrThrow({
        where: { center_id: center.id },
      })
    ).paid_until;

    await expect(
      webhooks.handle(event.rawBody, event.headers),
    ).resolves.toEqual({ received: true, outcome: 'ALREADY_ACTIVE' });
    expect(
      (
        await prisma.centerSubscription.findUniqueOrThrow({
          where: { center_id: center.id },
        })
      ).paid_until,
    ).toEqual(once);
  });

  it('keeps access when a failure arrives after the success', async () => {
    // Reordered delivery. The failure is genuine and signed; it simply
    // arrives late, and must not take away what the success granted.
    const { student, identity } = await makeTrialCenter();
    const { payment, session } = await payAndCheckout(identity, 'reordered');

    const success = delivery({
      reference: session.providerReference,
      outcome: 'SUCCEEDED',
    });
    const lateFailure = delivery({
      reference: session.providerReference,
      outcome: 'FAILED',
    });

    await webhooks.handle(success.rawBody, success.headers);
    await expect(
      webhooks.handle(lateFailure.rawBody, lateFailure.headers),
    ).resolves.toEqual({ received: true, outcome: 'UNCHANGED' });

    expect(await paymentStatus(payment.id)).toBe('SUCCEEDED');
    await expect(entitlement.forStudent(student.id)).resolves.toMatchObject({
      status: 'ACTIVE',
    });
  });
});
