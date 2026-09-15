import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  selectPaymentProvider,
  MIN_FAKE_WEBHOOK_SECRET_LENGTH,
  type PaymentProvider,
} from '../src/modules/centers/payment-providers/payment-provider';
import {
  FakePaymentProvider,
  FAKE_SIGNATURE_HEADER,
  signFakeWebhook,
} from '../src/modules/centers/payment-providers/fake-payment-provider';
import { DisabledPaymentProvider } from '../src/modules/centers/payment-providers/disabled-payment-provider';

const SECRET = 'a-long-enough-fake-webhook-secret-for-tests';

/**
 * The seam Herman's Notch Pay integration plugs into, and the fake that lets
 * the whole payment flow be exercised before it exists.
 *
 * The property that matters most is not the happy path: `main` auto-deploys,
 * so a provider that accepts forged "payment succeeded" events must be
 * impossible to switch on by forgetting an environment variable.
 */
describe('choosing the payment provider', () => {
  it('uses the fake only when asked for, outside production, with a secret', () => {
    expect(
      selectPaymentProvider({
        PAYMENT_PROVIDER: 'fake',
        NODE_ENV: 'development',
        FAKE_PAYMENT_WEBHOOK_SECRET: SECRET,
      }),
    ).toBeInstanceOf(FakePaymentProvider);
  });

  it('is disabled when nothing is configured', () => {
    // The default on a fresh deploy. Every call answers 503 rather than
    // pretending to take money.
    expect(selectPaymentProvider({})).toBeInstanceOf(DisabledPaymentProvider);
  });

  it('never uses the fake in production, whatever else is set', () => {
    expect(
      selectPaymentProvider({
        PAYMENT_PROVIDER: 'fake',
        NODE_ENV: 'production',
        FAKE_PAYMENT_WEBHOOK_SECRET: SECRET,
      }),
    ).toBeInstanceOf(DisabledPaymentProvider);
  });

  it('refuses the fake without a secret', () => {
    // A fake with no secret would accept any unsigned event.
    expect(
      selectPaymentProvider({
        PAYMENT_PROVIDER: 'fake',
        NODE_ENV: 'development',
      }),
    ).toBeInstanceOf(DisabledPaymentProvider);
  });

  it('refuses the fake with a secret too short to mean anything', () => {
    expect(
      selectPaymentProvider({
        PAYMENT_PROVIDER: 'fake',
        NODE_ENV: 'development',
        FAKE_PAYMENT_WEBHOOK_SECRET: 'x'.repeat(
          MIN_FAKE_WEBHOOK_SECRET_LENGTH - 1,
        ),
      }),
    ).toBeInstanceOf(DisabledPaymentProvider);
  });

  it('is disabled for a provider name it does not know', () => {
    // Including "notchpay" until that implementation exists. A typo must not
    // fall through to anything that accepts payments.
    expect(
      selectPaymentProvider({
        PAYMENT_PROVIDER: 'notchpay',
        NODE_ENV: 'development',
        FAKE_PAYMENT_WEBHOOK_SECRET: SECRET,
      }),
    ).toBeInstanceOf(DisabledPaymentProvider);
  });
});

