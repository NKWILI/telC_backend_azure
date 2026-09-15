# Implementation Plan: Payment activation groundwork (Phase 7a)

## Overview

Phase 6b records a payment and grants nothing. Phase 7 connects Notch Pay, and
that is Herman's work. The agreement is that the whole flow is built on our
side first, with a fake provider, so Herman only has to plug in the real one:
start a checkout, verify a webhook, and call one function we already tested.

This plan builds that one function (activation), the provider seam it sits
behind, a fake provider that exercises the full path end to end, and the
handover. It also closes the review items still open from Phase 6b.

## Architecture decisions

**1. One function grants access: `PaymentActivationService.activate`.**
Everything a successful payment changes happens there, in one transaction:
payment status, seat rows, plan and `paid_until`. Herman's provider code never
writes those tables itself. A second writer is how grandfathering and the
exactly-once rule would get broken.

**2. Exactly once, by compare-and-swap on the payment row.**
`UPDATE payments SET status = SUCCEEDED WHERE id = ? AND status <> SUCCEEDED`.
A duplicated or reordered webhook updates zero rows and changes nothing else.
No lock table, no event log needed for correctness.

**3. A late success still activates.** The transition to `SUCCEEDED` is allowed
from `PENDING`, `FAILED` or `EXPIRED`, because the provider is the authority on
whether money moved. `markFailed` only moves `PENDING`, so it can never undo a
success.

**4. Seats are SET, not added — decision (a).** The mix is everything the
center will hold, the same meaning "totals, not increments" has everywhere
else. For each line, the `center_seats` row gets the line's quantity and the
line's price. Stamping the LINE price, not today's list price, is what keeps
grandfathering true. A converting trial seat (price 0) is overwritten by the
paid price.

Tiers held but absent from the mix are removed, with one guard: a tier that
still has students is left untouched, so a student is never stranded without a
seat. The quote already refuses that case at creation; the guard only covers
the minutes between quote and payment.

Assumed, not yet confirmed by the product owner. Flipping to (b) — keep tiers
not named — is a one-line change in `activate`.

**5. A paid period is 30 days, added without losing an extension.**
The new end is the later of now and the current `paid_until`, plus 30 days. A
fixed day count avoids month-end arithmetic (Jan 31 + 1 month) and matches the
day-based trial and grace constants.

Implemented as a row lock (`SELECT ... FOR UPDATE` on the subscription) and a
Prisma write, not the single SQL statement first planned. The column is a
timestamp without a time zone, and date arithmetic across the driver boundary
can shift by the local UTC offset. The lock gives the same guarantee: a second
concurrent activation waits, then reads the extended value.

**6. Money received is always honoured.** If students were provisioned between
quote and payment so the center is now over its seats, activation still
succeeds. Refusing would take money and grant nothing. Over-limit already
blocks new provisioning without evicting anyone.

**7. The provider is a port.** `PaymentProvider` has two methods:
`createCheckout(payment)` and `verifyWebhook(rawBody, headers)`. Implementations:
- `FakePaymentProvider` — HMAC-signed events, for dev and tests.
- `DisabledPaymentProvider` — the default; every call answers
  503 PAYMENT_PROVIDER_NOT_CONFIGURED.
- `NotchPayProvider` — Herman's.

The fake is selected only when `PAYMENT_PROVIDER=fake`, `NODE_ENV` is not
`production`, and `FAKE_PAYMENT_WEBHOOK_SECRET` is set. `main` auto-deploys, so
a missing env var must never turn on a provider that accepts forged payments.

**8. Provider-neutral webhook route: `POST /api/webhooks/payments`.**
The global plan names `/api/webhooks/notchpay`. A neutral path means nothing
downstream changes when the fake is swapped for Notch Pay. Herman may add an
alias if Notch Pay's dashboard needs a fixed path.

**9. Payment creation does not become Serializable.** Both reviews noted its
transaction is READ COMMITTED while its comment claimed more. Serializable
there would turn the same-key insert race into serialization failures and 500s.
The guarantees that matter move to activation (decisions 2, 4, 6), and the
comment is corrected to say what the transaction really does.

## Dependency graph

```
T1 review fixes (independent)
T2 provider_reference migration
   └── T3 activation service
          └── T4 provider port + fake + checkout
                 └── T5 webhook endpoint
                        └── T6 Bruno + handover
```

## Task list

### Slice 1: close Phase 6b
- [x] Task 1: Close the open review items

### Slice 2: the activation step
- [x] Task 2: Store the provider reference
- [x] Task 3: Activate a payment exactly once

### Checkpoint A
- [x] All gates green, integration included
- [x] Activation proven against real Postgres

### Slice 3: the provider seam
- [x] Task 4a: Provider port, fake provider, selection
- [x] Task 4b: Start a checkout
- [x] Task 5: Verified webhook

### Checkpoint B
- [ ] The full fake flow works: create, checkout, signed webhook, access active
- [ ] Forged, duplicated and reordered events cannot grant access

### Slice 4: handover
- [ ] Task 6: Bruno, handover document, superseded plan marked

### Checkpoint C
- [ ] All gates green
- [ ] Human review, then the existing Phase 6b Checkpoint C and merge to `dev`

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Fake provider reachable in production | High — forged payments grant access | Needs explicit env var, non-production `NODE_ENV` and a secret; otherwise disabled. Tested. |
| Two webhooks for one payment | High — double extension | CAS on payment status; concurrency test against Postgres |
| Two payments for one center at once | Medium — one extension lost | `paid_until` extended in one SQL statement; concurrency test |
| Grandfathering broken at activation | High — wrong price stamped | Stamp the line price; test with a stamped 4,000 center |
| Raw body needed for signatures | Medium — signature cannot be verified on parsed JSON | Enable Nest `rawBody`; test the webhook with the real app wiring |
| Decision (a) is wrong for the product | Low | One-line switch; flagged in handover |

## Open questions

- Decision (a) vs (b) for tiers absent from a payment — assumed (a).
- Notch Pay merchant readiness (keys, webhook signature contract) — Herman's,
  global-plan open question 8.
