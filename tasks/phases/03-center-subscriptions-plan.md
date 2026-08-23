# Phase 3 Plan: Trial, Subscription, and Seat Policy

Companion todo: `tasks/phases/03-center-subscriptions-todo.md`
Model it implements: `docs/ARCHITECTURE-B2B2C.md`
Revised 2026-08-23 after the eight decisions below were taken.

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

## Decisions taken before planning (2026-08-23)

| # | Decision |
|---|---|
| 1 | Grace applies **only** after a paid period lapses. An expired trial goes straight to `BLOCKED`. |
| 2 | The subscription row is created **with the center**, inside the registration transaction. |
| 3 | Being over the seat limit blocks **new provisioning only**. Existing students are unaffected. |
| 4 | Buying during a trial does not cut it short: `paid_until = max(now, trial_ends_at) + 30 days`. |
| 5 | There is no `CANCELLED` state. Not paying is the only exit. |
| 6 | A period is a fixed **30 days**, not a calendar month. |
| 7 | The seat limit always reads `subscription.seats` — 3 at creation, 10+ once paid. |
| 8 | The trial starts at the first student **activation** (Phase 4), so `TRIAL_PENDING` may last indefinitely. |

## The central decision: status is derived, never stored

A `status` column would have to be kept correct by a scheduled job. When that
job runs late — a deploy, a stuck worker, a timezone bug — every center is
silently in the wrong state, and the failure direction is *granting access
nobody paid for*.

So the table stores only **facts with timestamps**, and the effective status is
computed on read:

```
trial_started_at is null                 → TRIAL_PENDING
now < trial_ends_at                      → TRIAL
paid_until set and now < paid_until      → ACTIVE
paid_until set and now < paid_until + 7d → GRACE_PERIOD
otherwise                                → BLOCKED
```

Grace exists so a paying customer whose transfer is late keeps service. A trial
user owes nothing and has nothing to be late with, so an expired trial goes
straight to `BLOCKED` — which also keeps "30-day trial" literally true rather
than quietly meaning 37.

`graceEndsAt` is derived as well, and is null whenever there is no paid period.
A stored copy is one more value that can disagree with the timestamps it came
from.

A scheduler may still exist later for *reminders*, but access will never depend
on it having run. This closes the global plan's risk row *"Subscription
scheduler runs late — access guard derives effective status from authoritative
timestamps."*

## Seats

Per `docs/ARCHITECTURE-B2B2C.md`, a seat is **the existence of a `Student` row
carrying the center's `center_id`**. There is no counter column, so there is
nothing to drift.

```
used  = COUNT(students WHERE center_id = X)
limit = subscription.seats        (3 at creation, 10+ once paid)
```

The limit always comes from the column, never from a constant chosen by status.
One place to read from, no branch in the seat logic, and extending one school to
five trial students becomes a data change rather than a code change.

**Being over the limit blocks new provisioning only.** Existing students keep
working while the subscription is otherwise valid. A school dropping from ten
seats to five does not knock five students out of their course, and nobody has
to decide which five.

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

**The row is created with the center, inside the existing registration
transaction.** Every center then provably has exactly one subscription,
`GET /subscription` is a plain read, and there is no permanent "missing row"
branch to reason about. Existing centers are backfilled by the migration.

**Periods are a fixed 30 days**, not calendar months. A payment on 31 January
runs to 2 March. No month-end clamping, no leap-year branch, and with manual
monthly payment nobody is anchored to a billing date.

**Nothing sets `trial_started_at` in this phase.** The trial starts on the first
successful student activation, which is Phase 4. Every center created here sits
at `TRIAL_PENDING`, possibly forever if none of its students ever activate —
which is intended: the clock starts when value starts.

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
- Every center has a row by construction; a missing one is a bug, not a
  supported state.
- `SubscriptionPolicyService` is the only place subscription rules exist.
  Controllers, guards and later jobs call it; none re-implement it.
- All comparisons use a single injected "now", so tests are deterministic and a
  request cannot straddle two clock reads.
- Read-only phase: no endpoint here mutates a subscription.
- No student model or student session is touched.

## Threat model

