/**
 * What a center must have supplied before it can be charged, and how that is
 * decided.
 *
 * Its own module because two places now ask the question: the dashboard, which
 * renders a checklist, and payment creation, which refuses without an answer.
 * Written twice the two copies would drift, and the one that drifted would be
 * the one deciding whether an invoice can be raised.
 *
 * Pure: it takes the three values and returns a verdict. No database, no HTTP.
 */

/**
 * Required to take money, not to run a trial.
 *
 * `phone` is how an unpaid invoice gets chased, and WhatsApp is the channel
 * that actually reaches people in-market. `country` decides currency and tax
 * even though only XAF exists today. `city` is sales and support context.
 *
 * None of the three is needed to start a trial, which is why the gate sits at
 * payment rather than at provisioning: a center can try the product on the
 * strength of an email address alone.
 *
 * The logo is deliberately absent — optional by decision, so a center
 * completes onboarding without one.
 */
export const REQUIRED_PROFILE_FIELDS = ['country', 'city', 'phone'] as const;

export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export interface OnboardingState {
  complete: boolean;
  /**
   * Exactly the absent fields, in the order above. Reported so a dashboard
   * renders its checklist without holding a second copy of these rules: a
   * fourth required field added here updates every checklist with no frontend
   * change.
   */
  missing: RequiredProfileField[];
}

/** Blank is not an answer. Spaces must not satisfy a checklist. */
const isSupplied = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Worked out on every read rather than stored.
 *
 * A stored flag needs a job or a trigger to keep it true, and when that runs
 * late the value is wrong — the same reasoning that left subscription status
 * derived from timestamps. This cannot drift, because there is nothing to
 * drift from.
 */
export function deriveOnboardingState(supplied: {
  country: string | null;
  city: string | null;
  phone: string | null;
}): OnboardingState {
  const missing = REQUIRED_PROFILE_FIELDS.filter(
    (field) => !isSupplied(supplied[field]),
  );

  return { complete: missing.length === 0, missing: [...missing] };
}
