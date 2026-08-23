# Architecture: centers, students, and seats

How Lerniqo sells to language centers and how those centers give their students
access to the product. This is the model Phases 2–9 of
`tasks/center-subscription-global-plan.md` build on; where the two disagree,
the global plan wins and this document is wrong and should be corrected.

Status: agreed 2026-08-23, after Phase 1 shipped.

## The shape of the business

Lerniqo has **one product** and **two audiences**.

```
app.lerniqo.tech            the product. Students learn here.
lerniqo.tech/dashboard      the admin console. Centers manage here.
```

A language center buys a number of seats, provisions its own students from the
dashboard, and watches how they are progressing. The center never studies in the
app. The student never sees the dashboard.

The center is a **reseller of access**, not a user of the product. In industry
terms this is B2B2C seat licensing with delegated provisioning — the same shape
as Google Workspace, where `admin.google.com` administers users who then go and
use Gmail.

## Decisions

These are settled. Re-open them deliberately, not by accident.

| # | Decision | Consequence |
|---|---|---|
| 1 | **A center sees everything about the students it provisioned.** Ownership is the only boundary; there is no per-field privacy layer. | Monitoring endpoints filter on `center_id` and return whatever the center asks for. Simple to build, simple to reason about. |
| 2 | **Students never pay individually.** | No student billing, no student-owned subscription, no "upgrade" path in the app. Removes a whole branch from Phases 5–7. |
| 3 | **A blocked student is offered a way to continue, in the product.** | When the owning center stops paying, the student sees an in-app message rather than receiving outbound marketing. No consent problem, and no appearance of poaching a center's customers. |
| 4 | **A student belongs to at most one center.** | `Student.center_id` is nullable. Null means independent — which is also the door to B2C later, already open with no migration. |
| 5 | **Center and student are separate principals.** | A center manager is never a `Student` row. Two tables, two token types that already refuse each other (shipped in Phase 1). |

## Principals

```
CenterUser ──owns──▶ Center ──┐
                              │  Student.center_id  (nullable FK)
                              └──────────────▶ Student ──▶ learning data
```

- **`CenterUser`** — the admin. Token carries `actorType: 'CENTER_USER'`, plus
  `centerId`, `deviceId`, `sessionId`.
- **`Student`** — the learner. Existing model, existing auth, unchanged.
- **`Student.center_id`** — the ownership boundary and the seat counter.

## Seats

A center has one subscription with a seat count and a state:

```
TRIAL_PENDING → TRIAL → ACTIVE → GRACE_PERIOD → BLOCKED
```

Trial allows 3 students. Paid plans require at least 10 seats.

**A seat is consumed by the existence of a `Student` row carrying the center's
`center_id`** — not by that student logging in, and not by a separate counter
column. `COUNT(students WHERE center_id = X)` *is* seat usage.

That matters: there is no counter to drift out of sync with reality, and the
limit is enforced by counting and inserting inside one Serializable transaction,
so two concurrent provisions cannot both slip past the last seat.

## The five flows

### 1. Center onboards — Phase 1, shipped

```
POST /api/center-auth/register
  → verification email
  → lerniqo.tech/verify-email?token=…&type=center
  → POST /api/center-auth/verify-email-public      (creates no session)
  → POST /api/center-auth/login                    (from the dashboard)
```

Verification deliberately issues no session. A public web page has no
meaningful device identity and nowhere safe to keep a seven-day refresh token,
so the owner confirms in the browser and then signs in.

### 2. Center subscribes — Phases 3, 6, 7

```
dashboard → choose seat count → Notch Pay checkout
  → verified webhook → subscription ACTIVE
```

Pricing is computed on the backend. A client never sends an amount.

### 3. Center provisions a student — Phase 4

```
POST /api/centers/me/students                     { firstName, lastName, phone, email? }
  → seat check and insert in one Serializable transaction
  → Student(center_id = <from the token>, no password, unverified)

POST /api/centers/me/students/:id/activation-key
  → returns a one-time key; stored hashed; expires (~7 days, to confirm)
```

The center hands that key to the student directly — printed, in class, over
WhatsApp. This is deliberately not an emailed invite link: the students are
physically present in a classroom in Douala, and email deliverability is a
dependency worth not having.

### 4. Student activates — Phase 4

```
app.lerniqo.tech → "I have an activation key"
POST /api/student-activations                     { key, password }
  → key consumed atomically, single use
  → the student sets their OWN password
  → returns the normal student token pair
```

**The center never learns the password.** It created the account; it cannot
sign in as it. That single property is what makes delegated provisioning safe,
and it must survive every future change to this flow.

### 5. Center monitors — Phases 4, 5

```
GET /api/centers/me/students
GET /api/centers/me/students/:id
GET /api/centers/me/usage
```

Every query scoped by `center_id` taken from the signed token. Full visibility
per decision 1.

## Authorization

| Rule | Enforced by |
|---|---|
| A center reaches only its own students | `where: { center_id: token.centerId }` — never from a body or path parameter |
| A student cannot reach the dashboard | student tokens carry no `actorType`; the center verifier rejects them |
| A center cannot reach learning endpoints | center tokens carry `actorType`; the student verifier rejects them (Phase 1) |
| A blocked center's students lose access | `StudentSubscriptionGuard` on every protected learning route |
| A blocked student cannot outlive the block | the subscription is checked **on refresh as well as on request** |
| Seat limits hold under concurrency | count and insert in one Serializable transaction |

The second-to-last row is the one that is easy to get wrong. Checking the
subscription only at login lets a student blocked on Monday keep working until
their refresh token expires on Friday.

## Frontends

```
lerniqo.tech        center dashboard   center tokens
app.lerniqo.tech    student app        student tokens
       └──────────── one NestJS API ───────────┘
```

The only infrastructure change is `ALLOWED_ORIGINS`, which needs both origins.

There is **no shared session across the subdomains**, deliberately — they are
different people with different logins.

The dashboard authenticates as an ordinary SPA: `deviceId` is a UUID generated
once and kept in `localStorage` (that is the device identity, and it makes the
three-device limit behave sensibly in a browser), the access token lives in
memory, and the refresh token is persisted and exchanged on page load.

Moving the refresh token into an httpOnly cookie would remove the
XSS-steals-your-token risk. That is a real backend change — cookie issuing plus
CSRF protection — and belongs in Phase 10 hardening, not before.

## Open questions

Carried from the global plan, plus what this document surfaced. Each should be
answered before the phase that depends on it.

| # | Question | Needed before |
|---|---|---|
| 1 | Activation-key lifetime (7 days recommended) | Phase 4 |
| 2 | Does removing a student free a paid seat immediately, or at the next billing period? | Phase 4 |
| 3 | Existing students: assign to an internal center, keep as legacy, or migrate? | Phase 5 |
| 4 | Guest mode: keep a restricted demo or remove it? | Phase 5 |
| 5 | Logo storage: the API takes an HTTPS URL and stores no binary. If centers must upload, this needs an object store. | when upload is wanted |
| 6 | Reminder channel: email only, or email plus WhatsApp? | Phase 8 |
| 7 | Paid AI quota | Phase 9 |
| 8 | Notch Pay merchant readiness | Phase 7 |
| 9 | **Is a student's email required, or is phone enough?** Email is unreliable in-market, but without it a student who forgets their password has no self-service recovery. Center-mediated recovery (re-issue an activation key) is the alternative. | Phase 4 |
| 10 | **What does a student see when their center is blocked?** Decision 3 says an in-product offer to continue — its wording and destination are unspecified, and it is the moment a churned center becomes a B2C opportunity. | Phase 5 |
