import { Injectable } from '@nestjs/common';
import type { CenterPlan } from '@prisma/client';

/**
 * How long a lapsed **paid** period keeps working while a transfer is
 * outstanding. It does not apply to a trial: grace exists so a paying customer
 * is not cut off over a late payment, and a trial user has nothing to be late
 * with. Applying it to trials would quietly turn a 30-day trial into 37.
 */
export const GRACE_PERIOD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CenterSubscriptionStatus =
  | 'TRIAL_PENDING'
  | 'TRIAL'
  | 'ACTIVE'
  | 'GRACE_PERIOD'
  | 'BLOCKED';

/** The subset of the row this service reads. Narrow on purpose: the policy
 *  must not start depending on ids, timestamps or anything else incidental. */
export interface CenterSubscriptionRecord {
  plan: CenterPlan;
  seats: number;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  paid_until: Date | null;
}

export interface SubscriptionDecision {
  status: CenterSubscriptionStatus;
  /** When grace would end, or null when there is no paid period to lapse.
   *  Reported even once blocked, so a client can explain what was missed. */
  graceEndsAt: Date | null;
  /** The single boolean the rest of the system consumes. Callers must read
   *  this rather than re-deriving access from the dates, because two
   *  implementations of one rule is how they drift apart. */
  studentsMayLearn: boolean;
}

const LEARNING_ALLOWED: ReadonlySet<CenterSubscriptionStatus> = new Set([
  'TRIAL',
  'ACTIVE',
  'GRACE_PERIOD',
]);

/**
 * The single authority on whether a center's students may use the product.
 *
 * There is no stored `status` column. A stored status has to be kept correct by
 * a scheduled job, and when that job runs late — a deploy, a stuck worker, a
 * timezone bug — every center is silently in the wrong state, and the failure
 * direction is granting access nobody paid for. Status is therefore computed
 * from the timestamps on every read, so it is correct even if no job has run
 * for a week.
 *
 * Phase 5's guard and any later reminder job must call this rather than
 * re-implementing the comparisons.
 */
@Injectable()
export class SubscriptionPolicyService {
  evaluate(
    subscription: CenterSubscriptionRecord,
    now: Date = new Date(),
  ): SubscriptionDecision {
    const graceEndsAt = this.graceEndsAt(subscription);
    const status = this.resolveStatus(subscription, now, graceEndsAt);

    return {
      status,
      graceEndsAt,
      studentsMayLearn: LEARNING_ALLOWED.has(status),
    };
  }

  /**
   * Order matters. Payment is checked before the trial, so a center that
   * converted mid-trial is judged on what it paid for rather than on a trial
   * window that has since passed.
   */
  private resolveStatus(
    { trial_started_at, trial_ends_at, paid_until }: CenterSubscriptionRecord,
    now: Date,
    graceEndsAt: Date | null,
  ): CenterSubscriptionStatus {
    if (paid_until) {
      if (now < paid_until) return 'ACTIVE';
      if (graceEndsAt && now < graceEndsAt) return 'GRACE_PERIOD';
      return 'BLOCKED';
    }

    if (!trial_started_at || !trial_ends_at) {
      return 'TRIAL_PENDING';
    }

    return now < trial_ends_at ? 'TRIAL' : 'BLOCKED';
  }

  private graceEndsAt({ paid_until }: CenterSubscriptionRecord): Date | null {
    if (!paid_until) return null;

    return new Date(paid_until.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
  }
}
