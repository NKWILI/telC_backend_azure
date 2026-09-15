/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PaymentWebhooksController } from '../src/modules/centers/payment-webhooks.controller';
import { PaymentWebhookService } from '../src/modules/centers/payment-webhook.service';
import { PaymentActivationService } from '../src/modules/centers/payment-activation.service';
import { PrismaService } from '../src/shared/services/prisma.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../src/modules/centers/payment-providers/payment-provider';
import {
  FakePaymentProvider,
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '../src/modules/centers/payment-providers/fake-payment-provider';
import { DisabledPaymentProvider } from '../src/modules/centers/payment-providers/disabled-payment-provider';

const SECRET = 'a-long-enough-fake-webhook-secret-for-tests';
const ROUTE = '/api/webhooks/payments';

/**
 * The only door through which a payment becomes access.
 *
 * Built on the real HTTP stack with the real fake provider, because the
 * property under test lives between them: the signature must be checked over
 * the exact bytes that arrived. A test that called the service with an object
 * would pass even if the controller re-serialised the JSON and verified that,
 * which real providers' signatures would never match.
 *
 * Activation itself is mocked here; that it grants exactly once is proven
 * against Postgres in payment-activation-integration.spec.
 */
describe('POST /api/webhooks/payments', () => {
  let app: INestApplication<App>;
  let prisma: { payment: { findUnique: jest.Mock } };
  let activation: { activate: jest.Mock; markFailed: jest.Mock };

  const build = async (
    provider: PaymentProvider = new FakePaymentProvider(SECRET),
    rawBody = true,
  ) => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      },
    };
    activation = {
      activate: jest.fn().mockResolvedValue({
        outcome: 'ACTIVATED',
        paymentId: 'payment-1',
        centerId: 'center-1',
        paidUntil: new Date('2026-10-16T00:00:00.000Z'),
      }),
      markFailed: jest.fn().mockResolvedValue({
        outcome: 'MARKED_FAILED',
        paymentId: 'payment-1',
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [PaymentWebhooksController],
      providers: [
        PaymentWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentActivationService, useValue: activation },
        { provide: PAYMENT_PROVIDER, useValue: provider },
      ],
    }).compile();

    app = module.createNestApplication({ rawBody });
    await app.init();
  };

  afterEach(async () => {
    await app?.close();
  });

  /** Sends exactly these bytes, signed over exactly these bytes. */
  const deliver = (raw: string, signature?: string) => {
    const req = request(app.getHttpServer())
      .post(ROUTE)
      .set('Content-Type', 'application/json');
    if (signature !== undefined) req.set(FAKE_SIGNATURE_HEADER, signature);
    return req.send(raw);
  };

  const sign = (raw: string) => signFakeWebhook(SECRET, Buffer.from(raw));

  describe('a genuine event', () => {
    beforeEach(() => build());

    it('activates the payment the reference names', async () => {
      const raw = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'SUCCEEDED',
      });

      const response = await deliver(raw, sign(raw)).expect(200);

      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { provider_reference: 'fake_payment-1' },
        select: { id: true },
      });
      expect(activation.activate).toHaveBeenCalledWith('payment-1');
      expect(response.body).toEqual({ received: true, outcome: 'ACTIVATED' });
    });

    it('marks a reported failure, and grants nothing', async () => {
      const raw = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'FAILED',
      });

      const response = await deliver(raw, sign(raw)).expect(200);

      expect(activation.markFailed).toHaveBeenCalledWith('payment-1');
      expect(activation.activate).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        received: true,
        outcome: 'MARKED_FAILED',
      });
    });

    it('acknowledges a duplicate so the provider stops retrying', async () => {
      // Exactly-once lives in activation; the webhook only has to answer 200
      // so the provider does not keep redelivering an event already applied.
      activation.activate.mockResolvedValue({
        outcome: 'ALREADY_ACTIVE',
        paymentId: 'payment-1',
        centerId: 'center-1',
        paidUntil: null,
      });
      const raw = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'SUCCEEDED',
      });

      const response = await deliver(raw, sign(raw)).expect(200);

      expect(response.body.outcome).toBe('ALREADY_ACTIVE');
    });

    it('verifies the bytes that arrived, not a re-serialisation of them', async () => {
      // Whitespace and key order JSON.stringify would not reproduce. Signed
      // over these exact bytes, it must verify; a controller that parsed the
      // body and re-stringified it would compute a different signature.
      const raw =
        '{ "outcome" : "SUCCEEDED",\n  "reference" :   "fake_payment-1" }';

      await deliver(raw, sign(raw)).expect(200);

      expect(activation.activate).toHaveBeenCalledWith('payment-1');
    });
  });

  describe('an event that cannot be trusted', () => {
    beforeEach(() => build());

    it('refuses an unsigned event and changes nothing', async () => {
      const raw = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'SUCCEEDED',
      });

      const response = await deliver(raw).expect(401);

      expect(response.body.error).toBe('WEBHOOK_SIGNATURE_INVALID');
      expect(activation.activate).not.toHaveBeenCalled();
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('refuses a body changed after it was signed', async () => {
      const signedFor = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'FAILED',
      });
      const tampered = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'SUCCEEDED',
      });

      await deliver(tampered, sign(signedFor)).expect(401);

      expect(activation.activate).not.toHaveBeenCalled();
    });

    it('refuses a genuine event for a reference no payment holds', async () => {
      // 404 so the provider retries: the reference may simply not be stored
      // yet if the checkout response and the webhook crossed in flight.
      prisma.payment.findUnique.mockResolvedValue(null);
      const raw = JSON.stringify({
        reference: 'fake_unknown',
        outcome: 'SUCCEEDED',
      });

      const response = await deliver(raw, sign(raw)).expect(404);

      expect(response.body.error).toBe('PAYMENT_REFERENCE_UNKNOWN');
      expect(activation.activate).not.toHaveBeenCalled();
    });
  });

  describe('configuration that must fail closed', () => {
    it('answers 503 when no provider is configured', async () => {
      await build(new DisabledPaymentProvider());
      const raw = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'SUCCEEDED',
      });

      const response = await deliver(raw, sign(raw)).expect(503);

      expect(response.body.error).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
      expect(activation.activate).not.toHaveBeenCalled();
    });

    it('refuses rather than guesses when the raw body was not kept', async () => {
      // If the app is ever created without `rawBody: true`, there are no
      // bytes to verify. Falling back to the parsed body would verify the
      // wrong thing; refusing makes the misconfiguration loud.
      await build(new FakePaymentProvider(SECRET), false);
      const raw = JSON.stringify({
        reference: 'fake_payment-1',
        outcome: 'SUCCEEDED',
      });

      const response = await deliver(raw, sign(raw)).expect(400);

      expect(response.body.error).toBe('WEBHOOK_RAW_BODY_UNAVAILABLE');
      expect(activation.activate).not.toHaveBeenCalled();
    });
  });

  describe('who may call it', () => {
    const guardsOn = (target: object): unknown[] =>
      (Reflect.getMetadata('__guards__', target) ?? []) as unknown[];

    it('carries no authentication guard, because the provider holds no token', () => {
      // The signature is the authentication. A center or student guard here
      // would refuse every real delivery.
      expect(guardsOn(PaymentWebhooksController)).toEqual([]);
      expect(
        guardsOn(PaymentWebhooksController.prototype.receive as object),
      ).toEqual([]);
    });
  });
});
