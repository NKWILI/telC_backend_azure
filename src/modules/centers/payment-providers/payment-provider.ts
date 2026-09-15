import { DisabledPaymentProvider } from './disabled-payment-provider';
import { FakePaymentProvider } from './fake-payment-provider';

/** Injection token. The implementation is chosen once, at boot. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/**
 * The shortest fake webhook secret accepted. A short secret can be guessed,
 * and a guessed secret lets anyone forge "payment succeeded".
 */
export const MIN_FAKE_WEBHOOK_SECRET_LENGTH = 32;

export interface CheckoutRequest {
  paymentId: string;
  centerId: string;
  /** Computed by the server when the payment was created. Never a client value. */
  amountXaf: number;
}

export interface CheckoutSession {
  /**
   * The provider's own id for this transaction. Stored on the payment and
   * unique there, so a webhook can find its payment and one provider
   * transaction can never be applied to two payments.
   */
  providerReference: string;
  /** Where the center is sent to pay. */
  checkoutUrl: string;
}

export type VerifiedOutcome = 'SUCCEEDED' | 'FAILED';

/** A webhook whose authenticity has been proven. Nothing else reaches activation. */
export interface VerifiedPaymentEvent {
  providerReference: string;
  outcome: VerifiedOutcome;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/**
 * What a payment provider has to do for Lerniqo, and nothing more.
 *
 * Deliberately two methods. A provider starts a checkout and proves a webhook
 * genuine; it never grants access. Turning a verified event into seats and
 * paid time is `PaymentActivationService`'s job alone, so a provider cannot
 * get grandfathering or exactly-once wrong — it never touches those tables.
 *
 * Implementations: `FakePaymentProvider` for development and tests,
 * `DisabledPaymentProvider` as the default, and Notch Pay's, added in Phase 7.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Proves the event came from the provider and returns what it says.
   *
   * `rawBody` is the exact bytes received. Signatures are computed over bytes,
   * and re-serialising parsed JSON does not reproduce them.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<VerifiedPaymentEvent>;
}

export interface PaymentProviderSettings {
  PAYMENT_PROVIDER?: string;
  NODE_ENV?: string;
  FAKE_PAYMENT_WEBHOOK_SECRET?: string;
}

/**
 * Picks the provider from configuration, failing closed.
 *
 * `main` deploys itself, so the rule is: nothing that accepts payment events
 * is ever switched on by default or by accident. The fake needs to be asked
 * for by name, outside production, with a secret long enough not to be
 * guessed. Anything else — nothing set, a typo, a provider not yet written —
 * gets the disabled provider, which refuses every call with a 503.
 *
 * Phase 7 adds a `notchpay` branch here. Until then that name is disabled
 * too, deliberately: an unknown provider must never fall through to one that
 * accepts forged events.
 */
export function selectPaymentProvider(
  settings: PaymentProviderSettings,
): PaymentProvider {
  const secret = settings.FAKE_PAYMENT_WEBHOOK_SECRET ?? '';

  if (
    settings.PAYMENT_PROVIDER === 'fake' &&
    settings.NODE_ENV !== 'production' &&
    secret.length >= MIN_FAKE_WEBHOOK_SECRET_LENGTH
  ) {
    return new FakePaymentProvider(secret);
  }

  return new DisabledPaymentProvider();
}
