# Global Implementation Plan: Center Subscriptions and Student Activation

**Created:** 2026-08-22  
**Status:** Draft for human approval  
**Repository baseline:** `main` at `40e4db5`; 35 test suites / 367 tests pass; `npm.cmd run build` passes  
**Companion checklist:** `tasks/center-subscription-global-todo.md`

## Objective

Add a center-based commercial access model to the existing Lerniqo backend:

- every language center registers through one public flow and has a center dashboard API;
- an optional backend-generated partnership code applies the contracted partner price;
- a center receives a 30-day trial for at most 3 students;
- the trial starts when its first student activates an account;
- a center later buys at least 10 monthly seats through an online checkout;
- standard centers pay 4,800 XAF per seat and special partners pay 4,500 XAF per seat;
- payment is initiated manually each month; Lerniqo stores no automatic-renewal financial details;
- reminders and a 7-day grace period precede access blocking;
- each student receives a unique, one-time activation key and can use the same account cross-platform;
- blocked centers and students retain data, but students cannot use the learning application;
- AI consumption is measured and limited separately.

This is a backend initiative. Center-dashboard and student-app UI implementation are outside this repository, but all required API contracts will be documented here.

## Confirmed Product Rules

| Rule                    |                   Standard center |                               Special partner |
| ----------------------- | --------------------------------: | --------------------------------------------: |
| Registration            |                Public center form | Same public center form plus partnership code |
| Trial                   |       30 days, maximum 3 students |       Same unless contract later overrides it |
| Minimum paid seats      |                                10 |                                            10 |
| Monthly unit price      |                         4,800 XAF |                                     4,500 XAF |
| Minimum monthly payment |                        48,000 XAF |                                    45,000 XAF |
| Payment                 | Center initiates website checkout |  Same checkout; backend applies partner price |
| Automatic renewal       |                                No |                                            No |
| Grace period            |                            7 days |     7 days unless contract later overrides it |

## Assumptions Requiring Approval

1. A student belongs to exactly one center in the MVP. We add nullable `center_id` to the existing `Student` model instead of creating a many-to-many membership system. Existing students remain valid during migration.
2. A center may eventually have several managers, so authentication belongs to a separate `CenterUser` model rather than fields directly on `Center`.
3. A partnership code is generated through a private backend CLI command, stored as a keyed hash, usable once, expirable, and revocable.
4. Consuming a partnership code copies an immutable pricing snapshot to the center. Later code edits do not silently change an existing contract.
5. The partnership code selects pricing only. It never activates a subscription without verified payment.
6. The first successful student activation starts the 30-day trial atomically.
7. A center can access its dashboard when blocked, but only profile, billing, payment history, and renewal operations remain usable.
8. Students cannot use learning endpoints after the center becomes blocked. Their accounts and progress are retained.
9. The initial trial AI allowance is 30 chargeable AI operations per center. Paid-plan quotas remain configurable and will be decided from measured cost data.
10. Existing guest/demo access is not expanded by this initiative. Its final relationship to blocked-center access must be decided before the access-control phase.

## Architecture Decisions

- **Separate principals:** `Student` and `CenterUser` remain separate identities. A center manager is never stored as a student.
- **Reuse infrastructure, not the student model:** reuse password hashing, token hashing, session rotation, email, rate-limit, validation, and Swagger patterns from `auth`; create center-specific records and authorization.
- **Simple ownership:** `Student.center_id` is the ownership and seat-counting boundary for the MVP.
- **One pricing authority:** the backend reads the center's stored billing terms and calculates XAF amounts. The client never supplies a unit price or total.
- **One access authority:** a subscription-policy service returns the effective access decision from status and dates. Controllers and jobs do not duplicate subscription rules.
- **Server-enforced blocking:** protected learning APIs use a subscription guard after JWT authentication. Hiding UI elements is not considered enforcement.
- **Verified fulfillment:** a browser redirect never activates access. Only a signed, server-verified Notch Pay result can confirm payment.
- **Idempotent money movement:** payment creation and webhook consumption use unique database constraints and idempotency records to tolerate retries safely.
- **Derived dates remain authoritative:** scheduled jobs send reminders and materialize status, but guards still derive effective access from timestamps so a delayed job cannot extend access accidentally.
- **Incremental migrations:** schema changes are introduced per vertical phase, not as one large migration.
- **No administration UI in MVP:** partnership creation uses a backend command; all subscription activation comes from online payment verification.

