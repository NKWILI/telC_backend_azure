import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-providers/payment-provider';

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

export interface StartedCheckout {
  paymentId: string;
  /** Kept server-side by the controller; returned here for callers that need it. */
  providerReference: string;
  checkoutUrl: string;
}

/**
 * Sends a center to pay for a payment it has already created.
 *
 * Its own service rather than a method on `PaymentsService`: creating a
 * payment prices it and grants nothing, while starting a checkout talks to the
 * outside world. Keeping them apart also keeps the provider out of the
 * creation path, which must keep working when no provider is configured.
 */
@Injectable()
export class PaymentCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Opens a checkout for a pending payment, once.
   *
   * ONE PROVIDER TRANSACTION PER PAYMENT. The first checkout stores the
   * provider's reference and URL; any later one returns what was stored
   * without asking the provider again. A retried or double-clicked checkout
   * that opened a second transaction could be paid as well, and its webhook
   * would name a reference no payment holds.
   *
   * The reference is stored by compare-and-swap (`provider_reference IS
   * NULL`), so of two simultaneous first clicks exactly one stores its
   * session and the other returns that one. The provider is asked outside any
   * database transaction on purpose: holding a lock across a network call to a
   * third party is how a slow provider becomes an outage here.
   *
   * Only PENDING payments. A paid payment must not be paid twice, and a failed
   * one is finished — the center creates a new payment instead.
   */
  async startCheckout(
    identity: SignedCenterIdentity,
    paymentId: string,
  ): Promise<StartedCheckout> {
    const payment = await this.prisma.payment.findFirst({
      // Scoped by center in the query itself. Another center's payment is a
      // 404, never a 403: a 403 would confirm the id exists.
      where: { id: paymentId, center_id: identity.centerId },
      select: {
        status: true,
        amount_xaf: true,
        provider_reference: true,
        checkout_url: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('PAYMENT_NOT_FOUND');
    }

    if (payment.status !== 'PENDING') {
      throw new ConflictException('PAYMENT_NOT_PENDING');
    }

    if (payment.provider_reference && payment.checkout_url) {
      return {
        paymentId,
        providerReference: payment.provider_reference,
        checkoutUrl: payment.checkout_url,
      };
    }

    const session = await this.provider.createCheckout({
      paymentId,
      centerId: identity.centerId,
      amountXaf: payment.amount_xaf,
    });

    const stored = await this.prisma.payment.updateMany({
      where: { id: paymentId, provider_reference: null },
      data: {
        provider_reference: session.providerReference,
        checkout_url: session.checkoutUrl,
      },
    });

    if (stored.count === 1) {
      return { paymentId, ...session };
    }

    // Another request stored its session first. That is the session the
    // center pays through, so it is the one to return.
    const winner = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { provider_reference: true, checkout_url: true },
    });

    if (!winner.provider_reference || !winner.checkout_url) {
      throw new ConflictException('CHECKOUT_IN_PROGRESS');
    }

    return {
      paymentId,
      providerReference: winner.provider_reference,
      checkoutUrl: winner.checkout_url,
    };
  }
}
