# Phase 3 Todo: Trial, Subscription, and Seat Policy

Companion to `tasks/phases/03-center-subscriptions-plan.md`.

## Approval gate

- [x] Resolve the three questions that blocked this phase
- [x] Record the build order (Phase 2 deferred to the end)
- [ ] Human approves this specific plan
- [ ] Create `feature/center-subscriptions` from `dev`

## Task 1: Subscription schema

- [ ] Add `CenterSubscription` and `CenterPlan` with a unique `center_id`
- [ ] Additive migration, no existing table touched
- [ ] Prisma validate and production build pass
- [ ] Commit the green increment

## Task 2: SubscriptionPolicyService

- [ ] Write state and boundary tests first
- [ ] Derive effective status from timestamps only
- [ ] Cover TRIAL_PENDING, TRIAL, ACTIVE, GRACE_PERIOD, BLOCKED, CANCELLED
- [ ] Null subscription resolves to TRIAL_PENDING
- [ ] Commit the green increment

## Task 3: Seat accounting

- [ ] Write counting tests first
- [ ] Count students by center_id; resolve the limit from status
- [ ] seatsAvailable never negative
- [ ] Commit the green increment

## Checkpoint A

- [ ] Every state and boundary covered
- [ ] Full suite green, build exit 0
- [ ] Human reviews the state table before endpoints exist

## Task 4: GET /api/centers/me/subscription

- [ ] Write controller contract tests first
- [ ] Add the endpoint, DTO and Swagger responses
- [ ] Missing subscription returns TRIAL_PENDING, not 404
- [ ] Commit the green increment

## Task 5: GET /api/centers/me/usage

- [ ] Write contract tests first
- [ ] Add the endpoint scoped by the signed token
- [ ] Prove another center's students never appear
- [ ] Commit the green increment

## Task 6: Integration tests

- [ ] Unique constraint rejects a second subscription
- [ ] Seat counting correct across two centers
- [ ] Deleting a center cascades the subscription
- [ ] Commit the green increment

## Task 7: Bruno, Swagger, and gates

- [ ] Add both endpoints to the Bruno collection
- [ ] Update Swagger
- [ ] Run unit, e2e, integration, build and lint by exit code
- [ ] Run code-quality and security review
- [ ] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