describe('the disabled provider', () => {
  // Typed as the port, not the class. Callers only ever hold a
  // PaymentProvider, so this is the contract worth testing — and the class
  // itself may ignore arguments it has no use for.
  const provider: PaymentProvider = new DisabledPaymentProvider();

  it('refuses to start a checkout', async () => {
    await expect(
      provider.createCheckout({
        paymentId: 'p1',
        centerId: 'c1',
        amountXaf: 45000,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses every webhook, so nothing can be activated through it', async () => {
    await expect(provider.verifyWebhook(Buffer.from('{}'), {})).rejects.toThrow(
      'PAYMENT_PROVIDER_NOT_CONFIGURED',
    );
  });
});

describe('the fake provider', () => {
  const provider = new FakePaymentProvider(SECRET);

  const signed = (payload: unknown, secret = SECRET) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return {
      raw,
      headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(secret, raw) },
    };
  };

  describe('checkout', () => {
    it('returns one stable reference per payment', async () => {
      // Stable so a repeated checkout for the same payment names the same
      // provider transaction, as the unique index on payments requires.
      const request = { paymentId: 'p1', centerId: 'c1', amountXaf: 45000 };

      const first = await provider.createCheckout(request);
      const second = await provider.createCheckout(request);

      expect(first.providerReference).toBe(second.providerReference);
      expect(first.providerReference).toContain('p1');
    });

    it('returns a checkout URL that cannot reach a real payment page', async () => {
      // The .invalid top-level domain is reserved and never resolves, so the
      // fake can never be mistaken for a working checkout.
      const session = await provider.createCheckout({
        paymentId: 'p1',
        centerId: 'c1',
        amountXaf: 45000,
      });

      expect(new URL(session.checkoutUrl).hostname.endsWith('.invalid')).toBe(
        true,
      );
    });
  });

  describe('webhooks', () => {
    it('accepts a correctly signed success', async () => {
      const { raw, headers } = signed({
        reference: 'fake_p1',
        outcome: 'SUCCEEDED',
      });

      await expect(provider.verifyWebhook(raw, headers)).resolves.toEqual({
        providerReference: 'fake_p1',
        outcome: 'SUCCEEDED',
      });
    });

    it('accepts a correctly signed failure', async () => {
      const { raw, headers } = signed({
        reference: 'fake_p1',
        outcome: 'FAILED',
      });

      await expect(provider.verifyWebhook(raw, headers)).resolves.toEqual({
        providerReference: 'fake_p1',
        outcome: 'FAILED',
      });
    });

    it('refuses an event with no signature', async () => {
      await expect(
        provider.verifyWebhook(
          Buffer.from(
            JSON.stringify({ reference: 'fake_p1', outcome: 'SUCCEEDED' }),
          ),
          {},
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses an event signed with the wrong secret', async () => {
      const { raw, headers } = signed(
        { reference: 'fake_p1', outcome: 'SUCCEEDED' },
        'someone-elses-secret-that-is-also-long-enough',
      );

      await expect(provider.verifyWebhook(raw, headers)).rejects.toThrow(
        'WEBHOOK_SIGNATURE_INVALID',
      );
    });

    it('refuses a body altered after signing', async () => {
      // The signature covers the exact bytes. Changing FAILED to SUCCEEDED in
      // transit must not survive verification.
      const { headers } = signed({ reference: 'fake_p1', outcome: 'FAILED' });
      const tampered = Buffer.from(
        JSON.stringify({ reference: 'fake_p1', outcome: 'SUCCEEDED' }),
      );

      await expect(provider.verifyWebhook(tampered, headers)).rejects.toThrow(
        'WEBHOOK_SIGNATURE_INVALID',
      );
    });

    it('refuses a signature of the wrong length without throwing a crash', async () => {
      // timingSafeEqual throws on unequal lengths; that must become a clean
      // refusal, not a 500.
      const raw = Buffer.from('{}');

      await expect(
        provider.verifyWebhook(raw, { [FAKE_SIGNATURE_HEADER]: 'abc' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it.each([
      ['not JSON', 'not json'],
      ['no reference', JSON.stringify({ outcome: 'SUCCEEDED' })],
      [
        'an unknown outcome',
        JSON.stringify({ reference: 'fake_p1', outcome: 'MAYBE' }),
      ],
      [
        'a non-string reference',
        JSON.stringify({ reference: 42, outcome: 'SUCCEEDED' }),
      ],
    ])('refuses a signed payload with %s', async (_case, body) => {
      // Signed but malformed: verified, yet unusable. A 400, never a guess.
      const raw = Buffer.from(body);

      await expect(
        provider.verifyWebhook(raw, {
          [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, raw),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
