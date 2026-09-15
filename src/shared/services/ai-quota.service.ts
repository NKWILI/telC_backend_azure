import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AiOperation, Tier } from '@prisma/client';
import { AiUsageService } from './ai-usage.service';
import { StudentEntitlementService } from './student-entitlement.service';

/**
 * AI operations per student per rolling window, by tier.
 *
 * Constants rather than a table, for the same reasons as the tier prices: git
 * carries the history of when a number changed and why, a change gets a review
 * instead of an UPDATE someone runs at night, and the rows in `ai_usage` show
 * within weeks whether 2 is too stingy. The measurement arrives as a side
 * effect of enforcing rather than instead of it.
 *
 * A trial is not a fourth set of numbers. It is Start with a fourteen-day
 * clock and one seat, so there are three cases here rather than four.
 */
export const TIER_AI_ALLOWANCE: Record<Tier, number> = {
  START: 2,
  PRO: 5,
  PREMIUM: 20,
};

/**
 * A rolling window, not a calendar day.
 *
 * A calendar day needs a timezone, and the product is not only for Cameroon:
 * UTC midnight is 1am in Douala and 9am in Tokyo, which splits a student's day
 * in an arbitrary place. The student's own timezone would have to come from
 * their device, and a student who changes that setting gets a fresh day — a
 * quota a client can reset is not a quota.
 */
export const AI_QUOTA_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * What a student with no tier gets.
 *
 * Nobody is paying for these calls, so they run at the cheapest rate rather
 * than at no rate. Refusing outright would break every independent student who
 * uses speaking today, and anyone a center removed. Leaving them unmetered
 * would let a center release its students to hand them an unlimited allowance
 * we pay Gemini for — and a quota with a way around it is not a quota.
 *
 * Deliberately one rule for both no-center and governed-without-a-tier.
 * Provisioning requires a tier, so the second case is only reachable by a
 * student who predates tiers entirely.
 */
const NO_TIER_ALLOWANCE = TIER_AI_ALLOWANCE.START;

export interface AiQuotaDecision {
  allowed: boolean;
  /** Null for a student holding no tier. Reported as null rather than
   *  substituted, so a client never shows a tier the student does not have. */
  tier: Tier | null;
  usedToday: number;
  allowedToday: number;
  /** Never negative, even for a student somehow over their allowance. */
  remaining: number;
  /**
   * When the oldest counted operation falls out of the window, or null if
   * nothing is in it. This is the only honest answer to "when am I back":
   * a rolling window has no midnight to quote.
   */
  resetsAt: Date | null;
}

/**
 * The one authority on whether a student may run another AI operation.
 *
 * Written once and called from every AI path, because two copies would drift
 * and the one that drifted would be the one spending money. It makes no HTTP
 * decision of its own beyond `assertWithinQuota`, which exists so every caller
 * refuses in the same shape.
 *
 * It answers only the quota question. Whether the student's center is entitled
 * to anything at all is `StudentSubscriptionGuard`'s refusal, and it has to
 * reach the student as SUBSCRIPTION_INACTIVE — a student whose school stopped
 * paying must not be told they have run out of sessions.
 */
@Injectable()
export class AiQuotaService {
  constructor(
    private readonly entitlement: StudentEntitlementService,
    private readonly usage: AiUsageService,
  ) {}

  async check(
    studentId: string,
    operation: AiOperation,
  ): Promise<AiQuotaDecision> {
    const { tier } = await this.entitlement.forStudent(studentId);
    const allowedToday = tier ? TIER_AI_ALLOWANCE[tier] : NO_TIER_ALLOWANCE;

    // One cutoff for both reads. A second `new Date()` would drift by however
    // long the first query took, so the reset time could name a row that was
    // never counted and a moment already past.
    const since = new Date(Date.now() - AI_QUOTA_WINDOW_HOURS * HOUR_MS);

    const usedToday = await this.usage.countSince(studentId, operation, since);
    const allowed = usedToday < allowedToday;

    // Only asked for when it can be reported. A student with room to spare is
    // not waiting for a reset, and the query is not free.
    const oldest = allowed
      ? null
      : await this.usage.oldestSince(studentId, operation, since);

    return {
      allowed,
      tier,
      usedToday,
      allowedToday,
      remaining: Math.max(0, allowedToday - usedToday),
      resetsAt: oldest
        ? new Date(oldest.getTime() + AI_QUOTA_WINDOW_HOURS * HOUR_MS)
        : null,
    };
  }

  /**
   * Refuses a student who has spent their allowance, with everything the app
   * needs to say something useful.
   *
   * The refusal is a sales moment rather than an error: "you have used 2 of 2
   * today — back at 14:32, or ask your school about Pro" is only possible if
   * the numbers travel with it. A bare 403 leaves a client with nothing to
   * show but a failure.
   */
  async assertWithinQuota(
    studentId: string,
    operation: AiOperation,
  ): Promise<void> {
    const decision = await this.check(studentId, operation);

    if (decision.allowed) {
      return;
    }

    throw new ForbiddenException({
      message: 'AI_QUOTA_EXCEEDED',
      tier: decision.tier,
      usedToday: decision.usedToday,
      allowedToday: decision.allowedToday,
      resetsAt: decision.resetsAt,
    });
  }
}