## Capability and Dependency Map

| Phase | Capability                                   | Depends on                   | Planned branch                  |
| ----- | -------------------------------------------- | ---------------------------- | ------------------------------- |
| 1     | Center identity and profile                  | Existing auth infrastructure | `feature/center-identity`       |
| 2     | Partnership code and pricing assignment      | Phase 1                      | `feature/partnership-codes`     |
| 3     | Trial, subscription, and seat policy         | Phases 1-2                   | `feature/center-subscriptions`  |
| 4     | Center-managed student activation            | Phases 1-3                   | `feature/student-activation`    |
| 5     | Subscription access enforcement              | Phases 3-4                   | `feature/subscription-access`   |
| 6     | Price quotation and payment records          | Phases 2-3                   | `feature/subscription-payments` |
| 7     | Notch Pay checkout and webhooks              | Phase 6                      | `feature/notchpay-checkout`     |
| 8     | Renewal, reminders, grace, and blocking      | Phases 5 and 7               | `feature/subscription-renewal`  |
| 9     | AI usage metering and quotas                 | Phases 4-5                   | `feature/ai-usage-limits`       |
| 10    | Migration, end-to-end hardening, and rollout | Phases 1-9                   | `feature/center-access-rollout` |

Build order:

```text
center identity
  -> partnership pricing
  -> subscription/trial policy
  -> student activation
  -> access enforcement
  -> payment records
  -> Notch Pay verification
  -> renewal/grace/blocking
  -> AI quotas
  -> migration and rollout
```

## Global Phases

### Phase 1: Center identity and profile

**Outcome:** a center manager can register, verify contact ownership, log in, refresh/logout, and read/update the authenticated center profile.

**Expected API surface:**

```text
POST  /api/centers/register
POST  /api/center-auth/verify-email
POST  /api/center-auth/login
POST  /api/center-auth/refresh
POST  /api/center-auth/logout
POST  /api/center-auth/forgot-password
POST  /api/center-auth/reset-password
GET   /api/centers/me
PATCH /api/centers/me
```

**Acceptance gate:** center identity is isolated from `Student`; ownership always comes from the center JWT; existing student auth remains green.

**Specific plan before coding:** `tasks/phases/01-center-identity-plan.md`

### Phase 2: Partnership code and pricing assignment

**Outcome:** the backend developer can generate a strong one-time code; registration consumes it atomically and assigns the contracted price to one center.

**Expected internal surface:**

```text
npm run partnership-code:create
POST /api/centers/register  (extended with optional partnershipCode)
```

**Acceptance gate:** code guessing, reuse, logging, race conditions, expiry, and revocation are covered by tests; the raw code is returned only by the CLI at creation.

**Specific plan before coding:** `tasks/phases/02-partnership-codes-plan.md`

### Phase 3: Trial, subscription, and seat policy

**Outcome:** every center has one current subscription policy; a new center can provision at most 3 trial students; paid plans require at least 10 seats.

**Expected API surface:**

```text
GET /api/centers/me/subscription
GET /api/centers/me/usage
```

**Acceptance gate:** policy tests cover `TRIAL_PENDING`, `TRIAL`, `ACTIVE`, `GRACE_PERIOD`, and `BLOCKED`; dates and seat counts are deterministic and concurrency-safe.

**Specific plan before coding:** `tasks/phases/03-center-subscriptions-plan.md`

### Phase 4: Center-managed student activation

**Outcome:** a center creates a student within its seat limit; the backend returns a unique one-time key; the student consumes it, creates a private password, starts the trial when applicable, and receives the existing student token/session shape.

**Expected API surface:**

```text
GET    /api/centers/me/students
POST   /api/centers/me/students
GET    /api/centers/me/students/:studentId
PATCH  /api/centers/me/students/:studentId
DELETE /api/centers/me/students/:studentId
POST   /api/centers/me/students/:studentId/activation-key
DELETE /api/centers/me/students/:studentId/activation-key
POST   /api/student-activations
```

