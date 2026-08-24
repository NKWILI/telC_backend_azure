# Phase 6 Plan: Price quotation and payment records

Companion todo: `tasks/phases/06-subscription-payments-todo.md`
Model it implements: `docs/ARCHITECTURE-B2B2C.md`
Global plan: `tasks/center-subscription-global-plan.md` (Phase 6)

## Goal

The backend calculates what a center owes and records a durable, retry-safe
intent to pay it. **No money moves in this phase.** Nothing here talks to a
provider, and nothing here grants access.

## The one rule

**The client never supplies a price.** It asks for a number of seats; the
server decides what that costs from terms it holds. Any endpoint that accepts
an amount from the caller is a bug, not a feature.

## Decisions settled before planning (2026-08-24)

### 1. Billing terms live on `Center`, added now

`unit_price_xaf` and `min_seats` are added in this phase, defaulting to 4,800
and 10. Phase 2 later only *writes* them when a partnership code is consumed.

The alternative was hard-coding 4,800 and rewriting the pricing service in
Phase 2. This way the pricing authority is built once, and Phase 2 becomes a
data change rather than a rebuild. It also matches global assumption 4: a
consumed code copies an **immutable pricing snapshot** onto the center, so
editing a code later never alters an existing contract.

### 2. One month per payment

The quote takes seats and always covers one month. Multi-month can be added
later without changing the payment record, and it keeps `paid_until`
arithmetic to a single addition in Phase 7.

### 3. A center cannot buy fewer seats than it is using

Seats must be at least `max(min_seats, current student count)`. A center with
12 students cannot pay for 10. Removing students already works while blocked,
so the way out is open.

### 4. The client supplies the idempotency key

`Idempotency-Key` header, claimed atomically and bound to a hash of the
payload. A replay with the same key and a *different* body is rejected rather
than silently returning the first record. This is the convention a frontend
developer will already expect.

## Assumptions, stated rather than asked

- **XAF has no minor units.** Amounts are integers. No floats anywhere near
  money — a rounding error in a currency without cents is pure loss.
- **The payment record snapshots its own pricing.** Unit price, seats and
  total are copied onto the record at creation, so a later price change never
  rewrites history.
- **Nothing here grants access.** `paid_until` and `seats` are untouched by
  this phase. Only a verified provider event may move them, in Phase 7.
- **No provider integration.** No Notch Pay keys, no HTTP calls out.

## The Phase 5 interaction that must not be got wrong

`CenterSubscriptionGuard` refuses provisioning when a center is blocked. The
payment routes **must not carry it**.

A blocked center that cannot pay is a center that can never come back. The
whole reason Phase 5 left the dashboard open was so the road to paying stayed
open, and these are the last few metres of that road.

`test/center-blocked-surface.spec.ts` already pins which center routes stay
reachable while blocked. Phase 6 extends it with the payment routes, so this
cannot be quietly reversed by someone "hardening" the controller later.

## API surface

```text
POST /api/centers/me/subscription/quote   what N seats would cost
POST /api/payments                        create a pending payment record
GET  /api/payments/:paymentId             read one, scoped to this center
GET  /api/centers/me/payments             this center's payment history
```

All four require `CenterAuthGuard`. None require an active subscription.

## Data

```prisma
model Payment {
  id          String        @id @default(uuid())
  center_id   String
  seats       Int
  /// Snapshot at creation. A later price change must not rewrite history.
  unit_price_xaf Int
  amount_xaf     Int
  status      PaymentStatus @default(PENDING)
  /// Claimed atomically; unique per center.
  idempotency_key String
  /// Hash of the request body, so a replay with different terms is refused
  /// rather than silently handed the first record.
  request_hash    String
  ...
  @@unique([center_id, idempotency_key])
}

enum PaymentStatus { PENDING SUCCEEDED FAILED EXPIRED }
```

`SUCCEEDED` is never set in this phase. It exists so Phase 7 has somewhere to
put a verified result without a migration.

## Tasks

### Task 1: Billing terms on `Center`

