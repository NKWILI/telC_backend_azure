# Phase 3 Plan: Trial, Subscription, and Seat Policy

Companion todo: `tasks/phases/03-center-subscriptions-todo.md`
Model it implements: `docs/ARCHITECTURE-B2B2C.md`

## Goal

Give every center exactly one subscription record, and one authority that
answers two questions from it:

1. **May this center's students use the product right now?**
2. **How many students may this center have, and how many does it have?**

This phase adds **no payment code**. It defines the states money will later move
between, and the seat accounting Phase 4 will enforce.

## Out of scope

Pricing, checkout, Notch Pay, webhooks, renewal reminders, the scheduler, the
student-facing guard, and student provisioning. Phase 3 exposes two read
endpoints and a policy service; it changes no learning behaviour.

## The central decision: status is derived, never stored

A `status` column would have to be kept correct by a scheduled job. When that
job runs late — a deploy, a stuck worker, a timezone bug — every center is
silently in the wrong state, and the failure direction is *granting access
nobody paid for*.

So the table stores only **facts with timestamps**, and the effective status is
computed on read:

```
cancelled_at set                            → CANCELLED
trial_started_at is null                    → TRIAL_PENDING
now < trial_ends_at                         → TRIAL
paid_until set and now < paid_until         → ACTIVE
now < (paid_until ?? trial_ends_at) + 7d    → GRACE_PERIOD
otherwise                                   → BLOCKED
```

Grace is derived too, not stored: `graceEndsAt = periodEnd + GRACE_PERIOD_DAYS`.
A stored copy is one more value that can disagree with the timestamps it came
from.

A scheduler may still exist later for *reminders*, but access will never depend
on it having run. This directly addresses the global plan's risk row
*"Subscription scheduler runs late — access guard derives effective status from
authoritative timestamps."*

## Seats

Per `docs/ARCHITECTURE-B2B2C.md`, a seat is **the existence of a `Student` row
carrying the center's `center_id`**. There is no counter column, so there is
nothing to drift.

```
used  = COUNT(students WHERE center_id = X)
limit = TRIAL_PENDING | TRIAL → 3
        ACTIVE | GRACE_PERIOD → subscription.seats   (minimum 10)
        BLOCKED | CANCELLED   → 0 new provisions
```

Phase 3 exposes and tests this accounting. Phase 4 enforces it inside the
provisioning transaction.

## Data model

```prisma
enum CenterPlan {
  TRIAL
  PAID
}

model CenterSubscription {
  id               String     @id @default(uuid())
  center_id        String     @unique
  plan             CenterPlan @default(TRIAL)
  seats            Int        @default(3)

  trial_started_at DateTime?
  trial_ends_at    DateTime?
  paid_until       DateTime?
  cancelled_at     DateTime?

  created_at       DateTime   @default(now())
  updated_at       DateTime   @default(now()) @updatedAt

  center           Center     @relation(fields: [center_id], references: [id], onDelete: Cascade)

  @@map("center_subscriptions")
}
```

`@unique` on `center_id` makes "exactly one subscription per center" a database
guarantee rather than a convention.

`onDelete: Cascade` because a subscription has no meaning without its center —
unlike `CenterUser`, which uses `Restrict` so a center cannot be deleted out
from under its owner.

**Nothing sets `trial_started_at` in this phase.** Per global assumption 6, the
trial starts on the first successful student activation, which is Phase 4. Every
center created here sits at `TRIAL_PENDING`, and the transition is Phase 4's to
make.

## API

### `GET /api/centers/me/subscription`

Requires a center access token.

```json
{
  "status": "TRIAL_PENDING",
  "plan": "TRIAL",
  "seats": 3,
  "trialStartedAt": null,
  "trialEndsAt": null,
  "paidUntil": null,
  "graceEndsAt": null,
  "studentsMayLearn": false
}
```

`studentsMayLearn` is the single boolean the rest of the system consumes. A
caller must never re-derive access from the dates itself — that is how two
implementations of the same rule diverge.

### `GET /api/centers/me/usage`

```json
{
  "seatsUsed": 0,
  "seatsLimit": 3,
  "seatsAvailable": 3,
  "status": "TRIAL_PENDING"
}
```

Both are scoped by `centerId` from the signed token. There is no route that
names another center.

## Boundary and security rules

- Both endpoints sit behind `CenterAuthGuard`. Ownership comes from the token.
- A center with no subscription row must still get a coherent answer — treat a
  missing row as `TRIAL_PENDING` rather than 404, so a center created before
  this migration is not broken.
- `SubscriptionPolicyService` is the only place subscription rules exist.
  Controllers, guards and later jobs call it; none of them re-implement it.
- All comparisons use a single injected "now", so tests are deterministic and a
  request cannot straddle two clock reads.
- Read-only phase: no endpoint here mutates a subscription.
- No student model or student session is touched.

## Threat model