**Acceptance gate:** keys are hashed, single-use, expirable, center-scoped, and rotated safely; two concurrent student creations cannot exceed the seat limit.

**Specific plan before coding:** `tasks/phases/04-student-activation-plan.md`

### Phase 5: Subscription access enforcement

**Outcome:** every protected student learning operation enforces the owning center's effective subscription; blocked students cannot continue with an existing access or refresh token.

**Expected components:**

```text
SubscriptionPolicyService
StudentSubscriptionGuard
CenterSubscriptionGuard
```

**Acceptance gate:** all learning controllers are covered; payment/profile recovery remains reachable; cross-center access is denied; no frontend-only security assumptions exist.

**Specific plan before coding:** `tasks/phases/05-subscription-access-plan.md`

### Phase 6: Price quotation and payment records

**Outcome:** the backend calculates the correct standard or partner amount and creates a durable, retry-safe local payment intent.

**Expected API surface:**

```text
POST /api/centers/me/subscription/quote
POST /api/payments
GET  /api/payments/:paymentId
GET  /api/centers/me/payments
```

**Acceptance gate:** minimum seat rules are enforced; XAF amount is never trusted from the client; idempotency keys are atomically claimed and payload-bound.

**Specific plan before coding:** `tasks/phases/06-subscription-payments-plan.md`

### Phase 7: Notch Pay checkout and webhook verification

**Outcome:** a center can initiate a supported checkout and a verified provider event activates or extends its subscription exactly once.

**Expected API surface:**

```text
POST /api/payments
POST /api/webhooks/notchpay
```

**Acceptance gate:** official Notch Pay docs are rechecked at implementation time; keys stay server-side; provider responses are schema-validated; forged, reordered, and duplicated events cannot grant access.

**Specific plan before coding:** `tasks/phases/07-notchpay-plan.md`

### Phase 8: Renewal, reminders, grace, and blocking

**Outcome:** centers receive renewal reminders, keep temporary access during the 7-day grace period, then lose application access if unpaid; verified payment restores access without data loss.

**Expected components:**

```text
SubscriptionLifecycleService
SubscriptionReminderJob
Renewal email templates
```

**Acceptance gate:** lifecycle transitions are clock-controlled in tests; jobs are idempotent; reminders are not duplicated; restoration extends from the correct date.

**Specific plan before coding:** `tasks/phases/08-subscription-renewal-plan.md`

### Phase 9: AI usage metering and quotas

**Outcome:** cost-generating AI calls reserve and record usage before provider invocation; trial quotas cannot be exceeded through concurrent requests.

**Initial protected operations:**

```text
POST /api/speaking/evaluate
POST /api/writing/submit
```

**Acceptance gate:** the 31st trial operation is denied before an external AI call; failures and retries do not corrupt usage; request count, provider usage, and estimated cost are observable.

**Specific plan before coding:** `tasks/phases/09-ai-usage-plan.md`

### Phase 10: Migration, hardening, and rollout

**Outcome:** legacy self-registration and account paths cannot bypass center ownership; existing users have an explicit migration rule; the complete center-to-student-to-payment lifecycle is production-ready and rollbackable.

**Required checks:**

- decide the fate of `POST /api/auth/register`, guest mode, and disabled Google auto-creation;
- backfill or classify existing students before making center ownership mandatory;
- exercise critical flows against a real test database;
- document new endpoints and environment variables;
- add structured subscription/payment security logs without secrets;
- define staged deployment, database rollback, and payment-provider rollback.

**Acceptance gate:** full unit, integration, and e2e suites pass; production build passes; security review has no critical findings; rollout and rollback procedures are documented.

**Specific plan before coding:** `tasks/phases/10-center-access-rollout-plan.md`

## Per-Phase Workflow

Every phase follows the same gate:

```text
Write specific phase plan
  -> human approval
  -> inspect clean Git base
  -> create short-lived feature branch
  -> write failing behavior test
  -> implement one vertical slice
  -> test / build / lint
  -> atomic commit
  -> code and security review
  -> human approval
  -> merge
  -> begin next phase plan
```

No phase branch is created until its specific plan is approved. No branch is merged or pushed without explicit authorization.

## Verification Strategy

