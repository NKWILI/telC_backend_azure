# Center dashboard — sync with the backend

**For:** the coding agent or developer working in the center dashboard
(`lerniqo-landing-page/sprach`, Next.js).
**Backend state:** branch `dev` of `telC_backend_azure`, 2026-09-19.
**Source of every rule below:** `docs/CENTER_FRONTEND_SYNC_DECISIONS.md` in the
backend repo (the D- and T-numbers refer to it).

The backend is finished for everything below except payments. Your job is to
make the dashboard use the real API, remove what the product dropped, and keep
fake mode working only as a development aid.

Do the tasks in order: each one is used by the ones after it.

---

## 0. Rules that apply to every task

**Exact shapes: Swagger.** The backend serves its API reference at
`/api-docs` (JSON at `/api-docs-json`). This prompt says what each page must
do; for the exact request and response fields, check Swagger on the backend
you are running against. If the two disagree, Swagger is right — tell the
backend team.

**Error shape.** Every center route answers an error as

```json
{ "error": "CODE_IN_CAPITALS", "message": "Human text", "...extra": "fields" }
```

- Branch on `error`, never on the HTTP status or on `message` (T3). The only
  statuses worth reading are 401 (token) and 429 (slow down).
- `VALIDATION_ERROR` carries `message` as an **array** of strings, each starting
  with the field name (`"password PASSWORD_NEEDS_DIGIT"`). Map them onto the
  form fields.
- Some refusals carry extra fields: keep them, they are what makes the refusal
  actionable (e.g. `missing`, `field`, `resetsAvailableAt`, `tier`,
  `subscriptionStatus`).
- A **503** (`SUBSCRIPTION_CHECK_UNAVAILABLE`,
  `CENTER_SESSION_VERIFICATION_UNAVAILABLE`) means the backend could not check
  right now: say "try again in a moment". It never means signed out.

**Never compute business rules in the dashboard.** Access, completeness,
readiness, seat counts and reset allowances all come from the API. If the page
needs a number the API does not give, ask for it; do not derive it.

**Payments are not in scope.** The payment flow's final shape is still being
decided (B17). Leave the existing payment screens as they are.

---

## 1. Registration sends five fields (T1)

`POST /api/center-auth/register` accepts exactly:

```json
{ "centerName", "managerFirstName", "managerLastName", "email", "password" }
```

Unknown fields are refused with `VALIDATION_ERROR`. Today `centerRegister()` in
`src/lib/center-auth/api.ts` also sends hard-coded `country: "CM"`,
`city: "Douala"`, `phone: "+237000000000"` (from `RegisterView.tsx`), so
registration **fails against the real API**. Remove them; location and phone
are collected later, in onboarding.

**Done when:** a new center can register against the real API.

## 2. Password rule (T2)

