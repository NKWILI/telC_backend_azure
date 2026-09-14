import { Injectable, NotFoundException } from '@nestjs/common';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionStatus,
} from './subscription-policy.service';
import { PricingService, type Quote, type SeatMix } from './pricing.service';
import { CenterSeatsService } from './center-seats.service';

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

export interface CenterSubscriptionView {
  status: CenterSubscriptionStatus;
  plan: string;
  seats: number;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  graceEndsAt: Date | null;
  studentsMayLearn: boolean;
}

export interface CenterUsageView {
  seatsUsed: number;
  seatsLimit: number;
  seatsAvailable: number;
  status: CenterSubscriptionStatus;
}

@Injectable()
export class CenterSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SubscriptionPolicyService,
    private readonly pricing: PricingService,
    private readonly seats: CenterSeatsService,
  ) {}

  async getSubscription(
    identity: SignedCenterIdentity,
  ): Promise<CenterSubscriptionView> {
    const subscription = await this.loadSubscription(identity);
    const decision = this.policy.evaluate(subscription);

    // Built field by field rather than by spreading the row, so a column added
    // to the schema later cannot leak into an API response by default.
    return {
      status: decision.status,
      plan: subscription.plan,
      seats: subscription.seats,
      trialStartedAt: subscription.trial_started_at,
      trialEndsAt: subscription.trial_ends_at,
      paidUntil: subscription.paid_until,
      graceEndsAt: decision.graceEndsAt,
      studentsMayLearn: decision.studentsMayLearn,
    };
  }

  async getUsage(identity: SignedCenterIdentity): Promise<CenterUsageView> {
    const subscription = await this.loadSubscription(identity);

    // A seat is the existence of a student row carrying this center's id.
    // Counting rather than storing means there is no counter to drift away
    // from the rows it claims to describe.
    const seatsUsed = await this.prisma.student.count({
      where: { center_id: identity.centerId },
    });

    const seatsLimit = subscription.seats;

    return {
      seatsUsed,
      seatsLimit,
      // Clamped at zero. A center can legitimately sit over its limit — after
      // dropping to a smaller plan — and that blocks new provisioning without
      // evicting anyone, so the number to report is "none left", not a deficit.
      seatsAvailable: Math.max(0, seatsLimit - seatsUsed),
      status: this.policy.evaluate(subscription).status,
    };
  }

  /**
   * What the signed-in center would owe for a given mix of seats.
   *
   * The mix is the only thing the caller contributes, and the numbers in it
   * are totals rather than increments. Prices come from what this center has
   * already agreed to, or today's list price for a tier it does not yet hold,
   * and the floors come from its own student counts — so no request can talk
   * the number down.
   */
  async quote(identity: SignedCenterIdentity, mix: SeatMix): Promise<Quote> {
    return this.pricing.quote(
      mix,
      await this.seats.tierContextFor(identity.centerId),
    );
  }

  /**
   * Every center receives a subscription inside its registration transaction,
   * and the migration backfilled the ones that predate that. A missing row is
   * therefore a fault to surface, not a state to accommodate — accommodating it
   * would mean carrying a "no subscription yet" branch through every phase that
   * follows.
   */
  private async loadSubscription(identity: SignedCenterIdentity) {
    const subscription = await this.prisma.centerSubscription.findUnique({
      where: { center_id: identity.centerId },
    });

    if (!subscription) {
      throw new NotFoundException('CENTER_SUBSCRIPTION_NOT_FOUND');
    }

    return subscription;
  }
}
