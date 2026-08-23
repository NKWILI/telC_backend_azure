# Phase 5 Todo: Subscription Access Enforcement

Companion to `tasks/phases/05-subscription-access-plan.md`.

## Approval gate

- [ ] Human answers the three open questions
- [ ] Human approves this specific plan
- [ ] Create `feature/subscription-access` from `dev`

## Task 1: StudentSubscriptionGuard

- [ ] Write state and failure tests first
- [ ] Call SubscriptionPolicyService; no date arithmetic in the guard
- [ ] TRIAL, ACTIVE, GRACE_PERIOD pass; TRIAL_PENDING and BLOCKED refuse
- [ ] A student with no center_id passes
- [ ] 403 SUBSCRIPTION_INACTIVE, distinct from 401
- [ ] A database failure is 503, never a silent pass
- [ ] Commit the green increment

## Task 2: Apply to the learning controllers

- [ ] lesen, listening, modelltests, speaking, speaking-catalog, sprachbausteine, writing
- [ ] Enumeration test so a later controller cannot ship without the guard
- [ ] Commit the green increment

## Task 3: Report status on refresh and login

- [ ] Refresh still succeeds when blocked
- [ ] Response carries effective status and studentsMayLearn
- [ ] Commit the green increment

## Checkpoint A

- [ ] Every state covered, including the no-center case
- [ ] Full suite green, build exit 0
- [ ] Human review before it is applied everywhere

## Task 4: CenterSubscriptionGuard

- [ ] A blocked center cannot provision students or mint keys
- [ ] It can still read and update its profile, and read billing
- [ ] Commit the green increment

## Task 5: Integration proof

- [ ] Learns during TRIAL, refused once trial_ends_at passes, no job run
- [ ] GRACE_PERIOD still learns
- [ ] Moving paid_until backwards blocks on the next request
- [ ] A student with no center is unaffected
- [ ] Commit the green increment

## Task 6: Bruno

- [ ] Requests showing a student blocked and restored
- [ ] Document how to move paid_until rather than waiting 30 days
- [ ] Commit the green increment

## Task 7: Gates and review

- [ ] Unit, e2e, integration, build and lint by exit code
- [ ] Code-quality and security review
- [ ] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