| Abuse | Control |
|---|---|
| Center reads another center's subscription | Both queries scoped by signed `centerId`; no id accepted from input |
| Student token reaches a center endpoint | `CenterAuthGuard` rejects tokens without `actorType` |
| Expired trial keeps working because a job did not run | Status derived from timestamps on every read |
| Clock skew grants an extra day | One injected clock; boundary tests at the exact expiry instant |
| Seat count drifts from reality | Seats are counted, never stored |
| Two concurrent provisions exceed the limit | Phase 4 concern; Phase 3 provides and tests the counting primitive |
| Center deleted leaves an orphan subscription | `onDelete: Cascade` |
| A failed registration leaves a center with no subscription | Both inserts share one transaction |

## Tasks

### Task 1: Schema, migration, and creation at registration

**Description:** Add `CenterSubscription` and `CenterPlan`, a migration that
backfills every existing center, and a third insert in the Phase 1 registration
transaction.

**Acceptance criteria:**
- One subscription per center, enforced by a unique constraint.
- The migration backfills every existing center; none is left without a row.
- Registering a center creates its subscription in the same transaction, so a
  failed registration leaves no orphan.
- Phase 1 registration tests stay green unchanged.
- `prisma validate` and the production build pass.

**Verification:** `npx prisma validate`; `npm test -- centers.service.spec`; `npm run build; "exit: $LASTEXITCODE"`

**Dependencies:** none · **Scope:** M · **Files:** `prisma/schema.prisma`, one migration, `centers.service.ts`, its spec

### Task 2: SubscriptionPolicyService

**Description:** The one authority. Takes a subscription record and a clock,
returns effective status, `graceEndsAt`, and `studentsMayLearn`.

**Acceptance criteria:**
- Every state covered: `TRIAL_PENDING`, `TRIAL`, `ACTIVE`, `GRACE_PERIOD`, `BLOCKED`.
- An expired trial resolves to `BLOCKED`, never `GRACE_PERIOD`.
- `graceEndsAt` is null whenever there is no paid period.
- Boundary tests at exactly `trial_ends_at`, exactly `paid_until`, and exactly `paid_until + 7d`.
- `studentsMayLearn` is true for `TRIAL`, `ACTIVE`, `GRACE_PERIOD` only.

**Verification:** `npm test -- subscription-policy.service.spec`

**Dependencies:** 1 · **Scope:** M

### Task 3: Seat accounting

**Description:** Count students by `center_id` and read the limit from the
column. Read-only.

**Acceptance criteria:**
- `seatsUsed` counts only students of that center.
- The limit always reads `subscription.seats`, with no status-dependent branch.
- `seatsAvailable` never returns negative — an over-limit center reports 0.
- Being over the limit is reported, not punished: existing students unaffected.

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

**Verification:** `npm test -- center-subscription.controller.spec`

**Dependencies:** 2, 3 · **Scope:** S

### Task 5: `GET /api/centers/me/usage`

**Acceptance criteria:**
- Returns used, limit, available and status, scoped to the signed center.
- A second center's students never appear in the count.

**Dependencies:** 3, 4 · **Scope:** S

### Task 6: Integration tests against real Postgres

**Description:** Extend the existing integration suite. The unit tests prove we
call Prisma correctly; only this proves the constraint, the backfill and the
counting hold.

**Acceptance criteria:**
- The unique constraint rejects a second subscription for one center.
- Registering a center yields exactly one subscription row.
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
| `ACTIVE` unreachable until Phase 7, so untested in practice | Medium | Unit tests construct it directly; integration seeds a paid row by hand |
| Centers created before this migration have no subscription | Medium | The migration backfills them; an integration test asserts none is left without one |
| Registration regresses while gaining a third insert | Medium | Phase 1 registration tests must stay green unchanged |

## Open questions

None blocking. The three that gated Phase 4 and the eight above were resolved on
2026-08-23.

One to confirm during review: **should `GET /subscription` be reachable while
`BLOCKED`?** Global assumption 7 says a blocked center keeps dashboard access for
profile, billing and renewal — which implies yes, and this plan assumes yes.

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
