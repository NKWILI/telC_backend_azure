import { ServiceUnavailableException } from '@nestjs/common';
import type {
  CheckoutSession,
  PaymentProvider,
  VerifiedPaymentEvent,
} from './payment-provider';

/**
 * The provider in force until one is configured.
 *
 * Every call answers 503 PAYMENT_PROVIDER_NOT_CONFIGURED. A checkout cannot
 * start, and no webhook can be verified — so nothing can reach activation.
 * That is the safe default for an app that deploys itself: forgetting an
 * environment variable leaves payments unavailable, never open.
 */
export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = 'disabled';

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(
      new ServiceUnavailableException('PAYMENT_PROVIDER_NOT_CONFIGURED'),
    );
  }

  verifyWebhook(): Promise<VerifiedPaymentEvent> {
    return Promise.reject(
      new ServiceUnavailableException('PAYMENT_PROVIDER_NOT_CONFIGURED'),
    );
  }
}
