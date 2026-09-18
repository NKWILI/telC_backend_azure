import { Tier } from '@prisma/client';
import {
  MIN_PAID_SEATS_TOTAL,
  TIER_PRICES_XAF,
} from '../centers/pricing.service';
import {
  AI_QUOTA_WINDOW_HOURS,
  TIER_AI_ALLOWANCE,
} from '../../shared/services/ai-quota.service';

/**
 * What a plan costs and allows, assembled from the constants that are already
 * enforced elsewhere.
 *
 * Nothing here is typed by hand twice. The price comes from the service that
 * builds a quote, the allowance from the service that refuses an AI call, and
 * the exam flag from the tier that guards the exam module. A plan can
 * therefore never advertise something the backend does not do — which is the
 * whole reason the frontend stops holding its own copy of these numbers.
 *
 * Names and descriptions are deliberately absent: they are translations, and
 * they belong in the frontend dictionaries with the rest of the copy.
 */

/** The tier the exam module (`/api/modelltests`) requires — `@RequiresTier`. */
const EXAM_MODULE_MIN_TIER: Tier = Tier.PRO;

/** Cheapest first, as every other list of tiers in this codebase. */
const TIER_ORDER: readonly Tier[] = [Tier.START, Tier.PRO, Tier.PREMIUM];

/** A student admitted at one tier is admitted at every tier below it. */
const TIER_RANK: Record<Tier, number> = {
  [Tier.START]: 0,
  [Tier.PRO]: 1,
  [Tier.PREMIUM]: 2,
};

/**
 * The window label, derived from the constant rather than typed beside it.
 *
 * `AI_QUOTA_WINDOW_HOURS` is a literal, so this is `'per_24h'` at the type
 * level too: change the window to 12 hours and every client that matched
 * `per_24h` stops compiling here instead of silently rendering "per day".
 */
const AI_WINDOW = `per_${AI_QUOTA_WINDOW_HOURS}h` as const;

/** Lowercase for clients; `Tier` stays the database and internal spelling. */
export type PlanId = 'start' | 'pro' | 'premium';

const PLAN_IDS: Record<Tier, PlanId> = {
  [Tier.START]: 'start',
  [Tier.PRO]: 'pro',
  [Tier.PREMIUM]: 'premium',
};

export interface PlanView {
  id: PlanId;
  monthlyPricePerSeatXaf: number;
  aiSpeaking: { limit: number; window: typeof AI_WINDOW };
  examModule: boolean;
}

export interface PlansView {
  minSeats: number;
  plans: PlanView[];
}

/**
 * Deliberately not reported: an annual discount, and Premium's "AI in every
 * module".
 *
 * Annual billing is not decided yet, and `AiOperation` still has a single
 * value, so nothing metered exists outside speaking. A route that announced
 * either would be promising what no code enforces, and a school would have
 * agreed to something we cannot deliver. They appear here the day they are
 * built.
 */
export function buildPlansView(): PlansView {
  return {
    minSeats: MIN_PAID_SEATS_TOTAL,
    plans: TIER_ORDER.map((tier) => ({
      id: PLAN_IDS[tier],
      monthlyPricePerSeatXaf: TIER_PRICES_XAF[tier],
      aiSpeaking: {
        limit: TIER_AI_ALLOWANCE[tier],
        // Stated rather than implied: a rolling window is not a calendar day,
        // and a client that renders "per day" must not reset it at midnight.
        window: AI_WINDOW,
      },
      examModule: TIER_RANK[tier] >= TIER_RANK[EXAM_MODULE_MIN_TIER],
    })),
  };
}
