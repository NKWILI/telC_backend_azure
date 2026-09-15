# Phase 7a Todo: Payment activation groundwork

Companion to `tasks/phases/07a-payment-activation-plan.md`.

## Slice 1: close Phase 6b

### Task 1: Close the open review items

**Acceptance criteria:**
- [x] `tsc --noEmit` at or below the CI baseline of 19
- [x] Lint clean on every changed file except the pre-existing
      `evaluation.service.ts` baseline of 33
- [x] Payment-creation transaction comment says what READ COMMITTED actually
      guarantees
- [x] Bruno `Get usage` documents `unassignedSeatsUsed`

**Verification:** unit, e2e, integration, build by exit code; commit.

**Files:** `test/auth-subscription-report.spec.ts`, `payments.service.ts`,
`bruno/Center Subscription/02 Get usage.bru`, formatting in 4 files.

**Scope:** Small

## Slice 2: the activation step

### Task 2: Store the provider reference

**Acceptance criteria:**
- [x] `payments.provider_reference` nullable and unique
- [x] `payments.succeeded_at`, `payments.failed_at` nullable
- [x] Applied to the test branch only; production untouched

**Verification:** build, integration proves the unique constraint.

**Files:** `prisma/schema.prisma`, new migration, one integration test.

**Scope:** Small

### Task 3: Activate a payment exactly once

**Acceptance criteria:**
- [x] `activate(paymentId)` marks SUCCEEDED, sets seats to
      the line quantities at the line prices, sets plan PAID, extends
      `paid_until` by 30 days from the later of now and the current end
- [x] Duplicate and concurrent activations of one payment change state once
- [x] Two different payments for one center both extend `paid_until`
- [x] A tier absent from the mix is removed only when no student holds it
- [x] A late success after FAILED still activates; `markFailed` never undoes
      SUCCEEDED
- [x] After activation the student entitlement reads ACTIVE

**Verification:** real-Postgres integration spec; unit suite; build.

**Files:** `payment-activation.service.ts`, `centers.module.ts`,
`test/payment-activation-integration.spec.ts`.

**Scope:** Medium

### Checkpoint A
- [x] All gates green, integration included
- [x] Activation proven against real Postgres

## Slice 3: the provider seam

Task 4 was split during implementation: as planned it touched eight files,
and a retried or double-clicked checkout must not open a second provider
transaction, which needs the checkout URL stored alongside the reference.

### Task 4a: Provider port, fake provider, selection

**Acceptance criteria:**
- [x] `PaymentProvider` port with `createCheckout` and `verifyWebhook`
- [x] Fake selected only with `PAYMENT_PROVIDER=fake`, non-production
      `NODE_ENV` and a secret of real length; otherwise the disabled provider
      answers 503
- [x] Fake webhooks verified by HMAC over the raw body; missing, wrong,
      tampered and wrong-length signatures refused; malformed payloads 400

**Verification:** unit spec; build.

**Files:** `payment-providers/payment-provider.ts`,
`payment-providers/fake-payment-provider.ts`,
`payment-providers/disabled-payment-provider.ts`, spec.

**Scope:** Small

### Task 4b: Start a checkout

**Acceptance criteria:**
- [ ] `payments.checkout_url` nullable, applied to the scratch branch only
- [ ] `POST /api/payments/:paymentId/checkout` returns a checkout URL, storing
      reference and URL once; a repeat returns the stored session without a
      second provider call
- [ ] Refuses a non-PENDING payment; scoped to the signed-in center (404 for
      another's); no subscription guard; rate limited per center

**Verification:** real-Postgres spec for storage and repeats; controller spec
for scoping, guards and refusals.

**Files:** schema + migration, `payments.service.ts`, `payments.controller.ts`,
`centers.module.ts`, `rate-limit.service.ts`, specs.

**Scope:** Medium

### Task 5: Verified webhook

**Acceptance criteria:**
- [ ] `POST /api/webhooks/payments` verifies the signature over the raw body
- [ ] A bad or missing signature is refused and changes nothing
- [ ] A verified success activates; a verified failure marks failed
- [ ] A duplicate event is acknowledged and changes nothing
- [ ] An unknown reference answers 404 so the provider retries

**Verification:** e2e-style spec against the real app wiring with `rawBody`.

**Files:** `payment-webhooks.controller.ts`, `main.ts` / `bootstrap-config.ts`,
test.

**Scope:** Medium

### Checkpoint B
- [ ] Full fake flow: create, checkout, signed webhook, access active
- [ ] Forged, duplicated and reordered events cannot grant access

## Slice 4: handover

### Task 6: Bruno, handover document, superseded plan marked

**Acceptance criteria:**
- [ ] Bruno requests for checkout and a signed fake webhook
- [ ] `tasks/phases/07-notchpay-handover.md`: what exists, the one function,
      the port to implement, env vars, security checklist, what not to touch
- [ ] `06-subscription-payments-plan.md` marked superseded where it describes
      dropped columns

**Verification:** paths and fields checked against code; gates green; commit.

**Scope:** Small

### Checkpoint C
- [ ] All gates green
- [ ] Human review, then Phase 6b Checkpoint C and merge to `dev`
