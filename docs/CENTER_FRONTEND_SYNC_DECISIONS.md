# Center dashboard ↔ backend: sync decisions

The decisions taken while aligning the backend with the center dashboard
(`sprach`, Next.js). The frontend's own spec is the source these are measured
against. Each entry says what was chosen, what it replaces, and what is still
open, so nobody re-opens a settled question or builds on an open one.

Fixed product rule for everything below: **the center free trial lasts 14
days.** The plan id `demo_30` is a leftover name, not a duration.

---

## D1. Seats are a pool of activation codes (frontend model)

**Decided:** 2026-09-16
**Status:** decided, not built

### What we adopt

One seat is one activation code, as the frontend spec describes.

- A new `ActivationCode` table, scoped to a center.
- Format `LQ-XXXX-XXXX`, uppercase, globally unique.
- Stored **in plain text** under a unique index. The manager must be able to
  see a code again on the Users page, so a hash-only store does not work. The
  protection is that a code can be deactivated, not that it is secret.
- Codes are created by the backend only, never by hand:
  - after a **confirmed** payment (webhook), until the count per plan matches
    the paid seats — never at payment intent;
  - when the trial starts, until there are 10 trial codes.
  - Existing codes are never deleted.
- Status: `activated` → `connected` (student redeems) → `deactivated`, and
  `deactivated` → `activated`. Any other move is refused
  (`INVALID_CODE_TRANSITION`).
- **No code type.** Every code is a personal code for one student's own
  account. The frontend's `private` / `public` type is dropped (see D5).
- The student redeems the code **from their own student account**
  (`POST /api/auth/redeem-code`). Redemption sets the student's center and
  tier; deactivation clears them, which ends access because entitlement is
  read on every request.
- Manager routes: list with filters (`status`, `planId`), seat summary
  (bought vs used), activate, deactivate. All are scoped
  to the caller's center; a `centerId` is never accepted from the client.

### What we keep from the current backend

- **Single-use, race-proof redemption:** one predicated update is the gate, so
  two students cannot claim the same code.
- **Audit trail:** the redeeming IP and time are recorded.

### The student's path (confirmed 2026-09-17)

1. The center gets codes (trial or paid pack) on the dashboard.
2. The center gives a code to its student (paper, WhatsApp, email).
3. The student has an account in the **Flutter app** (web or mobile) and
   enters the code there.
4. The Flutter app sends the code to the backend (`POST /api/auth/redeem-code`).
5. **The backend alone decides.** It checks the code (exists, `activated`, not
   expired, center not blocked), links it to the student, and returns the
   student's access.
6. On every later request the backend checks again whether that access still
   holds (code still connected, not expired, center not blocked). The Flutter
   app never decides access by itself; it only shows what the backend says.

### What it replaces

The per-student activation key: the manager provisions a student, the backend
issues a one-time key stored as a hash, and the student sets a password with
it (`Student.activation_key_hash`, `POST /api/centers/me/students`,
`POST /api/student-activations`). This path is to be removed once codes ship.

### Dropped

- **`public` codes** — removed from the product entirely, see D5.

### Still open

- Is any real center using per-student keys in production? If yes, those
  students need migrating to codes before the old path is removed.
- Code expiry: one date for the whole center (renewal) or one per code. Tied to
  the renewal decision, which is not taken yet.

---

## D2. Account status is computed, never stored

**Decided:** 2026-09-16
**Status:** decided, not built

### What we adopt

The backend keeps **no** stored `paymentStatus`, `onboardingCompleted` or
`onboardingStep` column. `SubscriptionPolicyService` keeps deriving the status
from timestamps (`TRIAL_PENDING`, `TRIAL`, `ACTIVE`, `GRACE_PERIOD`,
`BLOCKED`), and `GET /api/centers/me` translates it into the fields the
frontend expects.

| Frontend field | Derived as |
|---|---|
| `paymentStatus` | `TRIAL` → `trial`; `ACTIVE`, `GRACE_PERIOD` → `paid`; `TRIAL_PENDING`, `BLOCKED` → `unpaid` |
| `subscriptionStatus` | the raw derived status, returned alongside so the dashboard can show "grace period" or "blocked" |
| `onboardingCompleted` | `true` once a trial has started or any payment has ever succeeded; it never goes back to `false` |
| `onboardingStep` | `1` if manager fields are missing, `2` if school fields are missing, `3` otherwise, `4` once `onboardingCompleted` |

The frontend's paid-action lock is enforced on the server from the same
derivation: a paid action on a center with `onboardingCompleted = false`
returns `403 ACCOUNT_NOT_FINALIZED`. It sits beside the existing
`CenterSubscriptionGuard` check for `BLOCKED`, not in a second copy of the
rules.

### Why

A stored status must be kept true by a scheduled job, and when that job runs
late it grants access nobody paid for. Derived from timestamps, nothing can go
stale, and **the end of the 14-day trial needs no nightly job**: the center
reads as `unpaid` (and its trial codes as expired) the moment the clock runs
out.

### Consequences

- An expired trial reads `paymentStatus = unpaid` with
  `onboardingCompleted = true`, matching the frontend's state table.
- Which fields count as "manager fields" and "school fields" is defined once,
  next to the existing `deriveOnboardingState`, and extended with the country
  address rules (CM / DE) when those fields are added.
- The frontend never writes any of these fields. There is no endpoint to set
  them.

### Still open

- The frontend badge has a "pending" state. Whether `/me` should also expose an
  in-flight payment (e.g. `pendingPaymentId`) is decided with the billing
  work.

---

## D3. The free trial is 14 days and 1 seat (= 1 activation code)

**Decided:** 2026-09-16
**Status:** decided, not built

### What we adopt

- **One seat, one code.** The backend's existing rule (`TRIAL_SEATS = 1` in
  `centers.service.ts`) stands. Starting the trial creates exactly **one**
  `demo_30` activation code, never more. This follows D1: one seat is one code.
- **14 days.** Every trial code expires at `trialEndsAt`, which is the trial
  start plus 14 days.