**Acceptance criteria:**
- Migration adds `unit_price_xaf` (default 4800) and `min_seats` (default 10).
- Backfill covers pre-existing centers, proven against real Postgres — the
  same defect this layer caught in Phase 3.

**Scope:** S · **Dependencies:** none

### Task 2: `PricingService`

**Description:** The single authority on what a center owes. Pure, no HTTP.

**Acceptance criteria:**
- `quote(center, seats)` returns unit price, seats, total, all integers.
- Refuses seats below `min_seats`.
- Refuses seats below the center's current student count, with a distinct code
  so the dashboard can say which rule was broken.
- Reads terms from the center; contains no hard-coded 4800 outside a default.
- A partner center at 4,500 quotes 45,000 for 10 seats, asserted directly.

**Verification:** `npm test -- pricing.service.spec`
**Scope:** M · **Dependencies:** 1

### Task 3: `POST /subscription/quote`

**Acceptance criteria:**
- Returns the quote for a caller's own center only.
- A client-supplied `unitPrice`, `amount` or `total` is rejected by the global
  pipe, asserted by test — this is the security property of the phase.
- Reachable while blocked.

**Scope:** S · **Dependencies:** 2

### Checkpoint A — pricing is right before anything records money

- [ ] Amount cannot be influenced by the client
- [ ] Both minimum rules enforced and distinguishable
- [ ] Human review

### Task 4: `Payment` model and idempotent creation

**Acceptance criteria:**
- Two concurrent requests with one key create exactly **one** row, proven
  against real Postgres rather than mocks.
- Same key, different body: 409, and the first record is unchanged.
- Same key, same body: returns the original record, not a duplicate.
- Amount is recomputed server-side at creation, never read from the request.
- Status is `PENDING`; `paid_until` and `seats` are untouched, asserted.

**Verification:** `npm run test:integration`
**Scope:** L · **Dependencies:** 2

### Task 5: Reading payments

**Acceptance criteria:**
- `GET /api/payments/:id` for another center's payment is **404**, never 403 —
  the same rule the student routes already follow, so an id cannot be probed.
- History is paginated with a capped page size.

**Scope:** S · **Dependencies:** 4

### Task 6: Blocked-center reachability

**Acceptance criteria:**
- All four routes answer while the center is `BLOCKED`.
- `center-blocked-surface.spec.ts` extended to pin them.

**Scope:** S · **Dependencies:** 3, 5

### Task 7: Bruno

**Description:** Quote and pay end to end, including the attempts that must
fail: a client-supplied amount, a seat count below the minimum, a seat count
below the student count, and a replayed idempotency key.

**Scope:** S · **Dependencies:** 6

### Task 8: Gates and review

**Scope:** S · **Dependencies:** 1-7

### Checkpoint B — Phase 6 complete

- [ ] All gates by exit code
- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`

## Threat model

| Attack | Control |
|---|---|
| Client posts its own amount | Amount computed server-side; extra fields rejected by the global pipe |
| Client posts a partner price | Price read from the center's own terms, never the request |
| Double-click creates two payments | Unique `(center_id, idempotency_key)`, claimed atomically |
| Replay with altered seats | Key bound to a payload hash; mismatch is 409 |
| Paying for fewer seats than students | Quote refuses below current student count |
| Reading another center's payment | Scoped by `center_id`; 404, never 403 |
| A pending record grants access | Status is advisory here; only Phase 7 may move `paid_until` |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A blocked center cannot reach the payment routes | **Critical** — they can never recover | Task 6 pins all four; the guard is deliberately absent |
| Money held as float | High | Integer XAF throughout, asserted in the pricing tests |
| Idempotency proven only against mocks | High | Task 4 is verified against real Postgres, concurrently |
| Phase 2 later contradicts these terms | Medium | Phase 6 owns the columns, Phase 2 only writes them |

## Completion gate

Phase 6 is done when a center can be told what it owes, that number cannot be
influenced by the caller, a retried request creates exactly one record, a
blocked center can reach every one of these routes, and no payment record has
granted anybody access.