| Abuse | Control |
|---|---|
| Center reads another center's subscription | Both queries scoped by signed `centerId`; no id accepted from input |
| Student token reaches a center endpoint | `CenterAuthGuard` (Phase 1) rejects tokens without `actorType` |
| Expired trial keeps working because a job did not run | Status derived from timestamps on every read |
| Clock skew grants an extra day | One injected clock; boundary tests at exactly the expiry instant |
| Seat count drifts from reality | Seats are counted, never stored |
| Two concurrent provisions exceed the limit | Phase 4 concern; Phase 3 provides the counting primitive and tests it |
| Center deleted leaves an orphan subscription | `onDelete: Cascade` |

## Tasks

### Task 1: Subscription schema and migration

**Description:** Add `CenterSubscription` and `CenterPlan`, plus an additive
migration. No behaviour yet.

**Acceptance criteria:**
- One subscription per center enforced by a unique constraint.
- Migration is additive and touches no existing table.
- `prisma validate` and the production build pass.

**Verification:** `npx prisma validate`; `npm run build; "exit: $LASTEXITCODE"`

**Dependencies:** none · **Scope:** S · **Files:** `prisma/schema.prisma`, one migration

### Task 2: SubscriptionPolicyService

**Description:** The one authority. Takes a subscription record (or null) and a
clock, returns effective status, `graceEndsAt`, and `studentsMayLearn`.

**Acceptance criteria:**
- Every state reachable and covered: `TRIAL_PENDING`, `TRIAL`, `ACTIVE`, `GRACE_PERIOD`, `BLOCKED`, `CANCELLED`.
- A null subscription resolves to `TRIAL_PENDING`, not an error.
- Boundary tests at exactly `trial_ends_at`, exactly `paid_until`, and exactly the grace instant.
- `studentsMayLearn` is true for `TRIAL`, `ACTIVE`, `GRACE_PERIOD` only.

**Verification:** `npm test -- subscription-policy.service.spec`

**Dependencies:** 1 · **Scope:** M · **Files:** `subscription-policy.service.ts` + spec

### Task 3: Seat accounting

**Description:** Count students by `center_id` and resolve the limit from
effective status. Read-only.

**Acceptance criteria:**
- `seatsUsed` counts only students of that center.
- Limit is 3 while trial, `subscription.seats` when paid, 0 when blocked or cancelled.
- `seatsAvailable` never returns negative — an over-limit center reports 0.

**Verification:** `npm test -- center-subscription.service.spec`

**Dependencies:** 1, 2 · **Scope:** S

### Checkpoint A — policy is correct before anything exposes it

- [ ] Every state and boundary covered by tests
- [ ] Full unit suite green, build exit 0
- [ ] Human review of the state table before endpoints exist

### Task 4: `GET /api/centers/me/subscription`

**Acceptance criteria:**
- Guarded; unauthenticated returns 401.
- Response matches the documented shape; no internal ids or raw rows leak.
- A center with no subscription row gets `TRIAL_PENDING`, not 404.

**Verification:** `npm test -- center-subscription.controller.spec`

**Dependencies:** 2, 3 · **Scope:** S

### Task 5: `GET /api/centers/me/usage`

**Acceptance criteria:**
- Returns used, limit, available, status, scoped to the signed center.
- A second center's students never appear in the count.

**Verification:** same spec

**Dependencies:** 3, 4 · **Scope:** S

### Task 6: Integration tests against real Postgres

**Description:** Extend the existing integration suite. The unit tests prove we
call Prisma correctly; only this proves the constraint and the counting hold.

**Acceptance criteria:**
- The unique constraint rejects a second subscription for one center.
- Seat counting is correct with students spread across two centers.
- Deleting a center cascades its subscription away.

**Verification:** `npm run test:integration`

**Dependencies:** 1-5 · **Scope:** S

### Task 7: Bruno, Swagger, and the phase gate

**Acceptance criteria:**
- Both endpoints in the Bruno collection with their manual checks documented.
- Swagger describes both, including the states.
- Unit, e2e, integration, build and lint all exit 0.

**Dependencies:** 1-6 · **Scope:** S

### Checkpoint B — Phase 3 complete

- [ ] All gates by exit code
- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Access rules re-implemented in a guard later | High | One service; Phase 5 must call it, not copy it |
| Timezone handling makes expiry off by hours | Medium | Store and compare UTC only; boundary tests assert the exact instant |
| `ACTIVE` is unreachable until Phase 7, so untested in practice | Medium | Unit tests construct it directly; integration seeds a paid row by hand |
| Centers created before this migration have no subscription | Medium | Null resolves to `TRIAL_PENDING`; asserted in tests |

## Open questions

None blocking. The three that gated this phase were resolved on 2026-08-23:
activation keys live 7 days, removing a student frees its seat immediately, and
a provisioned student needs a name and email with phone optional.

One to confirm during review: **should `GET /subscription` be reachable while
`BLOCKED`?** Global assumption 7 says a blocked center keeps dashboard access
for profile, billing and renewal — which implies yes, and this plan assumes yes.

## Verification

```powershell
npm test
npm run test:e2e
npm run test:integration
npm run build; "exit: $LASTEXITCODE"
npm run lint
```

## Completion gate

Phase 3 is done when a center's effective status is derived entirely from
timestamps, seats are counted rather than stored, both endpoints are scoped by
the signed token, every state has a test including its boundary instant, and a
human has approved the merge to `dev`.
