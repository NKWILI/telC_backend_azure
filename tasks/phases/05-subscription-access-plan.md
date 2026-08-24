# Phase 5 Plan: Subscription Access Enforcement

Companion todo: `tasks/phases/05-subscription-access-todo.md`
Model it implements: `docs/ARCHITECTURE-B2B2C.md`

## Goal

Make the subscription mean something. Today a center can be `BLOCKED` and its
students keep learning — nothing checks. This phase closes that on every
protected learning path.

## The two rules

**1. One authority.** `SubscriptionPolicyService` already exists and is exported
for exactly this. The guard **calls** it. It must never re-derive access from
timestamps itself, because two implementations of one rule is how they drift.

**2. Enforced on refresh, not only at login.** A student blocked on Monday must
not keep working until their refresh token expires on Friday. This is already a
High risk in the global plan; a login-only check is the shape of the bug.

## What "blocked" means

| Actor | Blocked center |
|---|---|
| Student | No learning. Account, progress and history retained. |
| Center | Dashboard still reachable for profile, billing and renewal (global assumption 7) |

`studentsMayLearn` is true for `TRIAL`, `ACTIVE` and `GRACE_PERIOD` only.

A student with `center_id = null` — one who predates centers, or was removed
from one — is **not blocked**. They belong to no center, so no subscription
governs them. See open question 1.

## The enforcement surface

Every controller carrying `JwtAuthGuard` today, inventoried rather than guessed:

| Controller | Routes | Guard style |
|---|---|---|
| `lesen` | 2 | class-level |
| `listening` | 4 | class-level |
| `modelltests` | 2 | class-level |
| `speaking` | 1 | class-level |
| `speaking-catalog` | 2 | class-level |
| `sprachbausteine` | 4 | class-level |
| `writing` | 4 | class-level |
| `speaking/room` | 3 | **per-route, mixed** |
| `auth` | 14 | per-route — mostly must stay reachable |

Class-level controllers are a one-line change each. The two awkward ones are
below.

### `auth` must stay reachable

A blocked student still needs to log in, refresh, and reset a password —
otherwise they cannot recover an account whose center later pays. Only
`GET /api/auth/profile`-style learning-adjacent routes are candidates, and the
safe default is to leave `auth` entirely unguarded by subscription and enforce
on the learning modules.

`POST /api/auth/refresh` is the exception: it must **return a subscription
status** so a client learns it is blocked without waiting for a 403 on the next
learning call. Blocking refresh itself would strand the student.

## Two findings from the inventory

Both predate this phase. Neither is Phase 5's fault, and both are directly in
its way.

### 1. `POST /api/speaking/rooms` has no authentication

```ts
@Controller('api/speaking/rooms')   // no class-level guard
  @Post()
  @UseGuards(ThrottlerGuard)        // rate limit only
```

Room creation is rate-limited but anonymous. **A subscription cannot be enforced
on a route that does not know who the caller is.** Adding `JwtAuthGuard` here is
a behaviour change for existing clients, so it needs a decision rather than a
quiet fix. See open question 2.

### 2. The speaking WebSocket is outside the guard system entirely

`RoomGateway.handleConnection` only logs. `join-room` verifies a `hostToken` for
host rights but establishes no student identity, and HTTP guards do not run on
socket events.

So a blocked student who already holds a room id can keep practising speaking
over the socket while every HTTP route refuses them. **This is the bypass that
would make Phase 5 look complete while not being complete.** See open question 3.

## Tasks

### Task 1: `StudentSubscriptionGuard`

**Description:** Runs after `JwtAuthGuard`. Loads the student's center
subscription, calls `SubscriptionPolicyService`, and refuses when
`studentsMayLearn` is false.

**Acceptance criteria:**
- Calls the policy service; contains no date arithmetic of its own.
- `TRIAL`, `ACTIVE`, `GRACE_PERIOD` pass. `TRIAL_PENDING` and `BLOCKED` refuse.
- A student with no `center_id` passes.
- Refusal is `403 SUBSCRIPTION_INACTIVE`, distinct from a `401` — the student is
  authenticated, just not entitled.
- A database failure is `503`, never a silent pass and never a `403`.
- One query per request; the guard does not re-read what `JwtAuthGuard` loaded.

**Verification:** `npm test -- student-subscription.guard.spec`
**Scope:** M · **Dependencies:** none

### Task 2: Apply it to the class-level learning controllers

**Description:** `lesen`, `listening`, `modelltests`, `speaking`,
`speaking-catalog`, `sprachbausteine`, `writing`.

**Acceptance criteria:**
- Every route in those seven controllers refuses a blocked student.
- A test enumerates the controllers and asserts each carries the guard, so a
  controller added later without it fails the suite rather than shipping a hole.

**Verification:** `npm test -- subscription-enforcement.spec`
**Scope:** S · **Dependencies:** 1

### Task 2b: Close the speaking room entrance

**Description:** `POST /api/speaking/rooms` gains `JwtAuthGuard` and
`StudentSubscriptionGuard`, per decision 2.

**Acceptance criteria:**
- Creating a room without a token is `401`.
- A blocked student creating a room is `403 SUBSCRIPTION_INACTIVE`.
- `GET /rooms/:roomId` stays public, and guest join over the socket still works
  with no token — a test asserts this, because breaking it breaks the feature.

