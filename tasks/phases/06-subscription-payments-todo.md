# Phase 6 Todo: Price quotation and payment records

Companion to `tasks/phases/06-subscription-payments-plan.md`.

## Approval gate

- [x] Human answers the four opening questions
- [ ] Human approves this specific plan
- [ ] Create `feature/subscription-payments` from `dev`

## Task 1: Billing terms on Center

- [ ] Migration adds unit_price_xaf (4800) and min_seats (10)
- [ ] Backfill covers pre-existing centers, proven against real Postgres
- [ ] Commit the green increment

## Task 2: PricingService

- [ ] quote(center, seats) returns integers only
- [ ] Refuses below min_seats
- [ ] Refuses below current student count, with a distinct code
- [ ] Reads terms from the center, not a constant
- [ ] A partner center at 4,500 quotes 45,000 for 10 seats
- [ ] Commit the green increment

## Task 3: POST /subscription/quote

- [ ] Own center only
- [ ] Client-supplied unitPrice / amount / total rejected
- [ ] Reachable while blocked
- [ ] Commit the green increment

## Checkpoint A

- [ ] Amount cannot be influenced by the client
- [ ] Both minimum rules enforced and distinguishable
- [ ] Human review before anything records money

## Task 4: Payment model and idempotent creation

- [ ] Concurrent requests with one key create exactly one row (real Postgres)
- [ ] Same key, different body: 409, first record unchanged
- [ ] Same key, same body: returns the original
- [ ] Amount recomputed server-side at creation
- [ ] paid_until and seats untouched
- [ ] Commit the green increment

## Task 5: Reading payments

- [ ] Another center's payment is 404, never 403
- [ ] History paginated with a capped page size
- [ ] Commit the green increment

## Task 6: Blocked-center reachability

- [ ] All four routes answer while BLOCKED
- [ ] center-blocked-surface.spec.ts extended to pin them
- [ ] Commit the green increment

## Task 7: Bruno

- [ ] Quote and pay end to end
- [ ] The attempts that must fail: client amount, below minimum, below student
      count, replayed key
- [ ] Commit the green increment

## Task 8: Gates and review

- [ ] Unit, e2e, integration, build and lint by exit code
- [ ] Code-quality and security review
- [ ] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