- **What the code gives:** the trial seat is an ordinary `START` seat priced at
  0 XAF (the backend's existing model), so a trial student has exactly the
  Start plan's access and quotas. `demo_30` is only the code's label.
- **One trial per center.** It is refused if the center already had one
  (`TRIAL_ALREADY_USED`) or has already paid (`ALREADY_PAID`).
- **Expiry needs no job (D2):** from `trialEndsAt` the center reads `unpaid`,
  the code can no longer be redeemed (`CODE_EXPIRED`), and the connected
  student loses access because entitlement is checked per request.

### Frontend changes this requires

The frontend currently has no real trial: it issues 10 codes
(`DEMO_TRIAL_SEATS = MIN_SEATS`), dates them +30 days, and never checks the
date again.

- `DEMO_TRIAL_SEATS` → **1**. The Users page seat summary shows 1 bought.
- `computeExpiresAt("trial")` +30 → **+14**, and the "Demo 30 Tage" /
  "30 days" labels in `de`, `en`, `fr`.
- Stop creating codes in the browser; codes come from the backend.
- Read `trialEndsAt` from `GET /api/centers/me` and show a countdown, an
  expired state, and a "trial ended, choose a plan" prompt.

### When the clock starts

**Decided:** the 14-day clock starts **when the manager presses the trial
button** (`POST /api/centers/me/trial`), not at the first student redemption.
`trialStartedAt` and `trialEndsAt` are set by that call, in the same
transaction that creates the one trial code, so the code's `expiresAt` is known
the moment it exists. This replaces the backend's current behaviour, where the
first student activation starts the clock.

---

## D4. Subscription model: the School Pack (M3)

**Proposed:** 2026-09-17
**Decided:** 2026-09-18, by the backend dev and Herman — **M3 adopted**.
**Status:** decided, not built

The model is settled: renewal, adding seats, code expiry, invoice amounts and
pro rata are built on the rules below. Some amounts inside those rules are
still open (see "Still open" at the end of this entry); they change numbers,
not the model.

### The idea in one sentence

A school buys a **pack of at least 10 seats** that **renews on one date each
month** (or year). Every seat is an activation code (D1), and all codes of a
school end on that same date.

### Rules

1. **Trial** — as D3: 14 days from the trial button, 1 code, one per school.
2. **First purchase** — at least 10 seats in any mix of Start / Pro / Premium.
   The payment day becomes the **anchor day**. One code per seat, all ending
   on the pack's end date. A trial student is moved to a paid code
   automatically and the trial code is retired.
3. **Adding seats mid-period** — any number, paid **pro rata** until the anchor
   day: `seats × monthly price × days left ÷ days in this period`, **rounded
   up**, with a **minimum charge** (amount to set from Notch Pay's fees). New
   codes end with the others. Adding seats **never moves** the renewal date.
4. **Last 7 days of a period** — rule 3 still applies; the system **also
   offers, never forces**, "add the seats and renew the whole pack now".
5. **Renewal** — the whole pack for the next period. The manager may keep,
   grow, shrink or change plans. Never below **10 seats**, never below the
   number of **connected students**.
6. **No shrinking mid-period** — no refunds. A code can be deactivated but the
   seat stays paid until renewal. Plan changes and monthly ↔ annual switches
   happen only at renewal.
7. **Late payment** — up to **7 days** late (grace): students keep access and
   the anchor day does not change. More than 7 days late (blocked): students
   lose access, nothing is deleted, and paying starts a **new period that day**
   (new anchor day); blocked days are not charged.
8. **Annual** — 12 months × 0.95. Same rules with a one-year period; seats added
   during the year are pro rata by day to the yearly date.
9. **Calendar** — the period is a **calendar month** (not 30 days). The anchor
   day is remembered: a missing day (29–31) uses the month's last day and the
   next month returns to the real day (31 Jan → 28 Feb → 31 Mar). The day is
   counted in **Africa/Douala** time.

### Worked example (Alain, monthly Start, 4,500 XAF)

| Date | Event | Pays |
|---|---|---|
| 1 Jan | Pack of 10, anchor day 1 | 45,000 |
| 5 Jan | +6 seats, 27 of 31 days left (23,516 → rounded up) | 23,600 |
| 29 Jan | +1 seat, 3 days left (435 → minimum charge) | 1,000 |
| 1 Feb | Renews 17 seats | 76,500 |
| 1 Mar | Renews, shrinks to 12 | 54,000 |
| 1 Apr | Tries 8 → refused (min 10), renews 10 | 45,000 |
| 6 May | Pays in grace, anchor stays 1 | 45,000 |
| 15 Jun | Pays after being blocked, new anchor 15 | 45,000 |
| 15 Jul | Switches to annual at renewal | 513,000 |

### Why this model

- **Guaranteed floor:** every paying school ≥ 45,000 XAF per month; renewal is
  always the whole school, so the minimum cannot be bypassed.
- **Fewer lost schools:** one date, one reminder, one payment.
- **Growth charged immediately** through pro rata, with no forced big payment.
- **Annual** brings cash upfront and a 12-month commitment.
- **Closest to the existing backend:** one `paid_until` per center, whole-mix
  renewal, `MIN_PAID_SEATS_TOTAL = 10` and the 7-day grace already exist.

### Alternatives considered

- **M1 — each code has its own expiry (SIM-card style), at least 10 active
  codes at every payment.** Rejected: codes about to expire
  still count, so a school can pay for ~5.5 seats a month on average (−45%)
  without breaking the rule; the minimum only holds on payment days; expiry
  dates scatter, which means more payments, more fees and more missed
  renewals. A fix (count only codes valid ≥15 more days) closes the loophole
  but not the rest.
- **M4 — codes sold only in prepaid packs of 10.** Simple, but no guaranteed
  monthly revenue and a rewrite of the backend.
- **30-day periods instead of calendar months.** ~1.4% more revenue (12.17
  payments a year instead of 12) but the renewal date drifts every month.
- **Forced renew-now bundle in the last 7 days.** Rejected: a school adding one
  student would have to pay the whole next month at once, and may not add the
  student at all.

### What it means for activation codes

"All codes of a school end on the same date" is implemented by **not giving
paid codes a date of their own**: a paid code keeps `expires_at = null` and
follows the center's `paid_until` (plus the 7-day grace). One renewal then
extends every code at once, and no code can be left behind by a missed update.
Only the trial code carries `expires_at` (the trial end, D3). At the first
purchase the trial code is deactivated and its student moved to a paid code
(rule 2), so no paid school keeps a code with a past date.

### Pro rata calculation

Decided 2026-09-18 (the minimum charge figure is Herman's, B2).

```
amount = seats × monthly price × days left ÷ days in the period
         rounded UP to the next 100 XAF, never below the minimum charge
```

- **Days left:** from today (counted) up to the anchor day (not counted).
  5 Jan → 1 Feb = 27 days. Days are counted in Africa/Douala time (rule 9).
- **Days in the period:** the real length of the current calendar month
  (28–31).
- **Each plan separately:** Start 4,500, Pro 10,000, Premium 20,000 XAF per
  seat per month; one line per plan, then summed. Rounding is applied to the
  total.
- **Annual:** yearly price (12 × monthly × 0.95) × days left ÷ days in the
  year (365 or 366).
- **Rounded up to 100 XAF**, so Mobile Money amounts are clean.
- **Minimum charge:** 1,000 XAF proposed (about one week of one Start seat), so
  fees do not eat a tiny payment; Herman confirms it from Notch Pay's fees
  (B2).
- Integer arithmetic only (multiply before dividing), as the existing pricing
  service already does.

| When (anchor day 1) | Added | Calculation | Pays |
|---|---|---|---|
| 5 Jan | 6 Start | 6 × 4,500 × 27 ÷ 31 = 23,516 | 23,600 |
| 29 Jan | 1 Start | 1 × 4,500 × 3 ÷ 31 = 435 | 1,000 |
| 15 Feb | 2 Pro | 2 × 10,000 × 14 ÷ 28 = 10,000 | 10,000 |

### Shrinking at renewal: which codes go

Decided 2026-09-18. When a school renews with fewer seats in a plan (15 → 10
Start seats, for example):

1. **Unused codes are removed first** (`activated`, then `deactivated`),
   newest first.
2. **A connected code is never removed.** If the school wants fewer seats than
   it has connected students in that plan, the renewal is refused; the manager
   deactivates or resets (D39) first. This is rule 5 ("never below the number
   of connected students"), applied per plan.

### Must be part of the payment work

The payment routes exist (phases 6 and 7a) but no real provider is wired, so
nobody can pay yet. When payment is built, a successful payment must also:

- **create one code per new seat**, `expires_at = null` (codes follow
  `paid_until`) — today activation sets seat counts and `paid_until` but
  creates **no codes**, so a paying school would have nothing to hand out;
- **move the trial student to a paid code** and retire the trial code
  (rule 2);
- **store the anchor day** that defines each period (rule 9), which renewal,
  pro rata and the reset limit (D39) all read.

### Answered with this entry

- **M3 or M1?** → M3.
- **The quota contradiction** (Pro 5 / Premium 20 "total" on the frontend vs
  "per 24 hours" in the backend) → already settled by D15 / B4: per rolling 24
  hours; the landing page wording is what changes.

### Still open (numbers inside the model, not the model)

- **B1** Is the 10-seat minimum right, given the trial is 1 seat (a jump from
  free to 45,000 XAF/month)?
- **B2** The minimum charge for small pro rata payments — needs Notch Pay's
  real fee and minimum amount.
- **B3** AI cost per speaking session: does 4,500 XAF per Start seat stay
  profitable at 2 sessions per 24 hours?
- **B5** Are prices VAT-inclusive? Will German schools pay in EUR?

---

## D5. No public codes: activation codes are personal only

**Decided:** 2026-09-17
**Status:** decided — backend done (no `type` on `ActivationCode`), frontend removal to do

There are **only personal activation codes**: one code, one student, used from
that student's own account. The shared-computer ("public", school PC, kiosk)
idea is **not part of the product**, not deferred.

Consequences:
- The backend stores **no `type`** on `ActivationCode` and has **no route** to
  change a code's type (`PATCH /activation-codes/:id` and `CODE_TYPE_LOCKED`
  are not built).
- The frontend removes the type column, the type filter, the type switch and
  the `type` field from its fake data.

---

## D6. Trial abuse: accepted as is

**Decided:** 2026-09-17
**Status:** decided, nothing to build

One trial per center stays the only rule. No phone verification, no manual
approval.

**Why:** the trial is 14 days and **one seat on the Start plan**, so a school
that registers again to get another trial costs very little. If the AI usage
data later shows real abuse, this is re-opened.

---

## D7. Flutter app home screen: definitions (provisional)

**Decided:** 2026-09-17
**Status:** agreed direction, **details to be refined when it is implemented**

| Element | Definition |
|---|---|
| **Streak** | A day counts when the student completes at least 1 exercise that day, in the student's time zone |
| **Daily objective** | 1 exercise a day, or 20 minutes — the exact choice is made at implementation |
| **Weekly goal** | 120 minutes by default, adjustable by the student |
| **Readiness** | The same formula the school dashboard shows (D38), so student and school see one number |
| **Session of the day** | An exercise in the student's weakest skill |
| **Attempts below threshold** | Score under 60% (roughly the telc pass mark) |

**Why it matters:** these numbers make students come back every day, and daily
use is what schools see as progress when they decide to renew.

Depends on: T17 (`StudentActivity`) for the data, B10 for the readiness formula.

---

## D8. No Google sign-in; no "my devices" screen for now

**Decided:** 2026-09-17
**Status:** decided — Google removal is a task, not done yet

- **Google sign-in is removed from the product**, and its code is deleted.
- **The "manage my devices" screen is set aside** (not built now).

### Google removal task (backend)

What exists today:
- Routes `POST /api/auth/google` and `POST /api/auth/google/link`
  (`auth.controller.ts`).
- `google.service.ts` (`google-auth-library`, `GOOGLE_CLIENT_ID`), the Google
  DTOs, the OAuth branches in `auth.service.ts`, the linking token in
  `token.service.ts`, Google error codes in `auth.errors.ts`, Swagger response
  DTOs, and references in `main.ts`, `auth.module.ts`, `package.json`,
  `.env.example`.
- The `OAuthAccount` table (`oauth_accounts`).

How to remove it safely:
1. **Code first:** delete the routes, service, DTOs, errors, linking token,
   dependency and env variable, with their tests. Also remove
   `/api/auth/google` and `/api/auth/google/link` from the Flutter app's
   interceptor skip list and endpoint constants.
2. **Check production before dropping the table:** if any student has an
   `oauth_accounts` row, that student may have no password and would be
   locked out. Those students need a password reset email first.
3. **Drop the table in a later, separate migration**, only after step 2 (a
   destructive migration, and `main` deploys to production).

---

## D9. A student account alone gives no access: a code is required

**Decided:** 2026-09-17
**Status:** decided, not built

- A student **may already have an account, or creates one** in the Flutter app
  (register → verify email, or log in).
- **Having an account gives no access to the learning content.** Access comes
  only from a redeemed activation code (D1), checked by the backend on every
  request.
- A logged-in student with no valid code sees only the **"enter your activation
  code"** screen. The same screen appears when access ends (trial over, code
  deactivated or expired, center blocked), with the backend's error explaining
  why.
- The backend refuses content routes for such a student with one agreed error
  (see T20), which the Flutter app turns into a redirect to that screen.

### Still open

- The Flutter app's existing **guest / demo mode** (`POST /api/auth/guest`):
  keep it as a no-account preview, or remove it? Recorded as B16.

---

## D10. Error codes: the backend is the reference

**Decided:** 2026-09-17
**Status:** decided; center dashboard to align

### Rules

- Every error body is `{ "error": "CODE", "message": "text" | ["text", …] }`,
  plus extra fields when a refusal needs them (`missing`, `requiredSeatsTotal`,
  `requiredSeatsPerTier`, …). `message` is for logs only; the UI translates
  `error`.
- **Frontends branch on `error`, never on the HTTP status**, with two
  exceptions: `401` on a protected route (refresh, then log out) and `429`
  (rate limited). Status codes may change; codes do not.
- The backend does not rename codes to match frontend guesses. New codes are
  added here first, then built.

### Codes that exist today (center routes)

| Route | Code | Status | Meaning / frontend action |
|---|---|---|---|
| any body | `VALIDATION_ERROR` | 400 | `message` is an array of field errors |
| any rate-limited route | `RATE_LIMIT_EXCEEDED` | 429 | "too many requests" |
| register | — | 2xx | always the same generic message (no "email already registered") |
| register | `EMAIL_DELIVERY_FAILED` | 5xx | generic "try again" |
| verify-email-public | `VERIFICATION_TOKEN_EXPIRED` | 400 | expired link |
| verify-email-public | `VERIFICATION_TOKEN_INVALID` | 400 | invalid or used link |
| login | `INVALID_CREDENTIALS` | 401 | wrong email or password |
| login | `EMAIL_NOT_VERIFIED` | 403 | warning, check inbox |
| login, reset | `DEVICE_ID_REQUIRED` | 400 | client bug: deviceId missing |
| login, reset | `CENTER_SESSION_RETRY_EXHAUSTED`, `CENTER_SESSION_CREATION_FAILED` | 5xx | generic "try again" |
| reset-password | `RESET_CODE_INVALID` | 400 | wrong code |
| reset-password | `RESET_CODE_EXPIRED` | 400 | expired code |
| refresh | `INVALID_CENTER_REFRESH_TOKEN` | 401 | log out locally |
| protected routes | `INVALID_CENTER_ACCESS_TOKEN` | 401 | refresh once, retry, else log out |
| protected routes | `CENTER_SESSION_REVOKED` | 401 | log out (session ended elsewhere) |
| PATCH /centers/me | `NO_PROFILE_FIELDS_SUPPLIED` | 400 | nothing to update |
| /centers/me | `CENTER_PROFILE_NOT_FOUND` | 404 | log out |
| quote, payments | `SEAT_MIX_EMPTY`, `SEATS_INVALID` | 400 | invalid seat input |
| quote, payments | `SEATS_BELOW_MINIMUM` | 400 | carries `requiredSeatsTotal` |
| quote, payments | `SEATS_BELOW_STUDENT_COUNT` | 400 | carries `requiredSeatsTotal`, maybe `requiredSeatsPerTier` |
| quote, payments | `SEATS_ABOVE_MAXIMUM`, `AMOUNT_ABOVE_MAXIMUM` | 400 | carries the maximum |
| payments | `CENTER_PROFILE_INCOMPLETE` | 403 | carries `missing[]`; send to onboarding |
| payments | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED` | 400/409 | client bug |
| payments | `CHECKOUT_IN_PROGRESS`, `PAYMENT_NOT_PENDING`, `PAYMENT_NOT_FOUND`, `PAYMENT_PROVIDER_NOT_CONFIGURED` | 4xx/5xx | payment state messages |
| paid actions | `SUBSCRIPTION_INACTIVE` | 403 | center blocked: send to subscription |
| provisioning | `SEAT_LIMIT_REACHED` | 403 | all seats used |

Codes of the per-student key flow (`ACTIVATION_KEY_*`, `STUDENT_*`,
`PASSWORD_TOO_SHORT`) disappear with it (D1).

### Frontend codes that do not exist, and what replaces them

| Frontend code | Backend answer |
|---|---|
| `EMAIL_ALREADY_REGISTERED`, `ALREADY_REGISTERED` | never sent (anti-enumeration) — remove |
| `INVALID_RESET_CODE`, `CODE_INVALID` | use `RESET_CODE_INVALID` |
| `CODE_EXPIRED` (for reset) | use `RESET_CODE_EXPIRED` |
| `ONBOARDING_INCOMPLETE` (422) | use `CENTER_PROFILE_INCOMPLETE` (403, `missing[]`) |
| `SEAT_MIX_TOO_SMALL` | use `SEATS_BELOW_MINIMUM` |
| `MAX_DEVICES_REACHED` | never sent: a 4th device logs out the oldest (T7) |
| `CODE_TYPE_LOCKED` | dropped with public codes (D5) |
| `SEED_ACCOUNT_PROTECTED`, `ACCOUNT_NOT_FOUND` | fake mode only — never sent by the API |
| `PAYMENT_FAILED` | not an error: a payment's `status` is `FAILED` |

### Codes to be added when their feature is built

| Code | Feature |
|---|---|
| `ACCOUNT_NOT_FINALIZED` (403) | paid-action lock (D2) |
| `TRIAL_ALREADY_USED`, `ALREADY_PAID` (409) | trial start (D3) |
| `INVALID_CODE_TRANSITION` (409) | manager code actions (D1) |
| `CODE_INVALID`, `CODE_ALREADY_USED`, `CODE_DEACTIVATED`, `CODE_EXPIRED` | student redeem (D1, T11) |
| `WRONG_CURRENT_PASSWORD` | change password (T14) |
| `LOGO_INVALID_TYPE`, `LOGO_TOO_LARGE` | logo upload (T13) |
| `SEAT_BELOW_PAID_FLOOR`, `NOTHING_TO_PAY` | purchase and renewal (D4) |

---

## D11. Profile updates are split: school and manager are two routes

**Decided:** 2026-09-17
**Status:** decided, not built

Today one `PATCH /api/centers/me` (`UpdateCenterProfileDto`) writes the manager
(`firstName`, `lastName`, `phone`) **and** the school (`centerName`, `country`,
`city`, `logoUrl`) in one call. It is split in two:

### `PATCH /api/centers/me` — the school

| Field | Rule |
|---|---|
| `name` | 2–100 characters (today `centerName`; renamed for the frontend) |
| `countryCode` | must exist in `GET /api/locations` (T8) |
| `regionId` | must belong to that country |
| `cityId` | must belong to that region |
| `district` | **required for CM**, optional for DE |
| `postalCode` | **required for DE**, not collected for CM |
| `street`, `houseNumber` | **required for DE**, optional for CM |

The address rules depend on the **school's** country, so they are validated
here and nowhere else. The logo is not set here; it has its own route (T13).

### `PATCH /api/centers/me/manager` — the manager

| Field | Rule |
|---|---|
| `firstName`, `lastName` | 2–50 characters; editable in the onboarding wizard, read-only on the settings page (the frontend decides which it sends) |
| `phone` | `^\+?[0-9 ()-]{5,30}$` |
| `countryCode`, `regionId`, `cityId` | the manager's own location, validated against the locations list, **no address rules** |

`email` is never editable here.

### Both routes

- Center login required, scoped to the caller's own center; no `centerId` is
  accepted from the client.
- Every field optional, but an empty body is refused
  (`NO_PROFILE_FIELDS_SUPPLIED`).
- Invalid country / region / city → `VALIDATION_ERROR` naming the field.
- Both return the same `GET /api/centers/me` shape, so the dashboard shell can
  refresh the header (name, logo) from the answer.
- Nothing writes `onboardingStep` or `onboardingCompleted`: they stay derived
  (D2).

### Why

The school and the manager follow different rules — the address rules exist
only for the school — and the wizard saves them in two separate steps. Two
routes keep each set of rules in one place and give the frontend clear field
errors, instead of one route validating two unrelated things.

---

## D12. The onboarding draft stays in the browser

**Decided:** 2026-09-17
**Status:** decided, nothing to build

The half-filled wizard form keeps living in the browser
(`lerniqo.center.onboarding.draft`). **There is no
`GET`/`PUT /api/centers/me/onboarding` route and no draft table.**

**Why:** each wizard step already writes its real data to the backend as soon
as it is valid (D11 for steps 1 and 2), and the step to resume at is derived on
read (D2). What the draft holds is unvalidated, half-typed text. A manager who
switches device loses a few characters, not a completed step — not worth a
route, a table and a sync rule.

**Consequence for the frontend:** after each wizard step, save to the backend
and clear that part of the draft. The wizard resumes at `onboardingStep` from
`GET /api/centers/me`, not at the step stored in the browser.

---

## D13. A 4th center device logs out the least recently used one

**Decided:** 2026-09-17
**Status:** decided, already the backend's behaviour

A center user may hold **3 active sessions**
(`MAX_ACTIVE_CENTER_DEVICES = 3`). A 4th login succeeds and the
**least recently used** session is revoked (`center-auth.service.ts`, ordered
by `last_used_at`, then `created_at`). The login is never refused for this
reason, so **`MAX_DEVICES_REACHED` is never sent** and the frontend must stop
expecting it (D10).

**Why:** a manager is never locked out, and without a "manage my devices"
screen (set aside in D8) a refusal would leave them with no way forward. A
rarely used school computer is simply logged out and can log in again.

**Consequence:** the revoked device's next request gets `401`
`CENTER_SESSION_REVOKED` and the frontend logs out locally (D10). Same rule
for students if a device limit is ever added there (T22).

---

## D14. Locations: controlled country, searchable city, region derived

**Decided:** 2026-09-17
**Status:** decided, not built

### The rule

- **Country is a controlled list.** ISO codes, `CM` and `DE` today. It decides
  the address rules (D11) and, later, currency and tax.
- **City is one searchable field**, not a dropdown chained to a region. It
  offers our known cities and accepts **"other city" as free text**, so a
  school in an unlisted town is never blocked.
- **Region is not a question.** A known city carries its region, filled in by
  the backend. An "other" city has no region until someone adds it.
- **Address fields** (district, postal code, street, house number) follow the
  per-country rules in D11.
- The manager's own location (D11) uses the same fields.

### The data

**Constants in code**, like `TIER_PRICES_XAF` — not a database table. Two
countries and a few dozen cities do not justify a table or an admin screen, and
git carries the history of every change. Ids are slugs (`CM`, `littoral`,
`douala`) so renaming a display name never rewrites stored rows.

Stored on a center / manager: `country_code`, `city_id` **or** `city_other`
(free text), and `region_id` derived from the city.

### The route

`GET /api/locations` — public, no database query, returns in one response:
countries → regions → cities (grouped for display) plus each country's address
rules. Served with `Cache-Control: public, max-age=86400` and an `ETag`; the
frontend may also keep it in localStorage.

**Cost:** ~5–10 KB (1–2 KB gzipped), read about 2–3 times in a school's life
(onboarding and settings). DigitalOcean App Platform bills a fixed price per
instance, not per request, so this route is effectively free. A database-backed
list would instead add a query per call.

### Operations

- "Other city" entries are visible to us, and a city typed often enough is
  promoted into the constants (one commit) and the old rows repointed.
- Existing `country` / `city` free-text columns must be migrated to the new
  fields. Check the production values first; nothing reads them today, so there
  should be little or nothing to convert.

### Why not the alternatives

- **Chained country → region → city dropdowns:** a school in a city we did not
  list cannot finish onboarding at all, and each missing city becomes a support
  request and a deploy.
- **Database table + admin screen:** more machinery than two countries need;
  revisit if we sell across many cities.
- **A full external city dataset (geonames):** thousands of villages make the
  field worse, not better.
- **Free text everywhere (Stripe's approach):** Stripe only needs an address
  for tax, and a card gives it a billing address. Mobile Money gives us none,
  and free text produces "Douala / douala / Dla", which no report can group.

---

## D15. Plans come from the backend; quotas are per 24 hours

**Decided:** 2026-09-17
**Status:** decided, not built

### The quota rule (settles B4)

The AI speaking allowance is **per rolling 24 hours**, exactly as
`TIER_AI_ALLOWANCE` already enforces:

| Plan | AI speaking sessions |
|---|---|
| Start | **2 per 24 hours** |
| Pro | **5 per 24 hours** |
| Premium | **20 per 24 hours** |

A trial seat is a Start seat, so it gets 2 per 24 hours (D3).

The landing page currently advertises Pro as "5 total" and Premium as "20
total", which is **wrong** and must be corrected to "per day". The window is
rolling, not a calendar day, so no time zone is involved.

The *numbers* may still change once the real AI cost per session is measured
(B3); the *rule* does not.

### `GET /api/plans`

Public and cacheable like `GET /api/locations` (D14), built from the backend's
own constants — `TIER_PRICES_XAF`, `MIN_PAID_SEATS_TOTAL`, `TIER_AI_ALLOWANCE`
— so there is one source for every number:

```
{
  "minSeats": 10,
  "annualDiscountFactor": 0.95,
  "plans": [
    { "id": "start",   "monthlyPricePerSeatXaf": 4500,
      "aiSpeaking": { "limit": 2, "window": "per_24h" },
      "examModule": false, "fullAiAllModules": false },
    { "id": "pro",     "monthlyPricePerSeatXaf": 10000,
      "aiSpeaking": { "limit": 5, "window": "per_24h" },
      "examModule": true,  "fullAiAllModules": false },
    { "id": "premium", "monthlyPricePerSeatXaf": 20000,
      "aiSpeaking": { "limit": 20, "window": "per_24h" },
      "examModule": true,  "fullAiAllModules": true }
  ]
}
```

**The frontend keeps only names and descriptions** (translation keys such as
`plans.start.name`). **Every number** — price, minimum seats, annual discount,
quotas — is read from this route. The trial is not a plan here; it is a Start
seat at zero price (D3).

**Why:** today the same numbers live in the frontend *and* the backend. Raising
Start to 4,800 in the backend would leave the site advertising 4,500 while
managers are charged 4,800 — a price the school never agreed to. One source
removes that whole class of bug, and the same route makes any wrong promise on
the site visible at once.

**Note:** what this route says about quotas must stay exactly what
`AiQuotaService` enforces. If a number changes, it changes in the constants,
and the route follows automatically.

---

## D16. How an activation code is generated

**Decided:** 2026-09-17
**Status:** decided, not built

- **Format:** `LQ-XXXX-XXXX` — the prefix `LQ`, then two groups of four, always
  uppercase. The dashes are part of the stored value.
- **Randomness:** a **cryptographic** source (`crypto.randomInt` /
  `randomBytes`), never `Math.random` (which the frontend fake uses and which
  is predictable from earlier values).
- **Alphabet, 30 characters:** digits `2–9` (8) and letters without the
  look-alikes `I`, `L`, `O` and `U` (22). Managers read codes aloud, write them
  on paper and send them on WhatsApp, so `LQ-0OI1-…` would mean support
  tickets. `U` is excluded as well (the Crockford base32 convention) so the
  alphabet is 30 characters and no random group can read as an offensive word.
- **Strength:** 30⁸ ≈ **656 billion** combinations. With the rate limit on
  redemption (T11), guessing a live code is not a realistic attack.
- **Uniqueness:** a unique index in the database. On the rare collision the
  backend generates another value and retries, so uniqueness comes from the
  index, never from a pre-check.
- **Storage:** **plain text**, uppercase (D1) — the manager has to see the code
  again on the Users page. A code is compared **case-insensitively** and after
  trimming when a student types it, and dashes may be typed or omitted.
- **Never reused:** a code value is created once and never regenerated for
  another seat, even after it is deactivated.

---

## D17. Redeeming a code, and access afterwards

**Decided:** 2026-09-17
**Status:** decided, not built

### `POST /api/auth/redeem-code` — done once

Student login required. Body `{ "code": "LQ-..." }` (uppercased, trimmed,
dashes optional — D16).

Checks, in this order:
1. the code exists;
2. it is `activated` — not already `connected`, not `deactivated`;
3. it has not expired;
4. the **center's subscription is active** (a blocked or lapsed center's codes
   do not work);
5. the student does **not already hold a valid code**.

Then, in **one conditional update** (the gate the current activation key
already uses), the code becomes `connected` with `connected_at`, the student's
name and email, and the student receives that code's **center** and **tier**.
Two students sending the same code at the same moment cannot both win: one
succeeds, the other gets `CODE_ALREADY_USED`.

Recorded: the redeeming **IP and time**, so a center redeeming a code itself
leaves a trace.

**Rate limit** per student and per IP (about 5 attempts / 15 minutes). Codes
are plain text (D1), so this route is the only place they could be guessed.

Errors: `CODE_INVALID`, `CODE_ALREADY_USED`, `CODE_DEACTIVATED`,
`CODE_EXPIRED`, `CENTER_NOT_ACTIVE`, `STUDENT_ALREADY_ACTIVE`.

### Two rules inside it

- **A student who already holds a valid code is refused**
  (`STUDENT_ALREADY_ACTIVE`) rather than switched to the new code. The usual
  cause is a mistake, and replacing would silently waste a paid seat. Moving a
  student to another code is the center's job (deactivate, then the student
  redeems the new one).
- **The center sees the student's name and email** on its Users page once the
  code is connected; it needs them to manage its students. The manager's
  follow-up note (T16) stays private to the center.

### After redemption: the student simply logs in

The code is redeemed **once**. From then on the student logs in normally
(email + password, or a refreshed session) and **the backend checks on every
request** that access still holds:

- the student's code is still `connected` (not deactivated by the center),
- it has not expired,
- the center's subscription is active (paid, in trial, or in grace).

If any of that fails, the content routes refuse with the agreed error (T20) and
the Flutter app shows the "enter your activation code" screen (D9). Nothing is
cached in the app and nothing is decided there: access is read from the
database on each request, which is how a center that stops paying loses access
the same day without any scheduled job (D2).

---

## D18. The manager's activation-code routes

**Decided:** 2026-09-17
**Status:** built (phase 9). `activate` was **removed in phase 9b** and replaced
by `reset` (D39)

### Routes

| Route | Purpose | Lock |
|---|---|---|
| `GET /api/centers/me/activation-codes?status=&planId=` | the list, newest first; `all` or absent means no filter. No `type` filter (D5) | no |
| `GET /api/centers/me/seats` | summary: seats bought and used per plan, and totals | no |
| `POST .../activation-codes/:id/activate` | `deactivated` -> `activated` | yes |
| `POST .../activation-codes/:id/deactivate` | `activated` or `connected` -> `deactivated` | yes |

All scoped to the caller's own center; a `centerId` is never accepted from the
client, and another center's code id answers 404, never 403.

**Lock = refused with `ACCOUNT_NOT_FINALIZED` (403) while the account is not
finalized (D2), and with `SUBSCRIPTION_INACTIVE` (403) while the center is
blocked for non-payment.** Reading the list and the seat summary is always
allowed.

### What a code shows

`id`, `code`, `status`, `planId`, the connected student's `linkedName`,
`linkedEmail` and `connectedAt`, `createdAt`, `expiresAt`.

### Rules

- **Deactivating a connected code:** the student loses access immediately (the
  per-request check in D17). The code **keeps the student's name and email
  visible**, so the manager can see who it was.
- **Activating again clears the link** (name, email, `connectedAt`), so the
  seat is free for a new student to redeem.
- **Any other transition is refused** with `INVALID_CODE_TRANSITION` (409).
  An action on a code **already in that state** returns the code unchanged, no
  error.
- **There is no route to create or delete a code by hand.** Codes exist only
  because a payment succeeded or a trial started, which is what keeps the
  number of codes and the number of paid seats in agreement.
- **Every action is logged** (which center user, when, which code, from which
  status to which). That log is also the count behind the "how many times may a
  code move to another student" rule (B11).

---

## D19. One error when a student has no access: `ACTIVATION_REQUIRED`

**Decided:** 2026-09-17
**Status:** decided, not built

Every learning-content route answers a student without valid access with one
error, **403**:

```json
{ "error": "ACTIVATION_REQUIRED", "reason": "NO_CODE", "message": "..." }
```

| `reason` | When | Flutter app message |
|---|---|---|
| `NO_CODE` | the student never redeemed a code | "Enter your activation code" |
| `CODE_DEACTIVATED` | the center deactivated the code (D18) | "Your school ended your access — contact your school" |
| `CODE_EXPIRED` | the code's date has passed | "Your access has expired — contact your school" |
| `CENTER_UNPAID` | trial over, or the center stopped paying (blocked) | "Your school's subscription has ended — contact your school" |

Rules:
- **One code, several reasons.** The app catches `ACTIVATION_REQUIRED`
  anywhere, sends the student to the activation screen (D9), and picks the
  message from `reason`. Four separate codes would mean four handlers in every
  repository.
- **Not the same as a quota refusal.** `AI_QUOTA_EXCEEDED` means "come back
  tomorrow" (D15) and must not send anyone to the activation screen.
- **New reasons may be added** later; the app falls back to the `NO_CODE`
  message for a reason it does not know, so a new reason never breaks an
  older app version.
- The `reason` is for wording only. Access itself is decided by the backend on
  every request (D17).

---

## D20. Removing the per-student activation keys, in three steps

**Decided:** 2026-09-17
**Status:** decided; **production checked 2026-09-18 — nothing to migrate**

> **Production result (2026-09-18, read-only transaction):** 0 pending keys,
> 0 activated students, 0 centers using keys, 0 students in any center,
> 0 centers in total, 13 students in total. Step 2 is therefore empty: the old
> path can be removed with nothing to migrate, and the trial cannot double-book
> a seat through it in production. All 13 students are independent, so the D34
> migration marks every one of them as grandfathered on release.

Activation codes (D1) replace the per-student key. The old flow creates a
student **with no password**, and the student sets one while redeeming the key
— so deleting it carelessly strands anyone holding an unredeemed key.

### Step 1 — build codes while the old flow still works

Codes, redemption and the manager routes (D16–D18) ship first. Nothing is
deleted. Both paths exist for one release.

### Step 2 — check production, then migrate

Read-only queries to run against production first:

```sql
-- 1. Students stranded if the key flow disappears (key issued, never redeemed)
SELECT COUNT(*) AS pending_keys
FROM students
WHERE activation_key_hash IS NOT NULL AND activated_at IS NULL;

-- 2. Students who already redeemed: they have a password and are safe,
--    but they hold a seat with no code behind it
SELECT COUNT(*) AS activated_students
FROM students
WHERE activated_at IS NOT NULL;

-- 3. Which centers used the flow at all
SELECT center_id, COUNT(*) AS students
FROM students
WHERE center_id IS NOT NULL
GROUP BY center_id
ORDER BY students DESC;
```

Then, depending on the numbers:
- **Pending keys:** the center is given a code to hand over instead, or the
  student gets a password-reset email so they can log in without the key.
- **Already-active students:** attached to an activation code, so seats and
  codes agree.
- **If the counts are zero**, there is nothing to migrate and step 3 follows
  immediately.

### Step 3 — delete the old path, separately

Routes (`POST /api/student-activations`, the center's
`POST/DELETE /students/:id/activation-key`), the service, DTOs, error codes
(`ACTIVATION_KEY_*`) and their tests, then the columns
(`activation_key_hash`, `activation_key_expires`) in a **separate migration**.

Dropping columns is destructive and **`main` deploys straight to production**,
so it never rides along with the feature that replaces it.

---

## D21. Students hold 1 active session

**Decided:** 2026-09-17 (2 devices); **changed 2026-09-18 to 1**, by the
backend dev and Herman
**Status:** built (phase 9b, 2026-09-19): `MAX_ACTIVE_STUDENT_DEVICES = 1`.
A new login removes as many older sessions as needed to get back to one, so a
student who signed in under the older, larger limit is brought down to one on
their next login.

A student account keeps **1 active session**. A **new login succeeds** and the
**previous session is revoked** — no "manage my devices" screen (D8).

The revoked device's **next request** gets a `401`, and the app logs out
locally. (The guard reports it as `INVALID_ACCESS_TOKEN`, not
`SESSION_REVOKED`; the app treats any 401 the same way.)

**The Valkey gap, fixed (phase 9b).** The student guard checks Valkey first and
reads the database only when Valkey has no answer. Valkey is **not deployed on
DigitalOcean**, so in production the guard always reads the database, finds the
evicted session gone, and the sign-out is already immediate. The gap existed
only with Valkey running: the guard trusted it, skipped the database, and
eviction marked nothing there — so an evicted device kept working until its
15-minute token expired. Eviction now also marks the evicted sessions revoked in
Valkey, after the transaction commits, so the rule holds whether Valkey is
running or not.

**Why 1:** it makes account sharing painful. Two students on one account keep
logging each other out, which is the deterrent. The AI quota, counted per
account (D15), still caps the cost of whatever sharing remains.

**Accepted cost:** a student who uses the app on both phone and web has to log
in again each time they switch.

Implementation: set `MAX_ACTIVE_STUDENT_DEVICES` to 1 and update its tests.
Center users keep their own rule (D13).

---

## D22. The school logo: resized in the browser, stored in Neon

**Decided:** 2026-09-17
**Status:** decided, **low priority** — built after the features that carry the
product (codes, account context, dashboard data)

### How it works

1. **The browser resizes** the chosen image to ~256 px and exports **WEBP**
   (canvas), turning a 500 KB photo into roughly **15 KB**.
2. It sends ordinary JSON to `POST /api/centers/me/logo`
   (`{ "logoBase64": "..." }`) — no multipart, no image library on the server.
3. **The backend validates anyway**, because the API is public and a browser
   can be bypassed: real file bytes (PNG / JPEG / WEBP magic numbers, not the
   name), and at most ~64 KB. Errors `LOGO_INVALID_TYPE`, `LOGO_TOO_LARGE`.
4. It stores the bytes on the center row in **Neon** and returns the logo
   **inside `GET /api/centers/me`** as a `data:` URI. At this size no separate
   image route is needed, so no image request ever wakes a suspended Neon
   compute.
5. `DELETE /api/centers/me/logo` clears it. Uploading again replaces the bytes.

### Why not the alternatives

- **DigitalOcean Spaces:** about $5/month for a few megabytes of logos; worth
  it only once there is real file volume (student recordings, our own audio).
- **Supabase Storage:** the old `SUPABASE_*` variables are dead leftovers and
  the account is gone.
- **Vercel Blob (frontend uploads, sends only the URL):** works, but puts the
  school's logo in a Vercel account and adds a provider that can break.
- **Keeping it in the browser (today's fake):** a manager who switches device
  loses the logo, and other users of the school never see it.
- **The app instance's disk:** App Platform wipes the filesystem on deploy.

### Size in practice

~15 KB per school; 1,000 schools is ~15 MB, which is noise for Neon storage and
backups. If uploads ever grow beyond logos, move the bytes to object storage —
the API (`{ logoUrl }` / inline data) does not change.

---

## D23. Changing a center password

**Decided:** 2026-09-17
**Status:** decided, not built

`POST /api/center-auth/change-password`, center login required, body
`{ "currentPassword", "newPassword" }`.

- **Wrong current password** → `WRONG_CURRENT_PASSWORD` (400), **rate-limited
  per center user**, so the route cannot be used to guess the password of an
  already-open session.
- **The new password follows the single rule (D10/T2):** at least 8 characters,
  1 uppercase, 1 digit, 1 special character, at most 72 UTF-8 bytes; otherwise
  `VALIDATION_ERROR` on the `password` field.
- **Every other device is logged out**, while the device that made the change
  keeps working (its session is rotated). Anyone who knew the old password
  loses their sessions — the same reasoning as password reset, which already
  revokes all sessions.
- **The "confirm password" field is checked in the browser only**; the API
  takes one new password.

The student equivalent already exists (`/api/auth/change-password`) and keeps
its behaviour, with the password rule aligned to D10.

---

## D24. The support contact form

**Decided:** 2026-09-17
**Status:** decided, not built

`POST /api/support/contact`, body `{ "name", "email", "message" }`
(message at least 10 characters after trimming).

- **Center login required.** The page lives inside the dashboard, so the center
  and manager are taken from the token: a message can never claim to come from
  another school. `name` and `email` are prefilled by the frontend and stored
  as sent, but the trusted identity is the token's.
- **Stored first** in a `SupportRequest` row (center, center user, name, email,
  message, created_at), so nothing is lost if the email fails.
- **Emailed** through the existing mailer (Resend) to the address in the
  **`SUPPORT_EMAIL`** environment variable, with **reply-to = the manager's
  email**, so a reply goes straight back to them.
  Value for now: **ngeukeualain@gmail.com** *(the address in this session's
  account — confirm the exact spelling before it goes in the environment)*.
- **An acknowledgement is emailed to the manager** ("we received your
  message"), which reassures them and leaves them a trace.
- **Rate-limited**, about 5 messages per hour per center.
- Returns `201 { "id": "..." }`. Validation failures return
  `VALIDATION_ERROR` naming the field.

The FAQ on that page is static translated text and needs no route.

---

## D25. No student follow-up notes

**Decided:** 2026-09-17
**Status:** decided — **removal from the frontend is a pending task**

The manager's per-student follow-up (status `ok` / `watching` / `contact` and a
free-text internal note) is **not part of the product**. No table, no route, no
UI.

**Why:** it is a feature nobody has asked for yet. Schools have not used the
dashboard at all, so there is no evidence managers would keep notes there. It
also means storing free text written **about a named student**, which brings a
privacy duty (especially for German schools) for a benefit nobody has proven.

If schools later ask "how do I know we already called this student?", it comes
back — cheaply, because the dashboard and its alerts (T17) will exist by then.

**Frontend removal covers:** `app/center/dashboard/students/[id]/page.tsx`,
`app/center/dashboard/page.tsx`, `components/center-dashboard/dashboard-ui.tsx`,
`lib/center-dashboard/fake/students.ts`, the `followUp*` keys in the `de`, `en`
and `fr` dictionaries, and the localStorage entries that stored the notes
(~64 references).

---

## D26. One `StudentActivity` table feeds every screen

**Decided:** 2026-09-17
**Status:** built in the backend (phase 11, 2026-09-19); the Flutter app does not send attempts yet

**As built:** `student_activities` holds one row per completed attempt: student,
skill (`HOEREN`/`LESEN`/`SPRACHBAUSTEINE`/`SCHREIBEN`/`SPRECHEN`), Teil, score,
max score (100 today), duration, Modelltest and the detailed attempt's id.
Written by one function (`recordActivity`), in the same transaction as the
detailed row: Hören, Sprachbausteine and Lesen at submit, Schreiben when its
correction finishes **with a real score** (the stub's 75 after a model failure
is not recorded), Sprechen when `evaluate` returns. Lesen gained
`lesen_attempts` and Sprechen gained `speaking_attempts`. Guests get no rows
(no student row). The migration backfilled the existing Hören, Sprachbausteine
and Schreiben attempts of real students, skipping the stub-scored writing.

### The problem

Results live in five different shapes today: `WritingAttempt`,
`ListeningAttempt`, `SprachbausteineAttempt`, the older Lesen tables
(`LesenSession` / `LesenResult`) and speaking in `ExamSession` /
`TeilEvaluation`. Worse, the Flutter app keeps Hören, Lesen, Sprachbausteine
and Sprechen attempts **on the device**, so the server never sees most results
and a center dashboard would show almost nothing.

### The decision

One table, **written by every submit**, holding the summary line every screen
reads:

| Column | Meaning |
|---|---|
| `student_id` | who |
| `skill` | `hoeren` / `lesen` / `sprachbausteine` / `schreiben` / `sprechen` |
| `teil` | which part, when the skill has parts |
| `score`, `max_score` | the result; percentage is derived, never stored |
| `duration_seconds` | how long it took |
| `created_at` | when (the fact behind streaks, "last 7 days" and "last active") |
| `attempt_id` + `attempt_table` | link to the detailed row |
| `modelltest_id` | which exam, when known |

- **The five detail tables stay as they are** and keep everything detailed:
  answers, corrections, audio, feedback.
- `StudentActivity` is only the summary, and it is the **single source** for:
  the center dashboard (progress, per-skill averages, sessions per day,
  alerts, recent activity), the Flutter app's **history** per module, and the
  app's **home screen** (D7: streak, weekly minutes, readiness, session of the
  day).
- Indexed on `(student_id, created_at)` and `(student_id, skill, created_at)`,
  which is exactly what those screens ask.

### Why not query the five tables each time

It needs no new table, but every screen then merges five different shapes, and
that merge has to be written again for each new screen, in two products, with
slower queries. One writer and one reader shape is less code and less drift.

### What it depends on

**The Flutter app must send its results to the server.** Hören, Lesen,
Sprachbausteine and Sprechen submit locally today (`useRemoteSubmit = false`
for Lesen and Sprachbausteine). Until that changes, the table stays nearly
empty and the center dashboard has nothing to show. That work is T24 and ships
with this.

Open, and decided with B10: how a **percentage of progress / readiness** is
computed from these rows.

---

## D27. Invoice numbers

**Decided:** 2026-09-17
**Status:** decided, not built

- **Format `INV-2027-0001`:** the year, then a counter that restarts each year,
  padded to 4 digits.
- **Assigned when a payment succeeds**, in the **same transaction** that grants
  the seats (`PaymentActivationService.activate`). A `PENDING`, `FAILED` or
  `EXPIRED` payment never gets a number, which is exactly why the billing page
  lists only paid ones.
- **Gap-free.** The counter comes from a small counter row taken **with a
  lock**, never from counting existing invoices — two payments succeeding at
  the same moment would otherwise take the same number. An unbroken sequence is
  an accounting requirement, not a preference.
- **Never changes.** A number stays even if the payment is refunded later; a
  refund is its own document.
- **One sequence for the whole company**, not per center, so a center reading
  `INV-2027-0042` learns nothing about our volume beyond that.

**Deliberately not decided here:** what an invoice must *contain* (legal
mentions, VAT, language) and the PDF. Those follow B5 (VAT, EUR) and the
subscription model (D4). The number is safe to fix now because it does not
depend on either.

---

## D28. Grammar: no daily goal for now; the route waits for content

**Decided:** 2026-09-17
**Status:** decided — **removal from the Flutter app is a pending task**

### What was found

- The contract exists:
  `telC_frontend/docs/api-grammar-contract.md` — one call
  `GET /api/grammar/exercise`, no query, `contentRevision`, `issuedAt`,
  `teil1.questions[]`, `teil2.questions[]`, every id a **numeric string**, the
  app scores itself.
- The app makes **no HTTP call**: `grammar_repository_impl.dart` returns
  `GrammarMockData`.
- **There are 10 questions in total** (5 per Teil), while the app's daily goal
  is **15 correct answers**
  (`grammar_progress_constants.dart: dailyCorrectAnswersGoal = 15`, used by
  `GrammarProgressCalculator.dailyGoalPercent` for the ring on the grammar
  card). The goal arrived with commit `6ceb3d5` as a constant, not as a product
  decision.
- **Teil 1 is vocabulary with French answers** ("der Alltag" → "la vie
  quotidienne"), which assumes a French-speaking student.

### Decided now

**The daily goal and its progress ring are removed from the Flutter app.**
Promising "15 correct answers today" on a bank of 10 questions is a promise the
product cannot keep. The grammar module itself stays, with its sample
questions.

### Decided later

- **The backend route** is built exactly to the contract **once a question bank
  exists**. Planned shape: grammar questions in tables like the other skills,
  the route returning a **daily set** that is stable for one student for one
  day, with `contentRevision` as that day's key, and per-payload numeric ids
  mapped from internal UUIDs.
- **The question bank itself is B18** (writer, reviewer, language, levels,
  size).
- A daily objective, if it comes back, is set **once for the whole app** with
  the home-screen definitions (D7), not separately for grammar.

---

## D29. Module history and progress: one pattern, server-owned, offline fallback

**Decided:** 2026-09-17
**Status:** backend built (phase 11, 2026-09-19); the Flutter app side (remote submit on, offline queue) is not done

**As built:** every module's `/sessions` item carries the shared fields
`attemptId`, `skill`, `teil`, `score`, `maxScore`, `status`
(`completed`/`pending`), `completedAt`, `durationSeconds`, `modelltestId`,
next to the fields it already had (none removed). Every `/teils` item carries
`attempts`, `bestScore`, `lastScore`, `lastAttemptAt`, `maxScore`, read from
`StudentActivity` — scoped to the Modelltest for Hören and Sprechen, whose
Teil list is per Modelltest. `evaluate` takes an optional `modelltestNumber`
(default 1, like every route). Lesen gained `GET /api/reading/sessions` and
`GET /api/reading/teils`. Speaking `/sessions` now reads the kept evaluations
(the old `exam_sessions` source was never scored). Every submit, and
`evaluate`, accepts an optional `attemptId` (UUID from the app): a repeat is
stored once and answered from the first copy; another student's id is
`409 ATTEMPT_ID_TAKEN`. A repeated `evaluate` costs no quota and no model call.

### Today

Hören, Lesen, Sprachbausteine and Sprechen keep attempts **on the device**
(`useRemoteSubmit = false` for Lesen and Sprachbausteine). A student who
reinstalls or changes phone loses everything, and the center dashboard sees
nothing. Only Schreiben reads its history from the server.

### Decided

**All four modules get the same treatment, in one pass, with one shape** — not
one module at a time. Building them separately is how five different attempt
tables came to exist.

1. **Remote submit is on** for every module. Each submit writes its detailed
   attempt row **and** a `StudentActivity` summary row (D26), in one
   transaction.
2. **`GET /api/{module}/sessions?teilNumber=`** returns the history from the
   server: `id`, `date`, `score`, `maxScore`, `feedback`, `durationSeconds`.
   The app already declares these routes and never calls them.
3. **`GET /api/{module}/teils`** returns the Teil list **with progress per
   Teil, computed by the backend**, so the app and the center dashboard show
   the same number — one formula, one place.
4. **The server is the source of truth.** The device no longer decides what a
   student's history is.

### Offline fallback (agreed)

The app keeps a **local copy**:
- **Reads:** if `/sessions` or `/teils` fails, the app shows the local copy
  rather than an empty screen, marked as possibly out of date.
- **Writes:** an attempt submitted with no connection is **queued locally and
  sent when the connection returns**, so a student in a school with poor
  internet never loses work.
- The server result **replaces** the local copy when it arrives; the local copy
  is a cache, never a second source.
- Duplicate protection: a queued submit carries a client-generated attempt id,
  so re-sending the same attempt cannot create two rows.

### Why one pattern

One backend service shape, one repository shape in the app, one place to fix a
bug, and the center dashboard reads a single table (D26) instead of five.

---

## D30. Newsletter: dropped, removed later

**Decided:** 2026-09-17
**Status:** decided — **removal is a later task, deliberately not now**

The newsletter is not part of the product.

- **Now:** nothing is done. The Flutter app is **not** wired to
  `POST /api/newsletter/subscribe`; its form keeps reporting success locally
  and sends nothing. The backend route stays in place, unused — removing it is
  not worth a production deploy on its own.
- **Later**, in a cleanup pass of its own: delete the route, the module, its
  DTOs, its rate limits and their tests, then the `newsletter_subscribers`
  table in a **separate migration** (dropping a table is destructive and `main`
  deploys to production).
- **Before dropping the table**, check whether it holds real subscribers; if it
  does, export them first. People who signed up may have to be told, or their
  data deleted, rather than silently dropped.
- The Flutter app's newsletter screen, route and translations are removed in
  the same pass.

---

## D31. The notification setting stays on the device

**Decided:** 2026-09-17
**Status:** decided, nothing to build

**The Flutter app has no push notifications.** Firebase is present for
**analytics only** (`firebase_analytics_adapter.dart`), and the code says as
much: `settings_preferences_provider.dart` — *"Device-level notifications
toggle (v1: local pref only, no push)"*. The switch writes a boolean to
`SharedPreferences` and nothing reads it.

So there is **no backend route and no column** for it. Storing a switch that
controls nothing would only move a dead setting to the server.

**When push notifications are really built** — a push service, device tokens,
permissions, a scheduler and a rule for *when* to send ("you have not practised
today") — the preference moves to the server then, because a reminder is sent
by the server and must know what the student wants on every device.

**Worth noting:** the switch is visible to students and promises something the
app does not do. Either it is hidden until push exists, or it is kept as a
harmless placeholder. Not decided here; raise it with the app's UI work.

**Separate question:** the **target level** in the same settings screen is not
this — the center sees it too, so it is decided with B10.

---

## D32. Speaking rooms get a real short code

**Decided:** 2026-09-17
**Status:** decided, not built

### The problem

Joining by room id (a UUID) goes through the real API. Joining by a
**6-character code** is served by `SpeakingPeerSessionMockStore`, an
**in-memory fake**: each app holds its own copy, so two students can never meet
through it. The path looks like a feature and cannot work.

Sharing a 36-character UUID out loud is not realistic either, and the feature
exists exactly for two students sitting in the same room.

### Decided

- **Remove** the short-code branch in `speaking_peer_repository_impl.dart` and
  `SpeakingPeerSessionMockStore`. `SpeakingPeerSocketClientMock` stays; tests
  use it.
- **The backend gives each room a real short code**, stored on the room and
  expiring with it (rooms are short-lived already).
  - 6 characters from the D16 alphabet (no look-alikes), so it can be read
    aloud and typed.
  - Unique **among live rooms only**, not for all time — the space is small, so
    a code is reused once its room is gone.
  - Returned by room creation next to `roomId` and `hostToken`.
- **Joining:** `GET /api/speaking/rooms/code/{code}` resolves a code to a room
  (404 when unknown or expired), then the existing `GET /rooms/{id}` and the
  `join-room` socket event run unchanged. Case-insensitive, trimmed.
- **Leaving** uses the `leave-room` socket event, not the mock store.
- **Rate-limited** per student: a short code is guessable by design, and the
  only thing behind it is a practice room, but a flood of guesses should not be
  free.

---

## D33. How this work ships

**Decided:** 2026-09-17
**Status:** decided, applies to every phase

- **Additive migrations only.** Add tables and columns; drop nothing until the
  frontends have moved over **and** production data has been checked — the old
  activation keys (D20) and the newsletter (D30) both follow that rule.
- **A destructive migration is its own commit**, never carried along with the
  feature that replaces it.
- **Small phases, each shippable alone**, in order:
  1. account context (D2, D11, D14, D15) + center change-password (D23);
  2. activation codes and the trial (D1, D3, D16–D19);
  3. Flutter access and module history (D9, D17, D26, D29);
  4. center dashboard data;
  5. the rest (logo D22, support D24, invoices D27, speaking room D32).
  Anything that depends on **D4** (decided 2026-09-18: M3) follows its rules.
- **`main` deploys to production**, so every merge is a release. `dev` is
  blocked on center auth, which is why urgent fixes are cherry-picked onto
  `main`.
- **Migrations never run against production from a laptop.** This repo's `.env`
  points at the production Neon branch (`wandering-hall`), so a bare
  `prisma migrate` would hit real data. Local work and tests use `.env.test`
  against a disposable Neon branch (`docs/BRANCHING.md`).
- **Each phase gets a plan file in `tasks/phases`**, which is gitignored — new
  plan files need `git add -f`.

---

## D34. Students already using the app keep access; new accounts need a code

**Decided:** 2026-09-18
**Status:** decided, built in phase 9

D9 says an account alone gives no access. Applied literally, every student who
registered in the Flutter app on their own before schools existed would be
locked out on release day. So:

- **Accounts that exist without a school when this ships keep their access.**
  A migration marks exactly those rows (`grandfathered_access`), at the moment
  it runs. On production that moment is the release: no date to configure, and
  no account created later can fall under it.
- **Every account created after that needs a code** (D9, D17).
- **Students a school released or deactivated are refused**, even if they
  predate the rule. The mark is only honoured with no tier, and a tier means a
  school once governed them.
- **Guest tokens are unchanged** until B16 (guest mode) is decided.

A refused student gets `ACTIVATION_REQUIRED` (D19) with the reason: `NO_CODE`,
`CODE_DEACTIVATED`, `CODE_EXPIRED` or `CENTER_UNPAID`. This replaces
`SUBSCRIPTION_INACTIVE` on student learning routes; center routes keep it.

---

## D35. Payment providers: Stripe on mobile, Notch Pay and Stripe on the web

**Decided:** 2026-09-18, by the backend dev and Herman (settles B6)
**Status:** decided, not built

| Where the payment starts | Providers |
|---|---|
| Mobile (Flutter app) | **Stripe** |
| Web | **Notch Pay** (Orange Money, MTN Mobile Money) **and Stripe** (card) |

**Who pays:** both kinds of paying client, on the web or on mobile. The
provider depends only on where the payment starts, not on who pays.

- **Center** — a school buys a pack of seats (D4); its students get access
  through codes and never pay.
- **Independent user** — a learner with no center who pays their own
  subscription.

**Not yet defined:** the independent user's subscription (B19). Today only
centers can pay; an account with no center gets access only if it predates
the code rule (D34).

- The backend already has a provider abstraction (`fake`, `disabled`, Notch
  Pay pending). Stripe is added as a second real provider beside Notch Pay,
  not instead of it.
- A payment records which provider took it, so webhooks, refunds and
  invoices (D27) are routed to the right one.

---

## D36. No referral codes

**Decided:** 2026-09-18, by the backend dev and Herman (settles B7)
**Status:** decided — frontend removal to do

- No referral, discount, referrer reward or agent commission.
- The "referral code" field is **removed from the payment step** (center
  dashboard, and any independent-user payment screen).
- The backend never had it: no field, no table, no `INVALID_REFERRAL_CODE`.
- Revisit only as a new decision if agents or partners start bringing schools.

---

## D38. Level, skill scores and exam readiness ("progress")

**Decided:** 2026-09-18, by the backend dev and Herman (settles B10)
**Status:** decided, not built — D26 and D29 are built in the backend (phase 11); this is next

### Prerequisite: the data must reach the server

Today Hören, Lesen, Sprachbausteine and Sprechen attempts live **only on the
phone**. Nothing below can feed the center dashboard until **D26**
(`StudentActivity`) and **D29** (remote submit for every module) are built.
They come first.

### One calculation, in the backend

Every number below is computed **once, in the backend, from
`StudentActivity`**. The center dashboard and the Flutter app read the same
result; neither computes it. This replaces the fake values in the dashboard
(`fake/students.ts`) and the on-device calculation in the app
(`averageLatestTeilProgress`, `readinessScore: 0`).

### 1. Skill score (0–100), per student and per skill

For each of the five skills (`hoeren`, `lesen`, `sprachbausteine`,
`schreiben`, `sprechen`):

1. **Teil score** = the average of the student's **3 most recent attempts** on
   that Teil (fewer if they have fewer), each as `score ÷ max_score × 100`.
   Three rather than one, so a single lucky or unlucky attempt does not swing
   the number.
2. **Skill score** = the average of the skill's Teil scores.
3. A Teil **never attempted counts 0** in the calculation, but the interface
   shows **"not practised yet"**, never "0 %". A skill with no attempt at all
   is returned as `null`.

These are the five skill bars in the app and on the student detail page.

### 2. Readiness score (0–100) — this is "progress"

It mirrors telc scoring. The exam has a **written part** and an **oral
part**, and a candidate passes only with **at least 60 % in each**.

```
written   = weighted average of Lesen, Sprachbausteine, Hören, Schreiben
oral      = Sprechen
readiness = weighted average of written and oral, by the exam's points
ready     = written ≥ 60 AND oral ≥ 60
```

- **Weights:** the official telc B1+ Beruf points per part. Until they are
  entered from the official grid, the four written skills weigh equally and
  written/oral follow the exam's total points split.
- **Agreed 2026-09-19 with Herman:** build now with provisional weights, kept
  as constants in one place so the official grid replaces them without any
  other change. Provisional: the four written skills **equal**; written/oral
  **75 / 25**, the telc Deutsch B1 split (225 / 75 points) — to be checked
  against the B1+ Beruf grid. The pass rule (each part ≥ 60) does not depend
  on the weights.
- **Skills never practised count 0** here (option C): a student who skips
  speaking is not ready, and the number must say so.
- **Not enough data:** under **5 attempts** in total, readiness is returned as
  `null` and shown as **"not enough exercises yet"** instead of a misleading
  number.
- **One number everywhere:** it is the app's readiness (the "62" in the
  design, D7) **and** the dashboard's "Progress %". Shown as an **estimate**
  ("estimated readiness"), never as a promise of passing.
- `ready` is returned beside the score, so both products can show a "ready for
  the exam" badge.

### 3. Everything else derives from the same calculation

| Shown | Calculation |
|---|---|
| **Average progress** (center dashboard KPI) | average readiness of the center's connected students that have a readiness (not `null`) |
| **Weekly change** (app) | readiness today − readiness computed on the activity up to 7 days ago |
| **Per-skill averages** (center dashboard) | average of each skill score across the center's students that practised it |
| Alert **"inactive"** | no `StudentActivity` row for **7 days** |
| Alert **"low progress"** | readiness **< 40** |
| Alert **"weak skill"** | a skill **already practised** with a score **< 45** |

The thresholds (7 days, 40, 45) are the ones the dashboard already uses. The
"attempts below threshold" count in the app stays at **60 %** (D7).

### 4. Level and target level

- **Current level** (A1–B2): **declared by the student** at sign-up and
  **editable by the center**. Stored on the student.
- **Target level:** the product prepares **one exam, telc B1+ Beruf**, so there
  is **no per-student target field**. The dashboard shows "B1+ Beruf" as a
  fixed label. It becomes a real field only if other exams are added.

### Build order

1. D26 `StudentActivity` + D29 remote submit for all modules.
2. This calculation as one backend service, with tests on the formula.
3. Center dashboard routes (progress, skills, alerts) and the app's home
   screen read it.

---

## D39. Resetting an activation code (moving a seat to another student)

**Decided:** 2026-09-18, by the backend dev and Herman (settles B11)
**Status:** reset and limit **built (phase 9b, 2026-09-19)**; the data erase is
**not built** — it needs `StudentActivity` and the module history (D26, D29)
and follows phase 11. As built: a reset is counted by the event's
`previous_code` being filled; a code is "used" when there is a `CONNECTED`
event since its last reset; redemption also claims by value, so a reset in
flight cannot hand the seat to someone typing the old value. `activate` is
removed

### Why a reset, not "deactivate then activate"

Today a seat moves by `deactivate` then `activate` (D18). `activate` puts the
**same code value** back in the pool. The previous student still knows that
value, so **they can redeem it again** before the new student does. A reset
fixes this: the seat gets a **new value**, and the old one stops existing.

### The route

`POST /api/centers/me/activation-codes/:id/reset` — center login, same lock
as D18 (`ACCOUNT_NOT_FINALIZED`, `SUBSCRIPTION_INACTIVE`), own center only
(another center's code → 404).

### What the backend does, in one transaction

1. **Checks whether the code was used** — it has, or had, a student since it
   was created or last reset.
2. **If a student is connected:** disconnects them. Their access ends at once
   (`center_id` cleared, tier kept — exactly as deactivation does), and
   redeeming a new code later works (D17).
3. **Clears the seat's link:** `student_id`, `linked_name`, `linked_email`,
   `connected_at`, `connected_ip`.
4. **Generates a new code value** (D16) **on the same row**: same seat, same
   plan, same `expires_at`. The old value is no longer valid; typing it
   answers `CODE_INVALID`. Keeping the row means the number of codes still
   equals the number of paid seats (D18).
5. **Status becomes `ACTIVATED`**: the seat waits for its new student.
6. **Logs the reset** in `ActivationCodeEvent`: which manager, when, the
   **old value**, and the student who was cut off.
7. **Marks the previous student's learning data on this seat for deletion**:
   hidden at once, erased 7 days later (see below).

### The previous student's data is erased

A reset gives the seat to someone new, and **the previous student's learning
data on that seat is permanently erased**. Decided by the backend dev and
Herman: resetting a seat means losing what was done on it.

- **Hidden at once, erased after 7 days.** At the reset (step 7) the data is
  marked for deletion and disappears from every screen — the center, the new
  student and the previous student see nothing of it. A daily job erases it
  **permanently 7 days later**. Until then support can restore it if the
  manager reset the wrong code. After that there is no undo.
- **What is erased:** the previous student's learning data
  **since they connected to this seat** (`connected_at`): `StudentActivity`
  rows and the detailed attempt rows behind them (writing, listening,
  Sprachbausteine, Lesen, speaking sessions and evaluations), with their
  stored files (audio).
- **Kept:** the student's **account** (email, password, name), so they can log
  in and redeem another code if a center pays for one. They start again from
  zero.
- **Kept:** any learning data from **before** they connected to this seat (for
  example as an independent user): it was not done on this school's seat.
- **Kept:** the event log line (manager, time, old code value, student id), so
  the reset itself stays traceable.
- **No undo for the manager.** The confirmation says so in plain words: "Amina
  will lose access and all her progress on this seat will be permanently
  deleted." The 7-day window is for support, not a button.

### The limit

Without a limit, one paid seat serves a whole class in turn. Decided:

- **2 resets of a used code per seat per billing period** (anchor day to anchor
  day, D4). A code that was **never used** can be reset freely (a leaked or
  mistyped code costs nothing).
- **Trial code:** 1 reset during the trial.
- Over the limit: `409 CODE_RESET_LIMIT_REACHED`, with `resetsAvailableAt` =
  the next renewal date.
- Counted from the event log, so no counter can drift.
- **Known edge, accepted:** if the wrong person redeems a code first, the reset
  that fixes it counts against the limit. Rare; support handles it by hand.
- The billing period comes from D4's anchor day, which is not built yet. Until
  it is, the period is the month ending at `paid_until`.

Common practice: Microsoft volume licences may be reassigned only once every
90 days (except hardware failure), for the same reason — a licence is for one
person, not a rota.

### Effect on the existing routes

- `deactivate` stays: taking a seat back without handing it on (a student who
  left, a student who stopped paying the school).
- `activate` (`deactivated` → `activated`, same value) is **replaced by
  reset**, so a seat is never handed on with a value someone else knows.

### Frontend (reset)

A **"Reset"** button per code, with a confirmation naming the student who will
lose access, stating that **their progress on this seat is permanently
deleted**, and showing the resets left until the renewal date.

---

## D40. Speaking phrases: AI-drafted, teacher-reviewed, served by the backend

**Decided:** 2026-09-18, by the backend dev and Herman (settles B13)
**Status:** decided, not built

In the Flutter app a phrase is a German sentence, its translation and a type
(e.g. giving an opinion, agreeing, disagreeing, asking back).

- **Source:** drafted with AI from the telc B1+ Beruf speaking tasks (the
  Modelltest themes), grouped by type and by Teil.
- **Review:** **every phrase is checked by a German teacher** before it goes
  live. A wrong phrase taught as correct costs trust.
- **Size for the first release:** 20–30 phrases per type.
- **Storage:** in the backend, served to the app, so a phrase can be fixed
  without releasing a new app version. Only reviewed phrases are served. After it, the
new code is shown to hand out.

---

## D37. Deleting a center account is a request, not a deletion

**Decided:** 2026-09-18, by the backend dev and Herman (settles B8)
**Status:** decided, not built

The "delete my account" button **deletes nothing**. It sends a request to the
Lerniqo team, who contact the manager to understand the problem and then
handle the deletion by hand.

- **Backend:** one route, center login required. It emails the team (same
  inbox as support, `SUPPORT_EMAIL`, D24) with the center's name, the
  manager's name, email and phone, and that they ask for the account **and all
  its information** to be deleted. Rate-limited, so one click cannot flood the
  inbox. The account, seats, codes, students and payments stay exactly as they
  are.
- **Confirmation to the manager:** the same route also emails the manager
  that the request was received and that an administrator will contact them
  about deleting the account.
- **Frontend:** after the click, the manager sees a message that an
  administrator will contact them about deleting the account.
- **Paid seats, refunds, connected students:** decided case by case when the
  team talks to the manager; nothing is automatic.

---

# Question register

Every open question for syncing the backend with the center dashboard and the
Flutter app. Answered questions move up into a D-entry above and are ticked
here.

## A. Backend dev decides alone (technical)

### Center dashboard contracts
- [x] **T1** Register body → **already done in the backend** (commit `3000ba2`, five fields, unknown fields refused). **Frontend still to fix:** `centerRegister()` in `src/lib/center-auth/api.ts` sends hard-coded `country: "CM"`, `city: "Douala"`, `phone: "+237000000000"` (from `RegisterView.tsx`), which the backend rejects with `400 VALIDATION_ERROR`.
- [x] **T2** Password rule → **one rule everywhere, matching the landing page: at least 8 characters, at least 1 uppercase letter, 1 digit and 1 special character, at most 72 UTF-8 bytes.** Applies to centers and students (landing page, center dashboard, Flutter app, backend) whenever a password is **set**: register, reset, change password, and a student setting a password. **Never checked at login**, so existing accounts with older passwords keep working. Error: `400 VALIDATION_ERROR` (field `password`). Today the backend only checks ≥8 (centers ≤72 bytes; students `MIN_STUDENT_PASSWORD_LENGTH = 8`) and the landing page register asks ≥6 + complexity, settings ≥8 — all three move to this rule.
- [x] **T3** Error codes → **the backend's codes are the reference**; frontends branch on `error`, never on the HTTP status (except 401 for refresh and 429). Reference list in D10.
- [→] **T4** Payment flow shape → **moved to group B as B17** (Herman owns Notch Pay and the payment flow).
- [x] **T5** Profile updates → **split into two routes** (school vs manager), see D11.
- [x] **T6** Onboarding draft → **stays in the browser**, see D12.
- [x] **T7** 4th center device → **logs out the least recently used one** (current behaviour kept), see D13.
- [x] **T8** Locations → **country list + searchable city with an "other" fallback, region derived, constants in code**, see D14.
- [x] **T9** `GET /api/plans` → **built from the backend's constants; the frontend keeps only names and descriptions**, see D15.

### Activation codes (technical side of D1)
- [x] **T10** Code generation → **crypto-random `LQ-XXXX-XXXX` over a 30-character alphabet, unique index, stored uppercase in plain text**, see D16.
- [x] **T11** Redeeming a code → **`POST /api/auth/redeem-code`, redeemed once, then checked on every request**, see D17.
- [x] **T12** Manager code routes → **list, seat summary, activate, deactivate; no manual create or delete**, see D18.
- [x] **T20** Access ended → **one error `ACTIVATION_REQUIRED` (403) carrying a `reason`**, see D19.
- [x] **T21** Per-student keys → **removed in three steps**, see D20. Production checked 2026-09-18: nothing uses them.
- [x] **T22** Student devices → **2 active devices; a 3rd login revokes the least recently used**, see D21.

### Settings, support, dashboard data
- [x] **T13** Logo → **browser resizes, backend validates and stores the bytes in Neon, returned inline**; low priority, see D22.
- [x] **T14** Center change-password → **`POST /api/center-auth/change-password`, other devices logged out**, see D23.
- [x] **T15** Support contact → **stored, emailed to `SUPPORT_EMAIL`, acknowledged, rate-limited**, see D24.
- [x] **T16** Student follow-up → **dropped from the product**; removed from the frontend too, see D25.
- [x] **T17** Dashboard data → **one `StudentActivity` summary table written by every submit**, see D26.
- [x] **T18** Invoice numbers → **`INV-YYYY-NNNN`, gap-free, assigned when a payment succeeds**, see D27.

### Flutter app (technical)
- [x] **T23** Grammar → **daily goal and progress ring removed from the app now** (no content yet); the route follows `api-grammar-contract.md` once a question bank exists (B18), see D28.
- [x] **T24** Module history and progress → **one pattern for all four modules, server is the source, device keeps an offline fallback**, see D29.
- [x] **T25** Newsletter → **dropped; the Flutter app is NOT wired to it, and the backend route is removed later**, see D30.
- [x] **T26** Notification setting → **stays on the device**; the app has no push at all, see D31.
- [x] **T27** Speaking room → **the fake short code is removed and replaced by a real backend short code**, see D32.

### Shipping
- [x] **T19** Shipping → **additive migrations, small phases, destructive changes separate and checked first**, see D33.

## B. Backend dev + Herman, co-founder (business / product)

All open items here need a joint decision by the backend dev and Herman.

- [x] **D4** Subscription model → **School Pack (M3)**: one renewal date per school, at least 10 seats, pro rata for seats added mid-period, all codes end together (D4). Decided 2026-09-18.
- [x] **B1** 10-seat minimum after a 1-seat trial → **kept** (D4). Decided 2026-09-18.
- [ ] **B2** Minimum charge for small pro rata payments — **owner: Herman** (needs Notch Pay's fees and minimum amount). Calculation proposed in D4.
- [x] **B3** 4,500 XAF per Start seat → **kept**. Decided 2026-09-18.
- [x] **B4** AI quotas → **per rolling 24 hours, as the backend already enforces**: Start 2, Pro 5, Premium 20 (D15). The landing page's "5 total / 20 total" wording is wrong and must change. Whether the *numbers* stay is revisited with B3 (AI cost per session).
- [x] **B5** VAT / EUR → **dropped for now**: prices as listed, in XAF. Revisit only when German schools are sold to. Decided 2026-09-18.
- [x] **B6** Card payments → **mobile: Stripe; web: Notch Pay and Stripe** (D35). Decided 2026-09-18.
- [x] **B7** Referral codes → **not done; the field is removed from the payment step** (D36). Decided 2026-09-18.
- [x] **B8** Account deletion → **a request emailed to the team, who contact the manager; nothing is deleted automatically** (D37). Decided 2026-09-18.
- [x] **B9** `public` codes → **not done at all, only personal codes** (D5)
- [x] **B10** Level, target level, progress → **level declared by the student, editable by the center; no target field (one exam); progress = exam readiness computed in the backend from `StudentActivity`** (D38). Decided 2026-09-18.
- [x] **B11** Code reuse → **a reset gives the seat a new code value, disconnects the old student and erases their learning data on that seat; their account is kept** (D39). Limit: 2 resets of a used code per seat per billing period, 1 for the trial code.
- [x] **B12** Trial abuse → **accepted as is**: 14 days, 1 Start seat (D6)
- [x] **B13** Speaking phrases → **AI-drafted from the telc B1+ Beruf speaking tasks, every phrase reviewed by a German teacher, 20–30 per type, served by the backend** (D40). Decided 2026-09-18.
- [x] **B14** Flutter app home screen → **definitions agreed, refined at implementation** (D7)
- [x] **B15** → **Google sign-in removed (code to delete); devices screen set aside** (D8)
- [x] **B16** Guest mode (`POST /api/auth/guest`) → **kept for the demo phase**; revisited when the demo phase ends. Decided 2026-09-18.
- [ ] **B19** Independent user subscription (D35): price **4,800 XAF** (decided 2026-09-18). **Not built now — centers come first.** Still to define when it is picked up: plans, monthly/annual, trial, grace, what happens if they later join a center, and Apple/Google in-app billing vs Stripe in the Flutter app.
- [ ] **B17** **Payment flow shape: two backend steps, or one frontend-style call?** — **owner: Herman** *(moved from T4 — Herman owns Notch Pay and the payment flow)*

  **What exists in the backend today (built and tested, phases 6 and 7a):**
  1. `POST /api/payments` — center login required, header `Idempotency-Key`
     (a unique value the frontend creates per purchase attempt, e.g. a UUID).
     Body: seats per tier `{ start?, pro?, premium? }` — **no price**; the
     server computes the amount. Creates a `PENDING` payment and returns its
     id, lines (seats × unit price per tier), total and status. It grants
     nothing. Retrying with the same key returns the same payment (a double
     click never creates two); the same key with different seats is refused
     (`IDEMPOTENCY_KEY_REUSED`, 409). Refused with `CENTER_PROFILE_INCOMPLETE`
     (403, `missing[]`) if country, city or phone are missing. Rate-limited per
     center.
  2. `POST /api/payments/:paymentId/checkout` — opens the checkout with the
     payment provider the first time and returns `{ paymentId, checkoutUrl }`;
     every later call returns the same URL, so no second provider transaction
     is opened. Only a `PENDING` payment (`PAYMENT_NOT_PENDING`, 409 otherwise).
     `PAYMENT_PROVIDER_NOT_CONFIGURED` (503) when no provider is set.
  3. The frontend sends the manager to `checkoutUrl` (Notch Pay page: Orange
     Money, MTN, card).
  4. `POST /api/webhooks/payments` — called **by the provider only**. The
     signature is checked on the raw body; a verified success runs
     `PaymentActivationService.activate`, which marks the payment `SUCCEEDED`
     and grants seats **exactly once** (duplicates change nothing). A failure
     marks it `FAILED`. Unknown reference → 404 so the provider retries.
  5. `GET /api/payments/:paymentId` — the frontend polls the status
     (`PENDING` → `SUCCEEDED` / `FAILED` / `EXPIRED`) after the manager comes
     back from the checkout page. `GET /api/centers/me/payments` lists history.

  Providers today: `fake` (tests/dev) and `disabled` (default). The Notch Pay
  provider is the pending Phase 7 work (`docs/NOTCHPAY-GUIDE-FOR-HERMAN.md`,
  `tasks/phases/07-notchpay-handover.md`).

  **What the frontend spec expects:** one call
  `POST /api/centers/me/subscription` with `{ seatMix, billingPeriod,
  paymentMethod, referralCode?, phone? }` (`referralCode` is dropped, D36), returning `{ paymentId, status,
  amountXaf, next: { type: "mobile_money_prompt" | "redirect", redirectUrl } }`.

  **Options:**
  - **A. Keep the two backend steps; the frontend adapts.** Nothing to build
    in the backend for the shape. Safe against double charges by design.
    The frontend makes two calls and generates the idempotency key.
  - **B. Add the single route**, which calls step 1 and step 2 internally and
    returns the frontend's shape. Simpler for the frontend; one more route to
    keep in sync, and the idempotency key still has to come from the client.
  - **C. Direct Mobile Money prompt (USSD push) instead of a redirect page**
    (`next.type = "mobile_money_prompt"`): the manager enters a phone number
    and approves on the phone, without leaving the dashboard. Depends on what
    Notch Pay supports and adds a `phone` field and a "waiting for approval"
    screen. Can be combined with A or B.

  **Decided elsewhere, not part of this question:** seat content, renewal, pro
  rata, billing period (D4); card provider (B6, D35); referral codes (B7, D36: none);
  `paymentMethod` being stored on the payment follows from B6.

  **Recommendation (backend dev):** A, and C only if Notch Pay's direct push is
  reliable in Cameroon — to be checked by Herman.

---

# Priority order (2026-09-17)

Everything still to do, most critical first. "Blocked by" names what must be
answered or built before it can start.

## P0 — nothing works or earns without these

| # | Item | Why it is first | Blocked by |
|---|---|---|---|
| 1 | ~~**D4 subscription model** (you + Herman)~~ **decided 2026-09-18: M3** | Renewal, adding seats, code expiry and invoice amounts are now built on D4's rules | — |
| 2 | **B3 AI cost per speaking session** | Decides whether 4,500 XAF per seat earns or loses money. It can change D4's prices | — |
| 3 | **Phase 1 backend: account context** — `/me` shape (D2), locations (D14), plans (D15), split profile routes (D11), center change-password (D23) | The dashboard cannot leave fake mode without it, and it needs no business answer | — |
| 4 | **Phase 2: activation codes + trial** (D1, D3, D16–D19) | The core mechanic: without codes a school has nothing to give its students. Trial codes do not wait on D4; paid codes do | partly D4 |
| 5 | **Flutter: redeem screen + access errors** (D9, D17, D19) | Students cannot get access at all until this exists | 4 |
| 6 | **Notch Pay + payment flow** (B17, Herman) | Nothing can be sold until money can be taken | D4, B6 |

## P1 — the product is usable but not convincing without these

| # | Item | Why | Blocked by |
|---|---|---|---|
| 7 | **`StudentActivity` + remote submit for all modules** (D26, D29) | Without it the school dashboard is empty and students lose history on reinstall | — |
| 8 | ~~**B10 progress / readiness formula**~~ **decided: D38** | The number the school and the student both see | — |
| 9 | **Center dashboard data routes** (numbers, per-skill scores, sessions, alerts) | What a manager opens every day; the reason a school renews | 7, 8 |
| 10 | **Landing page: error codes, token refresh, real logout** (D10 prompt) | Without it the dashboard breaks the moment fake mode is off | 3 |
| 11 | **Landing page: pages off fake data** | Every page still reads localStorage even in real mode | 3, 4, 10 |
| 12 | **Remove Google sign-in** (D8) and **the old per-student keys** (D20) | Dead paths around authentication; each needs a production check before its table is dropped | 4 |

## P2 — real work, but nobody is blocked

| # | Item | Blocked by |
|---|---|---|
| 13 | Billing page and invoices (D27) + **B5** VAT / EUR | D4, 6 |
| 14 | ~~**B6** card provider~~ (D35), ~~**B7** referral~~ (D36), ~~**B8** account deletion~~ (D37) | — |
| 15 | **B1** 10-seat minimum, **B2** minimum charge, **B11** code moves per period | D4, B3 |
| 16 | Support form (D24) | 3 |
| 17 | School logo (D22) | 3 |
| 18 | Speaking room real short code (D32) | — |
| 19 | the grammar route (D28), **B13** speaking phrases | content, not code |
| 20 | **B16** guest mode, newsletter removal (D30), the dead notification switch (D31) | — |

**Rule of thumb:** P0 decides whether the business works, P1 decides whether
schools stay, P2 decides how polished it looks.

---

# Build order of the group A decisions (2026-09-17)

The technical decisions are all made; this is the order to build them in, most
critical first. "Cost" is rough implementation size, not calendar time.

## Tier 1 — critical: nothing can be tested or sold until these are done

| # | Item | Why critical | Cost |
|---|---|---|---|
| 1 | **T1** frontend register fix (D-none, commit `3000ba2`) | Register **fails with 400** against the real API today, so nothing on the dashboard can be tested outside fake mode. One file | tiny |
| 2 | **T3** error codes + token refresh + real logout (D10) | Every other integration depends on the error shape, and an expired token currently fails silently. Every prompt after this references it | small |
| 3 | **T5** split profile routes (D11) + **T8** locations (D14) + **T9** plans (D15) | The onboarding wizard writes through these, and nothing can be finalized — therefore nothing can be paid — without them | medium |
| 4 | **T10** code generation (D16) → **T11** redeem (D17) → **T12** manager routes (D18) → **T20** access error (D19) | The core mechanic. Codes are what a school buys and what a student uses; in this exact order, since each needs the one before | large |
| 5 | **T2** password rule (D10/T2) | Touches the backend, the landing page and the Flutter app; do it while auth is already open, not later | small |
| 6 | **T22** student device limit (D21) | Same files as T2 and T11; cheap now, a separate release later | tiny |

## Tier 2 — high: the product works but shows nothing useful

| # | Item | Why | Cost |
|---|---|---|---|
| 7 | **T17** `StudentActivity` (D26) + **T24** module history and progress (D29) | The single biggest piece of work, and the only way the center dashboard and the app's history show anything real. Needs the **B10** formula before numbers can be displayed | large |
| 8 | **T21** remove the per-student keys (D20) | Two ways in to the product is a security surface and a support problem. Needs the production check first | medium |

## Tier 3 — medium: needed to look finished

| # | Item | Notes | Cost |
|---|---|---|---|
| 9 | **T14** center change-password (D23) | Settings page is incomplete without it | small |
| 10 | **T18** invoice numbers (D27) | Ships with the payment work; waits on **D4** | small |
| 11 | **T15** support form (D24) | First real support channel for schools | small |
| 12 | **T27** speaking room short code (D32) | Replaces a broken fake path | medium |

## Tier 4 — low: cleanups and polish, any time

| # | Item | Notes | Cost |
|---|---|---|---|
| 13 | **T16** remove follow-up from the frontend (D25) | Prompt ready; removes dead UI | tiny |
| 14 | **T23** remove the grammar goal (D28) | Prompt ready; stops a promise the app cannot keep | tiny |
| 15 | **T13** school logo (D22) | Explicitly low priority | small |
| 16 | **T25** newsletter removal (D30) | Deliberately later, with a production check | small |
| 17 | **T26** notification switch (D31) | Nothing to build; revisit if push is ever added | none |

## Always on

- **T19 shipping rules (D33)** — additive migrations, small phases, destructive
  changes separate and checked. Not a task: it applies to every item above.
- **T4 → B17** — the payment flow shape belongs to Herman.

### Quick wins worth doing first

Items 1, 13 and 14 are tiny, already have prompts written, and each removes a
broken or misleading behaviour. They can ship before the big work starts.