**Verification:** `npm test -- room.controller.spec`
**Scope:** S · **Dependencies:** 1

### Task 3: Report status on refresh

**Description:** `POST /api/auth/refresh` keeps working for a blocked student but
returns their subscription state.

**Acceptance criteria:**
- Refresh still succeeds when blocked — stranding them would prevent recovery.
- The response carries the effective status and `studentsMayLearn`.
- Login does the same, so a client knows before its first learning call.

**Scope:** S · **Dependencies:** 1

### Checkpoint A — the guard is right before it is everywhere

- [ ] Every state covered, including the no-center case
- [ ] Full suite green, build exit 0
- [ ] Human review

### Task 4: `CenterSubscriptionGuard`

**Description:** For center routes that should stop when blocked. Per global
assumption 7, profile, billing and subscription reads stay open; student
provisioning does not.

**Acceptance criteria:**
- A blocked center cannot provision students or mint activation keys.
- It can still read its profile, subscription and usage, and update its profile.

**Scope:** S · **Dependencies:** 1

### Task 5: Integration proof against real Postgres

**Acceptance criteria:**
- A student learns during `TRIAL`, and is refused once `trial_ends_at` passes —
  with no job having run in between.
- A student in `GRACE_PERIOD` still learns.
- Moving `paid_until` backwards blocks them on the very next request.
- A student with `center_id = null` is unaffected throughout.

**Verification:** `npm run test:integration`
**Scope:** M · **Dependencies:** 1-4

### Task 6: Bruno

**Description:** Requests that demonstrate a student being blocked and restored,
documenting how to move `paid_until` to see it happen without waiting 30 days.

**Scope:** S · **Dependencies:** 5

### Task 7: Gates and review

**Scope:** S · **Dependencies:** 1-6

### Checkpoint B — Phase 5 complete

- [ ] All gates by exit code
- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`

## Threat model

| Bypass | Control |
|---|---|
| Blocked student keeps a valid access token | Guard checks on every request, not at login |
| Blocked student refreshes indefinitely | Refresh reports status; learning still refused |
| A learning controller added later without the guard | Enumeration test over the controller list |
| Guard re-derives dates and drifts from the policy | Guard calls the service; asserted by test |
| Database failure silently grants access | Failure is 503, never a pass |
| Client hides the UI instead of the server refusing | Server-side only; UI is not enforcement |
| Room creation is anonymous | Task 2b adds `JwtAuthGuard` + subscription (decision 2) |
| Speaking WebSocket has no identity | Gated at creation instead; guest anonymity is deliberate. Residual ≤2h, unrenewable (decision 3) |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A learning route is missed | High | Inventory above, plus an enumeration test |
| The WebSocket path stays open | Medium | Gated at room creation (Task 2b); residual bounded to one 2-hour unrenewable room, documented in decision 3 |
| Task 2b breaks guest join by link | High | A test asserts an unauthenticated guest can still join; the guest was never meant to authenticate |
| Guard adds a query to every learning request | Medium | One indexed lookup; measure before optimising |
| Existing students without a center are locked out | High | They pass by design, and a test asserts it |

## Resolved decisions

Settled 2026-08-24, before any code was written.

### 1. A student with no center passes

Existing users predate this model, and a removed student has `center_id = null`.
Blocking them would lock every current user out of the product on the day this
ships. They belong to no center, so no subscription governs them.

Global open question 3 (what existing students eventually become) is unaffected
and still due before Phase 10.

### 2. `POST /api/speaking/rooms` gets `JwtAuthGuard` and the subscription guard

Added as Task 2b. The breaking-change risk that made this a question turned out
to be near zero, because the flow already requires a token one step later:

```ts
// room.controller.ts — already guarded today
@Get('ice-servers')
@UseGuards(JwtAuthGuard)
```

No WebRTC call completes without ICE servers, so a client that can finish a
speaking session is already sending a token.

### 3. The WebSocket is not authenticated, and does not need to be

The guest is anonymous **by design**, not by omission. `GET /rooms/:roomId` is
documented "public — no auth required", and `SPRECHEN_ROOM_PLAN.md` states that
"roomId + hostToken together are the credentials". Someone practises with a
partner who joins by link. **Authenticating the socket would break guest join.**

Enforcement belongs at room creation instead — the host consumes the
entitlement, the guest is a guest. Decision 2 puts it there.

**Residual exposure, accepted and bounded:** a student blocked *while already in
a room* keeps that room until it dies. `RoomService.createRoom` sets a hard
`setTimeout` delete at 2 hours with no extension path, and rooms are in-memory,
so the window is at most 2 hours and cannot be renewed. They cannot create
another room.

This is a documented boundary, not an unnoticed gap.

## Verification

```powershell
npm test
npm run test:e2e
npm run test:integration
npm run build; "exit: $LASTEXITCODE"
npm run lint
```

## Completion gate

Phase 5 is done when a blocked center's students cannot reach any protected
learning route, the check happens on every request rather than at login, a
student belonging to no center is unaffected, the WebSocket question is
explicitly resolved rather than forgotten, and a human has approved the merge.
