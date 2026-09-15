import { Injectable, NotFoundException } from '@nestjs/common';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import {
  SubscriptionPolicyService,
  type CenterSubscriptionStatus,
} from './subscription-policy.service';
import type { Tier } from '@prisma/client';
import { PricingService, type Quote, type SeatMix } from './pricing.service';
import { CenterSeatsService } from './center-seats.service';

/** Cheapest first, matching every other tier listing in the codebase. */
const TIER_ORDER: readonly Tier[] = ['START', 'PRO', 'PREMIUM'];

type SignedCenterIdentity = Pick<CenterAccessTokenPayload, 'centerId'>;

export interface CenterSubscriptionView {
  status: CenterSubscriptionStatus;
  plan: string;
  /**
   * Seats this center holds, across every tier, summed from `center_seats`.
   *
   * Replaces `CenterSubscription.seats`, which was a second number claiming
   * the same thing. Two authorities meant nobody reading the code could say
   * which was true, and a stale one that still looks authoritative eventually
   * reaches an invoice.
   */
  seatsHeld: number;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  graceEndsAt: Date | null;
  studentsMayLearn: boolean;
}

export interface CenterTierUsageView {
  tier: Tier;
  seatsHeld: number;
  seatsUsed: number;
  seatsAvailable: number;
}

export interface CenterUsageView {
  seatsUsed: number;
  seatsLimit: number;
  seatsAvailable: number;
  /** Legacy students that occupy a seat but have not been assigned a tier. */
  unassignedSeatsUsed: number;
  /**
   * The same figures per tier, cheapest first.
   *
   * A seat belongs to a tier, so a total on its own cannot answer the question
   * a center actually has: "two seats left" is useless to a school holding
   * three tiers and full in one of them, which is exactly what provisioning
   * refuses on. A tier appears if the center holds seats in it OR has students
   * in it — a tier dropped while students still sat in it is an overage worth
   * showing, not one worth hiding.
   */
  perTier: CenterTierUsageView[];
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
      seatsHeld: await this.countSeatsHeld(identity),
      trialStartedAt: subscription.trial_started_at,
      trialEndsAt: subscription.trial_ends_at,
      paidUntil: subscription.paid_until,
      graceEndsAt: decision.graceEndsAt,
      studentsMayLearn: decision.studentsMayLearn,
    };
  }

  async getUsage(identity: SignedCenterIdentity): Promise<CenterUsageView> {
    const where = { center_id: identity.centerId };

    const [subscription, seatRows, studentsByTier, seatsUsed] =
      await Promise.all([
        this.loadSubscription(identity),
        this.prisma.centerSeat.findMany({
          where,
          select: { tier: true, quantity: true },
        }),
        this.prisma.student.groupBy({
          by: ['tier'],
          where,
          _count: { _all: true },
        }),
        // A seat is the existence of a student row carrying this center's id.
        // Counting rather than storing means there is no counter to drift
        // away from the rows it claims to describe. Counted across the whole
        // center rather than summed from the groups, so students carrying no
        // tier are included — today that is all of the legacy ones.
        this.prisma.student.count({ where }),
      ]);

    const held = new Map(seatRows.map((row) => [row.tier, row.quantity]));
    const used = new Map<Tier, number>();
    let unassignedSeatsUsed = 0;
    for (const group of studentsByTier) {
      if (group.tier) {
        used.set(group.tier, group._count._all);
      } else {
        unassignedSeatsUsed = group._count._all;
      }
    }

    const seatsLimit = seatRows.reduce((total, row) => total + row.quantity, 0);

    return {
      seatsUsed,
      seatsLimit,
      // Clamped at zero. A center can legitimately sit over its limit — after
      // dropping to a smaller plan — and that blocks new provisioning without
      // evicting anyone, so the number to report is "none left", not a deficit.
      seatsAvailable: Math.max(0, seatsLimit - seatsUsed),
      unassignedSeatsUsed,
      perTier: TIER_ORDER.filter(
        (tier) => held.has(tier) || used.has(tier),
      ).map((tier) => {
        const seatsHeld = held.get(tier) ?? 0;
        const tierSeatsUsed = used.get(tier) ?? 0;

        return {
          tier,
          seatsHeld,
          seatsUsed: tierSeatsUsed,
          seatsAvailable: Math.max(0, seatsHeld - tierSeatsUsed),
        };
      }),
      status: this.policy.evaluate(subscription).status,
    };
  }

  /** Seats held across every tier. The seat rows are the only authority. */
  private async countSeatsHeld(
    identity: SignedCenterIdentity,
  ): Promise<number> {
    const rows = await this.prisma.centerSeat.findMany({
      where: { center_id: identity.centerId },
      select: { quantity: true },
    });

    return rows.reduce((total, row) => total + row.quantity, 0);
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
      await this.seats.pricingContextFor(identity.centerId),
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
