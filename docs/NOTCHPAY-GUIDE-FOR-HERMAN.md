# Notch Pay — what you need to do

Hi Herman. The payment flow is finished and tested with a **fake** provider.
You only need to plug in Notch Pay. You do **not** need to touch seats,
subscriptions, prices or access — that part is done.

More detail, if you need it: `tasks/phases/07-notchpay-handover.md`.

---

## 1. What already works

| Endpoint | Who calls it | What it does |
|---|---|---|
| `POST /api/payments` | center | Creates a payment. The server computes the price. |
| `POST /api/payments/:paymentId/checkout` | center | Returns `checkoutUrl`, where the center pays. |
| `POST /api/webhooks/payments` | **Notch Pay** | Receives the payment result. |
| (internal) `PaymentActivationService` | the webhook | Gives the center access, once. |

The flow:

```
center creates payment → center opens checkout → pays on Notch Pay
      → Notch Pay calls our webhook → we check it → access is switched on
```

---

## 2. Your job — two steps

### Step 1. Create `NotchPayProvider`

New file: `src/modules/centers/payment-providers/notchpay-payment-provider.ts`

It has **two methods**. Copy the shape of `fake-payment-provider.ts` next to it.

```ts
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  VerifiedPaymentEvent,
  WebhookHeaders,
} from './payment-provider';

export class NotchPayProvider implements PaymentProvider {
  readonly name = 'notchpay';

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    // 1. Ask Notch Pay to create a payment of request.amountXaf XAF.
    // 2. Put request.paymentId in the Notch Pay reference or metadata.
    // 3. Return:
    //    { providerReference: <Notch Pay transaction id>,
    //      checkoutUrl: <Notch Pay payment page> }
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: WebhookHeaders,
  ): Promise<VerifiedPaymentEvent> {
    // 1. Check Notch Pay's signature against rawBody (the exact bytes).
    //    Use crypto.timingSafeEqual. If wrong or missing:
    //    throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID');
    // 2. Only after the signature is valid, read the JSON.
    // 3. Return { providerReference, outcome: 'SUCCEEDED' | 'FAILED' }.
    //    If the status is anything else (pending, etc.):
    //    throw new BadRequestException('WEBHOOK_PAYLOAD_INVALID');
  }
}
```

**Check the official Notch Pay documentation** for the API call, the
signature header name, and how the signature is calculated. Do not guess them.

### Step 2. Turn it on

In `src/modules/centers/payment-providers/payment-provider.ts`, inside
`selectPaymentProvider`, add a branch **before** the final `return`:

```ts
if (
  settings.PAYMENT_PROVIDER === 'notchpay' &&
  settings.NOTCHPAY_API_KEY &&
  settings.NOTCHPAY_WEBHOOK_SECRET
) {
  return new NotchPayProvider(
    settings.NOTCHPAY_API_KEY,
    settings.NOTCHPAY_WEBHOOK_SECRET,
  );
}
```

Then:
- add those two names to `PaymentProviderSettings` in the same file;
- pass them in the factory in `src/modules/centers/centers.module.ts`;
- add them to `.env.example` (empty values only).

The variable names above are a suggestion — choose your own if you prefer.
The rule to keep: **if anything is missing, the provider stays disabled**.

---

## 3. Do not touch

- `payment-activation.service.ts` — it gives access. Your code never writes
  seats, plans or `paid_until`.
- The payment routes' guards. Do **not** add `CenterSubscriptionGuard` to
  them: a center that stopped paying must still be able to pay.
- Prices. The amount always comes from the payment in the database.

---

## 4. Before you start — agree with Alain

**Checking the amount.** Today nothing checks that Notch Pay received the
right amount. Before returning `SUCCEEDED`, the amount and currency Notch Pay
reports should match the payment. Agree with Alain how to do this, because it
changes our webhook service a little.

---

## 5. How to test

**Try the flow with the fake provider (no Notch Pay needed).**
Start the API with:

```
PAYMENT_PROVIDER=fake
FAKE_PAYMENT_WEBHOOK_SECRET=<any text of 32 characters or more>
```

Then in Bruno, folder **Center Payments**:
`02 Create payment` → `05 Start checkout` → `06 Simulate provider webhook`.
You should get `"outcome": "ACTIVATED"`.

**Run the tests:**

```
npm test                    # unit — no database
npm run test:e2e            # e2e — no database
npm run test:integration    # uses .env.test (test database)
npx tsc --noEmit            # must not show more errors than before
```

Add a unit test for your provider, like `test/payment-providers.spec.ts`:
a correct signature passes; a wrong secret, a changed body and a missing
signature are refused.

---

## 6. Safety rules

- `.env` is the **production** database. Never run `prisma migrate` with it.
- Keys and secrets only in environment variables. Never in code, never in logs.
- Never set `PAYMENT_PROVIDER=fake` on DigitalOcean.
- Use Notch Pay **test** keys on `dev`. Live keys only for `main`.

---

## 7. What Notch Pay will get back from our webhook

| Case | Status |
|---|---|
| Payment succeeded (first time or again) | 200 |
| Payment failed | 200 |
| Wrong or missing signature | 401 |
| Bad payload | 400 |
| Unknown reference | 404 (Notch Pay will retry) |
| No provider configured | 503 |