Wherever a password is **set** (register, reset, change password): at least 8
characters, at least one uppercase letter, one digit and one special character,
at most 72 bytes (UTF-8). Show the rule next to the field and check it before
submitting. The backend refuses with `VALIDATION_ERROR` and one of
`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `PASSWORD_NEEDS_UPPERCASE`,
`PASSWORD_NEEDS_DIGIT`, `PASSWORD_NEEDS_SPECIAL` — show the specific reason.
Never check it at login. The register page today asks ≥6 + complexity and the
settings page ≥8: both move to this rule.

## 3. Signing in, tokens and logout (D10, D13)

**Register** (task 1) always answers `{ "message": "verification email sent" }`,
also for an address that already has an account. Say "check your inbox"; never
suggest whether the address was known.

**Email verification.** The email links to the website:
`/verify-email?token=…&type=center`. On that page, for `type=center`, call
`POST /api/center-auth/verify-email` with `{ token, deviceId, deviceName? }`:
it verifies **and signs in**, answering like login. (`verify-email-public`
with `{ token }` only verifies, without a session.) Refusals:
`VERIFICATION_TOKEN_INVALID`, `VERIFICATION_TOKEN_EXPIRED` — offer to send a
new email by registering again.

**Login** — `POST /api/center-auth/login` with `{ email, password, deviceId,
deviceName? }` returns `accessToken`, `refreshToken`, `centerUser`, `center`.
`deviceId` is a stable id for this browser: generate it once and keep it.
- `INVALID_CREDENTIALS` (401): the same answer for an unknown email and a
  wrong password. Say "email or password is incorrect".
- `EMAIL_NOT_VERIFIED` (403): only after a correct password. Say "verify your
  email first".

**Forgot password** — `POST /api/center-auth/forgot-password` with `{ email }`
always answers the same way; the email carries a code valid 10 minutes. Then
`POST /api/center-auth/reset-password` with `{ email, code, newPassword,
deviceId, deviceName? }` sets the password (task 2 rule) **and signs in**,
answering like login; every other device is signed out. Refusals:
`RESET_CODE_INVALID`, `RESET_CODE_EXPIRED`.

**Tokens.**
- On a 401 `INVALID_CENTER_ACCESS_TOKEN`, call `POST /api/center-auth/refresh`
  with `{ refreshToken }` **once**, store the new pair (the refresh token
  rotates: always replace it), and retry the request. Make concurrent requests
  share one refresh. If the refresh answers `INVALID_CENTER_REFRESH_TOKEN`,
  clear the session and go to login.
- On a 401 `CENTER_SESSION_REVOKED`, **do not refresh**: this session was ended
  on purpose — a 4th device signed in (a center user may be signed in on 3),
  the password was changed or reset elsewhere, or it was logged out elsewhere.
  Clear the session and go to login with *"You were signed out on this
  device."*

**Logout** — `POST /api/center-auth/logout` with `{ refreshToken }`, then clear
local state. Today logout only clears local state.

## 4. The account: `GET /api/centers/me` (D2, D11, D14)

The single source for the dashboard's state. It returns `centerUser`, `center`,
`onboarding` and `account`:

- `onboarding`: `{ complete, missing }` — `missing` lists what is still needed,
  from `"country"`, `"city"`, `"phone"`, in a stable order. Render the checklist
  from it; do not hard-code it.
- `account`:
  - `paymentStatus`: `"unpaid" | "trial" | "paid"` — what to show.
  - `subscriptionStatus`: `TRIAL_PENDING | TRIAL | ACTIVE | GRACE_PERIOD |
    BLOCKED` — for the cases that need a different sentence (GRACE_PERIOD
    "payment late", BLOCKED "access stopped").
  - `onboardingCompleted`, `onboardingStep` (1 manager details, 2 school
    details, 3 plan, 4 finished): where the wizard resumes.
  - `trialEndsAt`, `paidUntil`, `graceEndsAt`.
  - `studentsMayLearn`: whether students currently have access. Read it; do not
    re-derive it from dates.
  - `seats`: `{ start, pro, premium }`, keyed like `GET /api/plans`.
- `center` holds the structured location (`countryCode`, `regionId`, `cityId`,
  `cityOther`, `district`, `postalCode`, `street`, `houseNumber`) to prefill
  forms, plus `country` / `city` as display text.

Replace every fake-mode value the pages read (localStorage) with this.

## 5. Onboarding and settings: two profile routes, structured location

- `PATCH /api/centers/me` — the school: `name`, `countryCode`, `cityId` **or**
  `cityOther`, `district`, `postalCode`, `street`, `houseNumber`, `logoUrl`.
  `logoUrl` is an **https URL to a logo the school already hosts**; there is no
  upload yet (D22), so do not build an upload button.
- `PATCH /api/centers/me/manager` — the manager: `firstName`, `lastName`,
  `phone`, and where the manager is: `countryCode`, `cityId` **or** `cityOther`
  (no street address: nothing is posted to a manager).
- Both return the **whole updated profile** (same shape as `GET
  /api/centers/me`): use it, no need to re-read. Sending no field at all is
  refused with `NO_PROFILE_FIELDS_SUPPLIED`.
- `GET /api/locations` — countries, their regions and cities, and each
  country's address rules (which of district / postal code / street / house
  number it requires). Build the location fields from it: a country select,
  then a searchable city list with an **"other" option** that sends free text
  in `cityOther` (never both `cityId` and `cityOther`). The region is derived
  by the backend; do not send it. Show only the address fields the country
  requires.
- Location refusals are **not** `VALIDATION_ERROR`. `error` is the refusal
  itself — `UNKNOWN_COUNTRY`, `UNKNOWN_CITY`, `CITY_REQUIRED`,
  `CITY_AMBIGUOUS`, `CITY_TOO_LONG` — with `field` naming the input to mark
  (`countryCode`, `cityId` or `cityOther`). A required address field left
  empty answers `ADDRESS_INCOMPLETE` with `missing`: the fields to mark
  (`district`, `postalCode`, `street`, `houseNumber`). Shape errors (too long,
  wrong type) are still `VALIDATION_ERROR`.
- `GET /api/plans` — plan prices, seat minimums and quotas. The dashboard keeps
  only plan names and descriptions (translations); every number comes from
  here (D15). Plan ids are `start`, `pro`, `premium`.

## 6. Settings: change password (D23)

`POST /api/center-auth/change-password` with `{ currentPassword, newPassword }`
answers `{ success: true }`. The new password follows task 2. Other devices are
signed out (they get `CENTER_SESSION_REVOKED`, task 3); this one stays signed
in. Refusals: `WRONG_CURRENT_PASSWORD`, `PASSWORD_UNCHANGED` (the new password
is the current one).

## 7. Trial (D3)

`POST /api/centers/me/trial` starts the 14-day trial (the manager presses the
button; nothing starts it automatically) and returns `{ trialEndsAt, code }`:
the trial comes with **one Start seat = one activation code**. Refused with
`TRIAL_ALREADY_USED` (409) once a trial has run and `ALREADY_PAID` (409) for a
center that has paid. Then re-read `GET /api/centers/me`.

## 8. The Users page: activation codes (D1, D16–D18, D39)

Seats **are** codes: each seat a center holds is one code a student redeems.

- `GET /api/centers/me/activation-codes?status=&planId=` — filters take one
  value or `all` (`status`: `activated | connected | deactivated`; `planId`:
  `start | pro | premium`). Each code: `id`, `code` (`LQ-XXXX-XXXX`, show it
  large and copyable), `status`, `planId`, `linkedName`, `linkedEmail`,
  `connectedAt`, `createdAt`, `expiresAt`, and `reset`:
  `{ counted, remaining, availableAt }`.
  - `activated` = waiting for a student, `connected` = a student holds it,
    `deactivated` = taken back. Expiry is not a status: compare `expiresAt`.
- `GET /api/centers/me/seats` — `{ bought, used, boughtTotal, usedTotal }` per
  plan. Show these; do not count codes in the browser.
- **Deactivate**: `POST /api/centers/me/activation-codes/:id/deactivate` —
  takes a seat back. The student loses access on their next request.
- **Reset**: `POST /api/centers/me/activation-codes/:id/reset` — hands the seat
  to someone new: same seat and plan, **a new code value**; the old value stops
  working. Before calling it, show a confirmation that names the student:
  *"Amina will lose access, and all her progress on this seat will be
  permanently deleted."* and the resets left from `reset.remaining` (with
  `reset.availableAt` as the renewal date when it is 0). If `reset.counted` is
  false (nobody redeemed it since the last reset), say the reset is free.
  - `CODE_RESET_LIMIT_REACHED` (409) carries `resetsAvailableAt`: show it.
  - `CODE_CHANGED` (409): the code changed meanwhile — reload the list.
- **Remove "activate"**: the route no longer exists. Reset replaces it.
- Both actions are refused when the account cannot act:
  `ACCOUNT_NOT_FINALIZED` (403: no trial started and nothing paid yet — send
  them to finish onboarding) or `SUBSCRIPTION_INACTIVE` (403, with
  `subscriptionStatus`: e.g. `BLOCKED` "your subscription has lapsed").
- There is no "create code" and no "delete code": codes come from the trial and
  from payments.

## 9. Students: roster, progress, alerts (D38)

- `GET /api/centers/me/students?page=&pageSize=` (pageSize ≤ 100) →
  `{ students, total, page, pageSize }`. Each student: `id`, `firstName`,
  `lastName`, `email`, `phone`, `createdAt`, `lastSeenAt`, `tier`, `level`,
  `progress`.
  - `activated`, `activatedAt` and `activationKeyExpiresAt` **no longer exist**
    (every student on the roster joined by redeeming a code). Remove them.
- `GET /api/centers/me/students/:id` — one student, same shape.
- `PATCH /api/centers/me/students/:id` — `firstName`, `lastName`, `phone`,
  `tier` (move to another plan; refused with `TIER_NOT_HELD` or
  `SEAT_LIMIT_REACHED`, both naming `tier`), `level` (`A1 | A2 | B1 | B2`).
- `DELETE /api/centers/me/students/:id` — removes the student from the school
  and frees their seat; the account and their history are kept.
- `GET /api/centers/me/students/summary` — the dashboard headline:
  `{ students, averageReadiness, ready, skillAverages, alerts: { inactive,
  lowProgress, weakSkill } }`.

**`progress`, and how to show it** (the same numbers the student sees in the
Flutter app — never compute them here):

- `skills`: `{ hoeren, lesen, sprachbausteine, schreiben, sprechen }`, each 0–100
  or **`null` = "not practised yet"**. Never show null as 0 %.
- `readiness`: `{ score, written, oral, ready }`. `score` 0–100 is the
  **estimated** exam readiness — label it as an estimate, never a promise.
  **`score: null` = "not enough exercises yet"** (under 5 attempts).
- The "ready for the exam" badge comes from `readiness.ready`, **never** from
  comparing the shown numbers: an oral score shown as 60 can be 59.7, which is
  not a pass.
- `attempts`, `lastActivityAt`.
- `alerts`: `inactive` (nothing for 7 days, or never), `low_progress`
  (readiness under 40), `weak_skill` (a practised skill under 45, with `skill`
  and `score`).
- `level`: the student's current level, null until set. The target is always
  **telc B1+ Beruf**: a fixed label, not a field.

Remove the fake values (`fake/students.ts`).

## 10. Support and account deletion (D24, D37)

- **Support page:** `POST /api/support/contact` with `{ name, email, message }`
  (message ≥ 10 characters after trimming). Prefill name and email from the
  manager. `201 { id }` → "Message sent; we have emailed you a confirmation."
  `RATE_LIMIT_EXCEEDED` (429) after 5 messages in an hour. The FAQ stays static.
- **"Delete my account":** `POST /api/centers/me/deletion-request` (no body).
  It **deletes nothing**: the team is emailed and contacts the manager. After
  `201`, show: *"Your request has been sent. An administrator will contact you
  about deleting your account."* 3 requests a day at most (429).
- Both work even when the subscription has lapsed.

## 11. Remove what the product dropped

- **Student follow-up notes** (D25): remove the UI.
- **Referral code field** on the payment step (D36): remove it.
- **Per-student activation keys** and any "add a student" form (D20): students
  arrive only by redeeming a code.
- **Google sign-in** anywhere (D8).

---

## How to check your work

With `NEXT_PUBLIC_*` pointing at a local backend on `dev` and fake mode off:
register → verify email (lands signed in) → log out → log in with a wrong
password, then the right one → forgot password → reset → complete onboarding → start the trial →
see the one code → (in the Flutter app, a student redeems it) → the student
appears on the Users page and the Students page with "not enough exercises
yet" → reset the code with the confirmation → the student disappears and the
new code value shows. Also: let the access token expire and see the page
recover without a login; sign in on a 4th browser and see the first one sent
to login with "You were signed out on this device".
