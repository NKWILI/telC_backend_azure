import type { CenterSubscriptionStatus } from './subscription-policy.service';

/**
 * What this needs from the onboarding checklist, and no more.
 *
 * Deliberately looser than `OnboardingState`: this module only asks which
 * fields are still missing, so typing it to the exact field union would tie
 * the mapping to the current list and make every caller cast.
 */
export interface OnboardingChecklist {
  complete: boolean;
  missing: readonly string[];
}

/**
 * What the dashboard renders at the top of every page: a badge, a banner, and
 * the step the wizard resumes at.
 *
 * All of it is derived. There is no `payment_status`, `onboarding_completed`
 * or `onboarding_step` column, for the same reason there is no stored
 * subscription status: a column needs something to keep it true, and when that
 * something runs late the account reads "trial" while its students are already
 * blocked. Nothing here can drift, because there is nothing to drift from.
 *
 * Pure, and separate from the service, so the mapping can be read and tested
 * without a database — and so the wizard, the dashboard and any later reminder
 * job answer these questions the same way.
 */

/**
 * The three words the dashboard shows a manager.
 *
 * Deliberately coarser than `CenterSubscriptionStatus`: a manager cares
 * whether they owe money, not whether the subscription machine calls today
 * grace or active. `subscriptionStatus` travels alongside for the cases where
 * the difference matters ("payment late", "blocked").
 */
export type CenterPaymentStatus = 'unpaid' | 'trial' | 'paid';

/** 1 manager details, 2 school details, 3 plan, 4 done. */
export type OnboardingStep = 1 | 2 | 3 | 4;

export interface AccountStateInput {
  subscriptionStatus: CenterSubscriptionStatus;
  /** Set by the trial starting. Evidence a trial has ever run. */
  trialStartedAt: Date | null;
  /** Set by a verified payment. Evidence money has ever arrived. */
  paidUntil: Date | null;
  onboarding: OnboardingChecklist;
}

export interface AccountState {
  paymentStatus: CenterPaymentStatus;
  onboardingCompleted: boolean;
  onboardingStep: OnboardingStep;
}

/**
 * Which onboarding step each missing field belongs to.
 *
 * The manager's own details come first because the wizard asks for them first,
 * and because a center that cannot be contacted is the one a late invoice
 * cannot chase.
 */
const MANAGER_FIELDS = new Set(['phone']);

const PAID_STATUSES = new Set<CenterSubscriptionStatus>([
  'ACTIVE',
  // Grace reads as paid: the students still learn, and the dashboard says
  // "payment late" from `subscriptionStatus`. Flipping the badge to unpaid
  // would tell a center that has paid every month that it never has.
  'GRACE_PERIOD',
]);

/**
 * Whether a center has finalized its account: started a trial, or paid.
 *
 * Exported because two places ask it — the dashboard badge and the lock on
 * paid actions — and a second copy of the rule is the one that would drift.
 *
 * Finalization is a door walked through once, not a state that lapses. A trial
 * that ended or a payment that ran out leaves the account unpaid — but sending
 * it back through the wizard would ask a center to re-enter what it already
 * gave, when what it needs to do is pay.
 */
export function isAccountFinalized(facts: {
  trialStartedAt: Date | null;
  paidUntil: Date | null;
}): boolean {
  return facts.trialStartedAt !== null || facts.paidUntil !== null;
}

export function deriveAccountState(input: AccountStateInput): AccountState {
  const onboardingCompleted = isAccountFinalized(input);

  return {
    paymentStatus: resolvePaymentStatus(input.subscriptionStatus),
    onboardingCompleted,
    onboardingStep: resolveStep(input.onboarding, onboardingCompleted),
  };
}

function resolvePaymentStatus(
  status: CenterSubscriptionStatus,
): CenterPaymentStatus {
  if (PAID_STATUSES.has(status)) {
    return 'paid';
  }

  if (status === 'TRIAL') {
    return 'trial';
  }

  // TRIAL_PENDING (never started) and BLOCKED (trial over, or payment lapsed)
  // are the same answer to the only question a badge asks: money is owed.
  return 'unpaid';
}

function resolveStep(
  onboarding: OnboardingChecklist,
  onboardingCompleted: boolean,
): OnboardingStep {
  if (onboardingCompleted) {
    return 4;
  }

  if (onboarding.missing.some((field) => MANAGER_FIELDS.has(field))) {
    return 1;
  }

  // Anything still missing at this point is a school detail; nothing missing
  // means the center is ready to choose a plan.
  return onboarding.complete ? 3 : 2;
}
