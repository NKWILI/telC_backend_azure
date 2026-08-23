# Phase 3 Todo: Trial, Subscription, and Seat Policy

Companion to `tasks/phases/03-center-subscriptions-plan.md`.

## Approval gate

- [x] Resolve the three questions that blocked this phase
- [x] Record the build order (Phase 2 deferred to the end)
- [x] Human approves the eight design decisions
- [x] Human approves this specific plan (2026-08-23)
- [x] Create `feature/center-subscriptions` from `dev`

## Task 1: Subscription schema

- [x] Add `CenterSubscription` and `CenterPlan` with a unique `center_id`
- [x] Create the row inside the Phase 1 registration transaction
- [x] Backfill every existing center in the migration
- [x] Additive migration, no existing table touched
- [x] Prisma validate and production build pass
- [x] Commit the green increment

## Task 2: SubscriptionPolicyService

- [x] Write state and boundary tests first
- [x] Derive effective status from timestamps only
- [x] Cover TRIAL_PENDING, TRIAL, ACTIVE, GRACE_PERIOD, BLOCKED
- [x] An expired trial resolves to BLOCKED, never GRACE_PERIOD
- [x] Commit the green increment

## Task 3: Seat accounting

- [x] Write counting tests first
- [x] Count students by center_id; read the limit from subscription.seats
- [x] seatsAvailable never negative
- [x] Commit the green increment

## Checkpoint A

- [x] Every state and boundary covered
- [x] Full suite green, build exit 0
- [x] Human reviews the state table before endpoints exist (Checkpoint A approved 2026-08-23)

## Task 4: GET /api/centers/me/subscription

- [x] Write controller contract tests first
- [x] Add the endpoint, DTO and Swagger responses
- [x] Response leaks no internal ids or raw rows
- [x] Commit the green increment

## Task 5: GET /api/centers/me/usage

- [x] Write contract tests first
- [x] Add the endpoint scoped by the signed token
- [x] Prove another center's students never appear
- [x] Commit the green increment

## Task 6: Integration tests

- [x] Unique constraint rejects a second subscription
- [x] Registering a center yields exactly one subscription row
- [x] Seat counting correct across two centers
- [x] Deleting a center cascades the subscription
- [x] Commit the green increment

## Task 7: Bruno, Swagger, and gates

- [x] Add both endpoints to the Bruno collection
- [x] Update Swagger
- [x] Run unit, e2e, integration, build and lint by exit code
- [x] Run code-quality and security review
- [x] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
