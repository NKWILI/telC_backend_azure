import { SetMetadata } from '@nestjs/common';
import type { Tier } from '@prisma/client';

export const REQUIRES_TIER = 'requiresTier';

/**
 * The lowest tier a route admits.
 *
 * Declared on the route rather than checked inside the handler so the
 * requirement is visible where the route is, and so a sweep can enumerate
 * every gated route — which is how `subscription-enforcement.spec` catches a
 * route that quietly lost its guard.
 *
 * A route with no decorator has no tier requirement. `StudentTierGuard`
 * admits everyone there rather than inventing a default, because a guard that
 * gates routes nobody meant to gate is found by customers, not by tests.
 */
export const RequiresTier = (tier: Tier) => SetMetadata(REQUIRES_TIER, tier);
