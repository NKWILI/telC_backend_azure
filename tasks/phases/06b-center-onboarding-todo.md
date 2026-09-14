# Phase 6b Todo: Center onboarding and tiered pricing

Companion to `tasks/phases/06b-center-onboarding-plan.md`, which holds the 27
agreed decisions and the reasoning behind each.

Ordered so every step leaves the tree building. **Task 16 drops two columns and
is deliberately last** — code still reads them, so an early drop would leave
commits that do not compile.

## Slice 1: draft center and onboarding state

The part the frontend needs soonest. Independent of tiers.

### Task 1: Allow a draft center

- [x] Migration makes `centers.country`, `centers.city` and
      `center_users.phone` nullable
- [x] Existing centers and managers keep their values, nothing backfilled
- [x] A center can be inserted carrying only a name
- [x] Proven against real Postgres, since the claim is about the table
- [x] Commit the green increment

### Task 2: Simplified registration

- [ ] Registration accepts exactly centerName, managerFirstName,
      managerLastName, email, password
- [ ] The four dropped fields are rejected if sent, not ignored
- [ ] A registered center still gets its subscription row in the same
      transaction
- [ ] Verification email and duplicate-address behaviour unchanged
- [ ] Commit the green increment

### Task 3: Report onboarding state

- [ ] `GET /api/centers/me` returns `{ complete, missing }`
- [ ] Complete when country, city and manager phone are all present
- [ ] `missing` lists exactly the absent fields, in a stable order
- [ ] Derived on read, no stored column
- [ ] Commit the green increment

### Checkpoint A

- [ ] A center can register with five fields and reach a dashboard
- [ ] Gates green by exit code
- [ ] Human review — the frontend starts against this slice

## Slice 2: the tier model

### Task 4: Tier schema, additive only

- [ ] `Tier` enum, `center_seats` table, `Student.tier`
- [ ] `center_seats` unique per (center, tier), holds quantity and the stamped
      `unit_price_xaf`
- [ ] `Student.tier` nullable, for students no center governs
- [ ] Nothing dropped; the tree builds unchanged
- [ ] Commit the green increment

### Task 5: Tier prices and the rewritten pricing service

- [ ] Start 4,500, Pro 10,000, Premium 20,000, per seat per month, as constants
- [ ] Floor is ten seats in total, not per tier
- [ ] Per-tier floor against students already provisioned in that tier
- [ ] Refusals name the tier and carry requiredSeats
- [ ] Integer amounts; a three-tier mix sums exactly
- [ ] Commit the green increment

### Task 6: Quote takes a mix

- [ ] Accepts `{ start, pro, premium }`, returns itemised lines and totals
- [ ] A price, total or currency in the body is rejected
- [ ] Reachable while blocked
- [ ] Commit the green increment

### Task 7: Payment takes a mix

- [ ] Accepts the mix, records a per-tier breakdown
- [ ] Idempotency key, payload fingerprint, unique index and rate limit intact
- [ ] Fingerprint covers the whole mix, so a different mix on one key is 409
- [ ] Concurrency re-proven against real Postgres
- [ ] Still grants nothing: `paid_until` untouched
- [ ] Commit the green increment

### Checkpoint B

- [ ] A mixed quote prices correctly and cannot be influenced by the client
- [ ] One payment covering three tiers is idempotent against real Postgres
- [ ] Human review before trials or students are touched

## Slice 3: trials and students on tiers

### Task 8: The trial becomes one Start seat for 14 days

- [ ] A fresh center holds `center_seats(START, 1, 0)` from registration
- [ ] `TRIAL_DURATION_DAYS` is 14
- [ ] Trial and paid Start students behave identically except for the clock
- [ ] Commit the green increment

### Task 9: Provisioning assigns a tier

- [ ] `POST /api/centers/me/students` takes `tier`
- [ ] Seat check is per tier
- [ ] A center with every Start seat taken is refused a Start student even with
      Pro seats free, and the refusal names the tier
- [ ] A tier the center holds no seats in is refused
- [ ] Commit the green increment

### Task 10: A student can move tier

- [ ] `PATCH /api/centers/me/students/:id` accepts `tier`
- [ ] Allowed only into a tier with a free seat
- [ ] No pro-rating; access changes immediately, price settles at renewal
- [ ] Commit the green increment

## Slice 4: the two gates

### Task 11: Profile completeness gates payment

- [ ] `POST /api/payments` refuses an incomplete profile with
      `CENTER_PROFILE_INCOMPLETE` and the `missing` list
- [ ] Quoting stays open
- [ ] `center-blocked-surface.spec.ts` extended
- [ ] Commit the green increment

### Task 12: The exam module gates on tier

- [ ] `/api/modelltests` requires Pro or Premium
- [ ] Per-skill practice stays open to Start
- [ ] Commit the green increment

## Slice 5: quotas

### Task 13: Record AI usage

- [ ] `ai_usage` table, one row per successful chargeable operation
- [ ] Written after the call returns; a failed AI call writes nothing
- [ ] Indexed for "this student, newer than a timestamp"
- [ ] Commit the green increment

### Task 14: Enforce the rolling allowance

- [ ] One authority answering "may this student run one more speaking session"
- [ ] Start 2, Pro 5, Premium 20, over a rolling 24 hours
- [ ] No timezone anywhere
- [ ] Refusal carries tier, usedToday, allowedToday, resetsAt
- [ ] `resetsAt` is the oldest counted row plus 24 hours
- [ ] Commit the green increment

### Task 15: Apply it to speaking

- [ ] The check runs before a speaking evaluation
- [ ] The usage row is written only after it succeeds
- [ ] Commit the green increment

## Slice 6: contract and finish

### Task 16: Drop the superseded columns

- [ ] `Center.unit_price_xaf` and `CenterSubscription.seats` removed
- [ ] Nothing reads them by this point
- [ ] Commit the green increment

### Task 17: Bruno

- [ ] Five-field registration, the onboarding block, a mixed quote, a mixed
      payment
- [ ] The refusals that must fail: client-supplied price, below ten total,
      wrong tier, incomplete profile, quota exhausted
- [ ] Commit the green increment

### Task 18: Gates and review

- [ ] Unit, e2e, integration, build and lint by exit code
- [ ] Code-quality and security review
- [ ] Report changes, non-changes, concerns and evidence

### Checkpoint C

- [ ] All gates by exit code
- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically

## Handover to Herman, after Checkpoint C

Phase 7 is his. What he needs from this phase:

- [ ] The payment record shape, including the tier mix
- [ ] What "activate" means in data: what to write to `paid_until` and
      `center_seats`
- [ ] That `SubscriptionPolicyService` is the only authority on subscription
      status — call it, never re-derive it
- [ ] All gates green at handover, so a break is his
