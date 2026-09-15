import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  VerifiedOutcome,
  VerifiedPaymentEvent,
  WebhookHeaders,
} from './payment-provider';

/** Where the fake's signature travels. Express lower-cases header names. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

const OUTCOMES: readonly VerifiedOutcome[] = ['SUCCEEDED', 'FAILED'];

/**
 * How a fake webhook is signed: HMAC-SHA256 of the exact body bytes, hex.
 *
 * Exported so tests and the Bruno collection can produce a valid event. It is
 * the same shape real providers use, which is the point — Notch Pay's
 * verification will slot into the same place.
 */
export function signFakeWebhook(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * A payment provider that moves no money, for building and testing the whole
 * payment flow before Notch Pay is connected.
 *
 * It is not a toy that trusts its input. Webhooks must carry a valid
 * signature over the raw body, exactly as a real provider's would, so the flow
 * it exercises is the flow production will run — and so that switching it on
 * somewhere it should not be still does not let anyone forge a payment without
 * the secret. `selectPaymentProvider` also refuses to switch it on in
 * production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';

  constructor(private readonly secret: string) {}

  /**
   * One stable reference per payment, so a repeated checkout for the same
   * payment names the same transaction. The URL is on the reserved `.invalid`
   * domain, which never resolves, so it can never be mistaken for a real
   * payment page.
   */
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerReference = `fake_${request.paymentId}`;

    return Promise.resolve({
      providerReference,
      checkoutUrl: `https://checkout.fake-payments.invalid/${encodeURIComponent(providerReference)}`,
    });
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<VerifiedPaymentEvent> {
    // Inside the executor, so a refusal becomes a rejected promise rather
    // than a synchronous throw a caller awaiting the result would not expect.
    return new Promise((resolve) => resolve(this.verify(rawBody, headers)));
  }

  private verify(
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): VerifiedPaymentEvent {
    const header = headers[FAKE_SIGNATURE_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;

    if (!presented || !this.signatureMatches(rawBody, presented)) {
      throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID');
    }

    // Verified before parsed. A payload is only worth reading once it is
    // known to be genuine.
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('WEBHOOK_PAYLOAD_INVALID');
    }

    const { reference, outcome } = (payload ?? {}) as {
      reference?: unknown;
      outcome?: unknown;
    };

    if (
      typeof reference !== 'string' ||
      reference.length === 0 ||
      !OUTCOMES.includes(outcome as VerifiedOutcome)
    ) {
      throw new BadRequestException('WEBHOOK_PAYLOAD_INVALID');
    }

    return {
      providerReference: reference,
      outcome: outcome as VerifiedOutcome,
    };
  }

  /**
   * Constant-time comparison, so response timing reveals nothing about how
   * much of a guessed signature was right. `timingSafeEqual` throws when the
   * lengths differ, so that is checked first and answered as a mismatch
   * rather than surfacing as a 500.
   */
  private signatureMatches(rawBody: Buffer, presented: string): boolean {
    const expected = Buffer.from(signFakeWebhook(this.secret, rawBody), 'utf8');
    const given = Buffer.from(presented, 'utf8');

    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
