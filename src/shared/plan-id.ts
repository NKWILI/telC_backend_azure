import { Tier } from '@prisma/client';

/**
 * What a client calls a plan.
 *
 * `Tier` is the database's spelling and stays internal; this is the one every
 * response uses. Without a single mapping, `GET /api/plans` offers `start`
 * while `GET /api/centers/me` reports `START`, and every client writes its own
 * translation — which is a bug waiting for the day someone spells one of them
 * differently.
 */
export type PlanId = 'start' | 'pro' | 'premium';

const PLAN_IDS: Record<Tier, PlanId> = {
  [Tier.START]: 'start',
  [Tier.PRO]: 'pro',
  [Tier.PREMIUM]: 'premium',
};

/** Cheapest first, as every other list of tiers in this codebase. */
export const TIER_ORDER: readonly Tier[] = [Tier.START, Tier.PRO, Tier.PREMIUM];

export function planIdFor(tier: Tier): PlanId {
  return PLAN_IDS[tier];
}

/** A count per plan with every plan present, so no client writes `?? 0`. */
export type SeatsByPlan = Record<PlanId, number>;

export function emptySeatsByPlan(): SeatsByPlan {
  return { start: 0, pro: 0, premium: 0 };
}