- **Focused unit tests:** pure pricing, subscription policy, code/key hashing, quota decisions, state transitions.
- **Integration tests:** transactions, unique constraints, seat concurrency, code consumption, payment idempotency, webhook fulfillment.
- **E2E tests:** center registration/login, student activation/login, trial start, payment activation, grace, blocking, restoration.
- **Provider sandbox tests:** Notch Pay checkout and webhook signatures with test credentials; never call the live provider from the normal Jest suite.
- **Regression gate after every phase:**

```text
npm.cmd test -- --runInBand --no-coverage
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run lint
```

Lint currently runs with `--fix`; before using it, the detailed phase plan must account for possible formatting changes and confirm the intended diff.

## Main Risks and Mitigations

| Risk                                                | Impact   | Mitigation                                                                                |
| --------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Existing student self-registration bypasses centers | Critical | Migrate/deprecate it explicitly; access guard requires center ownership for paid learning |
| Google flow auto-creates students                   | Critical | Keep disabled and prevent future re-enable until it follows center activation rules       |
| Duplicate or forged payment events grant access     | Critical | Signature + server verification + unique provider reference + transactional idempotency   |
| Concurrent center operations exceed seats           | High     | Database transaction and locking/atomic constraint strategy tested under concurrency      |
| Subscription scheduler runs late                    | High     | Access guard derives effective status from authoritative timestamps                       |
| Partnership code leaks or is guessed                | High     | 128-bit randomness, keyed hash, rate limiting, single-use atomic consumption, no logs     |
| Blocked student uses a stale token                  | High     | Subscription check on protected requests and refresh, not only at login                   |
| Guest/demo access contradicts full blocking         | Medium   | Make an explicit product decision before Phase 5 and test the chosen rule                 |
| Logo upload becomes an arbitrary-file vulnerability | Medium   | Signed storage upload or strict MIME/size validation; never trust file extension          |
| AI retries double-count or exceed quota             | Medium   | Reserve quota atomically before provider call and record final provider usage             |
| Long-lived branches create integration conflicts    | Medium   | One short-lived branch per approved phase; merge completed vertical slices promptly       |

## Open Questions to Resolve Before Their Phase

1. **Student activation-key lifetime:** recommended 7 days. Confirm before Phase 4.
2. **Student removal:** should deleting a student immediately free a paid seat, or should removal take effect next billing period? Resolve before Phase 4.
3. **Existing students:** assign them to a Lerniqo/internal center, preserve them as legacy users, or require migration? Resolve before Phase 5.
4. **Guest mode:** keep a restricted public demo or remove it when center access launches? Resolve before Phase 5.
5. **Logo storage:** use the existing Supabase/Cloudflare setup or another object store? Resolve before Phase 1 profile upload is finalized.
6. **Reminder channel:** email only for MVP, or email plus SMS/WhatsApp? Resolve before Phase 8.
7. **Paid AI quota:** unlimited with cost monitoring, per-seat allocation, or paid add-on? Resolve before Phase 9.
8. **Notch Pay merchant readiness:** confirm approved business account, test/live API keys, webhook secret/signature contract, and enabled Cameroon channels before Phase 7.


9. **Student email requirement:** is a student's email required, or is phone (WhatsApp) enough? Email is unreliable in-market, but without it a student who forgets their password has no self-service recovery; center-mediated recovery via a re-issued activation key is the alternative. Resolve before Phase 4.
10. **Blocked-student experience:** what a student sees when their center stops paying. Agreed to be an in-product offer to continue rather than outbound marketing; the wording and destination are unspecified. Resolve before Phase 5.

See `docs/ARCHITECTURE-B2B2C.md` for the agreed model these questions sit inside.
## Global Definition of Done

- Each phase has an approved specific plan and a short-lived branch.
- All confirmed product rules have automated tests.
- Existing 367 tests remain green unless an approved migration intentionally changes them.
- Center and student authorization boundaries are enforced by the backend.
- Partnership, activation, payment, and reset secrets are never stored in plaintext or logged.
- Payment fulfillment is idempotent and independently verified.
- Blocked subscriptions deny learning access while retaining account/progress data.
- Swagger/API documentation and environment examples are current.
- Production deployment and rollback steps are documented and tested proportionally to risk.
