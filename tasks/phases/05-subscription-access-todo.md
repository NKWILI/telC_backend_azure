# Phase 5 Todo: Subscription Access Enforcement

Companion to `tasks/phases/05-subscription-access-plan.md`.

## Approval gate

- [x] Human answers the three open questions
- [x] Human approves this specific plan
- [ ] Create `feature/subscription-access` from `dev`

## Task 1: StudentSubscriptionGuard

- [x] Write state and failure tests first
- [x] Call SubscriptionPolicyService; no date arithmetic in the guard
- [x] TRIAL, ACTIVE, GRACE_PERIOD pass; TRIAL_PENDING and BLOCKED refuse
- [x] A student with no center_id passes
- [x] 403 SUBSCRIPTION_INACTIVE, distinct from 401
- [x] A database failure is 503, never a silent pass
- [x] Commit the green increment

## Task 2: Apply to the learning controllers

- [x] lesen, listening, modelltests, speaking, speaking-catalog, sprachbausteine, writing
- [x] Enumeration test so a later controller cannot ship without the guard
- [x] Commit the green increment

## Task 2b: Close the speaking room entrance

- [x] JwtAuthGuard + subscription on POST /api/speaking/rooms
- [x] GET /rooms/:roomId stays public; guest join still works without a token
- [x] Commit the green increment

Guest join is proven by `room.gateway.spec.ts` ("guest path (no token or
wrong token)") plus the public-lookup tests in `room-subscription.spec.ts`.
The full socket e2e (`RUN_SPEAKING_E2E=1`) could not corroborate it: it fails
on `students.phone does not exist`, a Phase 4 migration missing from that
database. Pre-existing, unrelated to this phase, and opt-in so the normal
gate never ran it. Worth fixing before Checkpoint B.

## Task 3: Report status on refresh and login

- [x] Refresh still succeeds when blocked
- [x] Response carries effective status and studentsMayLearn
- [x] Commit the green increment

## Checkpoint A

- [x] Every state covered, including the no-center case
- [x] Full suite green, build exit 0
- [x] Human review before it is applied everywhere

## Task 4: CenterSubscriptionGuard

- [x] A blocked center cannot provision students or mint keys
- [x] It can still read and update its profile, and read billing
- [x] Commit the green increment

## Task 5: Integration proof

- [x] Learns during TRIAL, refused once trial_ends_at passes, no job run
- [x] GRACE_PERIOD still learns
- [x] Moving paid_until backwards blocks on the next request
- [x] A student with no center is unaffected
- [x] Commit the green increment

## Task 6: Bruno

- [x] Requests showing a student blocked and restored
- [x] Document how to move paid_until rather than waiting 30 days
- [x] Commit the green increment

## Task 7: Gates and review

- [x] Unit, e2e, integration, build and lint by exit code
- [x] Code-quality and security review
- [x] Report changes, non-changes, concerns and evidence

Deferred from the Checkpoint A review (findings 6-9):

- [x] Measure the per-request entitlement query before optimising it.
      ValkeyService already caches session revocation and the same pattern
      fits, but the plan says measure first.
- [x] `SubscriptionStatusDto.status` is typed `string`. Swagger documents six
      values while the type accepts any of them plus everything else.
- [x] Activation does not report status. `issueSessionForStudent` returns bare
      tokens, so a student activating -- the moment a trial actually starts --
      gets no `subscription`, while login, verify-email and reset do.
- [x] No test registers `AuthExceptionFilter` around a 403 from the guard. On
      `/api/auth/*` that filter collapses object payloads and drops extras, so
      `subscriptionStatus` would vanish. Learning routes take the pass-through
      branch and are fine today; applying this guard to an auth route later
      would silently strip the status the continue-offer depends on.

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
