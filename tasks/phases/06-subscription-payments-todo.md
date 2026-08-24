# Phase 6 Todo: Price quotation and payment records

Companion to `tasks/phases/06-subscription-payments-plan.md`.

## Approval gate

- [x] Human answers the four opening questions
- [x] Human approves this specific plan
- [x] Create `feature/subscription-payments` from `dev`

## Task 1: Billing terms on Center

- [x] Migration adds unit_price_xaf (4800) and min_seats (10)
- [x] Backfill covers pre-existing centers, proven against real Postgres
- [x] Commit the green increment

## Task 2: PricingService

- [x] quote(center, seats) returns integers only
- [x] Refuses below min_seats
- [x] Refuses below current student count, with a distinct code
- [x] Reads terms from the center, not a constant
- [x] A partner center at 4,500 quotes 45,000 for 10 seats
- [x] Commit the green increment

## Task 3: POST /subscription/quote

- [x] Own center only
- [x] Client-supplied unitPrice / amount / total rejected
- [x] Reachable while blocked
- [x] Commit the green increment

## Checkpoint A

- [ ] Amount cannot be influenced by the client
- [ ] Both minimum rules enforced and distinguishable
- [ ] Human review before anything records money

## Task 4: Payment model and idempotent creation

- [x] Concurrent requests with one key create exactly one row (real Postgres)
- [x] Same key, different body: 409, first record unchanged
- [x] Same key, same body: returns the original
- [x] Amount recomputed server-side at creation
- [x] paid_until and seats untouched
- [x] Commit the green increment

## Task 5: Reading payments

- [x] Another center's payment is 404, never 403
- [x] History paginated with a capped page size
- [x] Commit the green increment

## Task 6: Blocked-center reachability

- [x] All four routes answer while BLOCKED
- [x] center-blocked-surface.spec.ts extended to pin them
- [x] Commit the green increment

## Task 7: Bruno

- [x] Quote and pay end to end
- [x] The attempts that must fail: client amount, below minimum, below student
      count, replayed key
- [x] Commit the green increment

## Task 8: Gates and review

- [ ] Unit, e2e, integration, build and lint by exit code
- [ ] Code-quality and security review
- [ ] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
