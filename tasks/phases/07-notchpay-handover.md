# Phase 7 handover: connecting Notch Pay

For Herman. Everything on Lerniqo's side of a payment is built and tested
against a fake provider. Your job is one class — `NotchPayProvider` — and one
branch that selects it. You should not need to touch anything that grants
access.

Branch: `feature/center-onboarding` (merging to `dev` after review).
Plan and decisions: `tasks/phases/07a-payment-activation-plan.md`.

## The flow

```
center                         Lerniqo API                         provider
  │  POST /api/payments  ───────▶ PENDING payment, price computed
  │                               by the server, per-tier lines
  │  POST /api/payments/:id/checkout ─▶ PaymentCheckoutService
  │                               │  provider.createCheckout() ────▶ open transaction
  │                               │  store provider_reference + checkout_url (once)
  │ ◀──────── checkoutUrl ────────┘
  │  pays on provider's page ─────────────────────────────────────▶
  │                               POST /api/webhooks/payments ◀──── event
  │                               │  provider.verifyWebhook(rawBody, headers)
  │                               │  find payment by provider_reference
  │                               │  PaymentActivationService.activate / markFailed
  │                               └─ plan PAID, seats set, paid_until +30 days
```

## What you build

### 1. `NotchPayProvider implements PaymentProvider`

File: `src/modules/centers/payment-providers/notchpay-payment-provider.ts`.
The interface is in `payment-provider.ts` and has two methods.

**`createCheckout({ paymentId, centerId, amountXaf })`** — open a Notch Pay
transaction for `amountXaf` XAF and return `{ providerReference, checkoutUrl }`.
- `amountXaf` is computed by the server. Never take an amount from anywhere else.
- Put `paymentId` in the transaction's reference or metadata, so a transaction
  can always be traced back to its payment.
- It is called at most once per payment: `PaymentCheckoutService` stores the
  reference and URL and answers repeats from the database.

**`verifyWebhook(rawBody, headers)`** — prove the event came from Notch Pay and
return `{ providerReference, outcome: 'SUCCEEDED' | 'FAILED' }`.
- Verify the signature over `rawBody`, the exact bytes received. The app is
  created with `rawBody: true` for this; do not verify a re-serialised body.
- Compare signatures in constant time (`timingSafeEqual`, lengths checked
  first). `fake-payment-provider.ts` shows the shape.
- Unverified: throw `UnauthorizedException('WEBHOOK_SIGNATURE_INVALID')`.
  Verified but unusable: throw `BadRequestException('WEBHOOK_PAYLOAD_INVALID')`.
- Map every Notch Pay status that is not a definite success or definite failure
  (pending, processing, …) to a refusal or a no-op — never to `SUCCEEDED`.

### 2. Select it

In `selectPaymentProvider` (`payment-provider.ts`), add a `notchpay` branch.
Keep the rule that it **fails closed**: only when `PAYMENT_PROVIDER=notchpay`
and every key it needs is present. Anything missing returns the disabled
provider, which answers 503. Add the new settings to `PaymentProviderSettings`
and to the factory in `centers.module.ts`.

The test to copy is `test/payment-providers.spec.ts`: nothing configured,
missing keys and unknown names must all give `DisabledPaymentProvider`.

### 3. Prove it

- A unit spec for `NotchPayProvider` like `payment-providers.spec.ts`: a real
  signed Notch Pay payload verifies; wrong secret, tampered body, missing and
  wrong-length signatures are refused.
- Keep `test/payment-flow-integration.spec.ts` green. It is the whole flow with
  the fake; if you can, add a variant with your provider and recorded payloads.

## Do not touch

- **`PaymentActivationService`.** It is the only code that grants access, and
  its rules are tested against Postgres and mutation-checked. Your provider
  never writes `payments.status`, `center_seats`, `center_subscriptions.plan`
  or `paid_until`. If you think activation needs to change, raise it first.
- **`CenterSubscriptionGuard` on payment or checkout routes.** A blocked
  center must always be able to pay; adding it is a revenue bug.
  `center-blocked-surface.spec.ts` will fail.
