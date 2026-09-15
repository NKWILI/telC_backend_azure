import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  PaymentActivationService,
  type ActivationOutcome,
  type FailureResult,
} from './payment-activation.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type WebhookHeaders,
} from './payment-providers/payment-provider';

export interface WebhookReceipt {
  received: true;
  outcome: ActivationOutcome | FailureResult['outcome'];
}

/**
 * Turns a provider's webhook into a settled payment, in a fixed order.
 *
 * 1. PROVE it. The provider verifies the signature over the raw bytes before
 *    anything is read, looked up or changed. An unverified event touches
 *    nothing — not even a query.
 * 2. FIND the payment by the provider's reference, stored when the checkout
 *    started.
 * 3. SETTLE it through PaymentActivationService, which alone decides what a
 *    success grants and guarantees it happens once.
 *
 * Nothing here writes seats, plans or dates. That keeps the exactly-once and
 * grandfathering rules in one place, whichever provider sent the event.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activation: PaymentActivationService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    headers: WebhookHeaders,
  ): Promise<WebhookReceipt> {
    // No bytes, nothing to verify. Falling back to the parsed body would
    // verify the wrong thing, so a missing `rawBody: true` fails loudly here
    // instead of letting every genuine webhook fail quietly.
    if (!rawBody) {
      throw new BadRequestException('WEBHOOK_RAW_BODY_UNAVAILABLE');
    }

    const event = await this.provider.verifyWebhook(rawBody, headers);

    const payment = await this.prisma.payment.findUnique({
      where: { provider_reference: event.providerReference },
      select: { id: true },
    });

    if (!payment) {
      // 404 so the provider retries. The likeliest cause is the checkout
      // response and the webhook crossing in flight, before the reference was
      // stored — a retry a moment later will find it.
      this.logger.warn(
        `Verified payment event for unknown reference ${event.providerReference}`,
      );
      throw new NotFoundException('PAYMENT_REFERENCE_UNKNOWN');
    }

    const result =
      event.outcome === 'SUCCEEDED'
        ? await this.activation.activate(payment.id)
        : await this.activation.markFailed(payment.id);

    // 200 for a duplicate as well as a first delivery. The provider only
    // needs to know it can stop retrying; whether anything changed is
    // activation's concern and is reported in `outcome`.
    return { received: true, outcome: result.outcome };
  }
}