- **Pricing.** The amount comes from the payment row, computed at creation.

## What activation does (so you know what a success means)

- **Exactly once.** A duplicate or concurrent event for the same payment
  changes nothing and returns `ALREADY_ACTIVE`. Answer the webhook 200 either
  way so Notch Pay stops retrying.
- **Seats are set, not added**, to each line's quantity at each line's price
  (grandfathering). A tier the payment no longer covers is removed unless a
  student is in it.
- **30 days**, from the later of now and the current `paid_until`.
- **A late success after FAILED still activates.** `markFailed` only moves a
  PENDING payment, so a late failure never undoes a success.
- **Money received is honoured**, even if the center is now over its seats.

## Webhook responses Notch Pay will see

| situation | status | body `error` / `outcome` |
|---|---|---|
| verified success, first time | 200 | `ACTIVATED` |
| verified success, again | 200 | `ALREADY_ACTIVE` |
| verified failure | 200 | `MARKED_FAILED` or `UNCHANGED` |
| bad or missing signature | 401 | `WEBHOOK_SIGNATURE_INVALID` |
| payload unusable | 400 | `WEBHOOK_PAYLOAD_INVALID` |
| reference no payment holds | 404 | `PAYMENT_REFERENCE_UNKNOWN` (Notch Pay retries) |
| no provider configured | 503 | `PAYMENT_PROVIDER_NOT_CONFIGURED` |

Route: `POST /api/webhooks/payments`. If Notch Pay's dashboard needs a
different path, add a route that calls the same `PaymentWebhookService`.

## Security checklist

- [ ] Re-check the official Notch Pay docs at implementation time: signature
      header name, algorithm, and exactly which bytes are signed.
- [ ] Keys and webhook secret live only in environment variables, server-side.
      Never logged, never returned.
- [ ] **Confirm the amount.** Activation trusts that a verified success paid
      `payments.amount_xaf`. Before returning `SUCCEEDED`, check the amount
      and currency Notch Pay reports (in the event, or by fetching the
      transaction from their API) match the payment. This is not enforced
      anywhere yet — see open items.
- [ ] Consider confirming status by fetching the transaction from Notch Pay's
      API rather than trusting the event body alone.
- [ ] Test mode keys on `dev`; live keys only when merging to `main`.
- [ ] Never set `PAYMENT_PROVIDER=fake` on DigitalOcean. The code refuses in
      `NODE_ENV=production`, but do not rely on that alone.

## Environment variables

| name | where | purpose |
|---|---|---|
| `PAYMENT_PROVIDER` | all | `fake` locally; `notchpay` once built; unset = disabled |
| `FAKE_PAYMENT_WEBHOOK_SECRET` | local / test only | 32+ characters |
| Notch Pay keys and webhook secret | dev, then prod | names are yours to choose |

## Running things safely

- `npm test`, `npm run test:e2e` — no database.
- `npm run test:integration` — uses `.env.test` (a scratch Neon branch).
- **`.env` is the production database.** Never run `prisma migrate` with it.
  To apply migrations to the scratch branch, export `DATABASE_URL` and
  `DIRECT_URL` from `.env.test` first.
- CI type-checks with a ratchet: `tsc --noEmit` must not exceed its baseline.
  ts-jest does not type-check, so run `npx tsc --noEmit` before pushing.

## Open items

1. **Amount confirmation** (above). Recommended shape: add an optional
   `amountXaf` to `VerifiedPaymentEvent` and have `PaymentWebhookService`
   refuse a success whose amount differs from `payments.amount_xaf`. Worth
   agreeing before you build, since it touches our service.
2. **Tiers a payment no longer covers** are removed (decision (a)), pending the
   product owner's confirmation. Not yours to change; noted so it is not a
   surprise.
3. **Expired checkouts.** Nothing moves a payment to `EXPIRED` yet. If Notch Pay
   reports expiry, decide with us whether it maps to `markFailed`.
