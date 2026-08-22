# Phase 1 Implementation Plan: Center Identity and Profile

**Created:** 2026-08-22  
**Status:** Draft for human approval  
**Parent:** `tasks/center-subscription-global-plan.md`  
**Planned branch after approval:** `feature/center-identity`  
**Baseline:** `main` at `40e4db5`; 35 suites / 367 tests and production build pass

## Objective

Deliver the first complete backend slice for a language center:

1. a center owner registers the center and their own credentials;
2. the owner verifies their email;
3. the owner logs in, refreshes tokens, and logs out safely;
4. the authenticated owner reads and updates the center profile, including its logo URL;
5. existing student authentication and learning behavior remain unchanged.

This phase creates identity only. Partnership codes, trials, students, subscriptions, seats, payments, access blocking, and AI limits remain outside this branch.

## Phase Assumptions

1. **One module owns center identity.** A new `CentersModule` contains center registration, center authentication, profile access, DTOs, guards, and center-specific errors.
2. **Organization and person stay separate.** `Center` represents the language center; `CenterUser` represents an authenticated manager. Registration creates the center and one `OWNER` user atomically.
3. **Future managers are supported without building manager administration now.** The schema allows several users per center, but this phase exposes no invitation or role-management endpoints.
4. **Center and student emails may be the same.** Uniqueness is enforced inside `CenterUser`; an individual may legitimately be both a student and a center owner.
5. **Logo upload is not proxied by this backend.** The API accepts an optional validated HTTPS `logoUrl`. The website uploads the binary to the chosen object store and submits the resulting URL. The backend never fetches the URL.
6. **No email change in profile PATCH.** Changing login email requires a separate re-verification flow and is excluded from this phase.
7. **No phone verification yet.** Phone is stored for center contact purposes only; email is the authentication identifier.
8. **Session limit matches students.** A center user may have at most three active device sessions; a new device evicts the oldest.
9. **Existing security timings are reused.** Verification token: 24 hours; resend cooldown: 2 minutes; password-reset code: 10 minutes.
10. **Center passwords use bcrypt cost 12.** Existing student hashes remain untouched and continue to verify normally.

## Scope

### In scope

- `Center`, `CenterUser`, and `CenterDeviceSession` Prisma models;
- center registration with generic anti-enumeration response;
- verification, login, refresh, logout, forgot/reset password;
- center-specific JWT payloads and guard;
- center profile read and partial update;
- optional center logo URL storage;
- rate limiting through existing `RateLimitService` policies;
- Swagger DTOs, unit tests, controller/e2e tests, and API documentation;
- additive AppModule wiring.

### Out of scope

- partnership/promotion-code input or pricing;
- subscription/trial creation;
- students and activation keys;
- payment providers;
- binary/file upload handling;
- center staff invitations or role management;
- deleting centers or exporting personal data;
- changes to `POST /api/auth/register`;
- changes to guest mode or Google authentication.

## Architecture

### Module layout

```text
src/modules/centers/
├── centers.module.ts
├── centers.controller.ts
├── centers.service.ts
├── center-auth.controller.ts
├── center-auth.service.ts
├── center-errors.ts
├── center-exception.filter.ts
├── decorators/current-center-user.decorator.ts
├── guards/center-auth.guard.ts
└── dto/
    ├── register-center.dto.ts
    ├── center-auth-request.dto.ts
    ├── center-auth-response.dto.ts
    └── center-profile.dto.ts
```

Files may be split further if one exceeds a healthy size, but no generic repository abstraction will be introduced for a single use case.

### Dependency direction

```text
Prisma Center models
  -> typed center token payloads
  -> center auth service and guard
  -> registration/auth controllers
  -> center profile endpoints
  -> AppModule and API documentation
```

`CentersModule` may import `AuthModule` for exported `TokenService`, `TokenCryptoService`, and `EmailService`. `AuthModule` must not import `CentersModule`, preventing a cycle.

### Reuse boundary

Reuse directly:

- `TokenCryptoService.generateToken/hashToken/isExpired`;
- `TokenService.hashRefreshToken/compareRefreshToken`;
- the existing JWT secrets, issuer, audience, expiry settings, and rotation pattern;
- `EmailService` transport and configuration;
- `RateLimitService` registration/login/reset policies;
- global `class-validator` validation pipe;
- `ValkeyService` session-revocation cache;
- Prisma transaction conventions and Swagger patterns.

Do not reuse directly:

- `Student`, `DeviceSession`, `AuthService`, `JwtAuthGuard`, or `CurrentStudent` for center managers;
- student response DTOs;
- Google auto-account creation.

## Data Model

### `Center`

```text
id          UUID primary key
name        required
country     required
city        required
logo_url    nullable HTTPS URL
created_at
updated_at
```

### `CenterUser`

```text
id                         UUID primary key
center_id                  required foreign key -> Center
role                       OWNER | MANAGER (only OWNER created in Phase 1)
first_name                 required
last_name                  required
email                      required, normalized, globally unique in CenterUser
phone                      required
password_hash              required
email_verified             false by default
email_verification_token   nullable keyed hash
email_verification_expires nullable
password_reset_token       nullable keyed hash
password_reset_expires     nullable
last_seen_at
created_at
updated_at
```

### `CenterDeviceSession`

```text
id                 UUID primary key
center_user_id     required foreign key -> CenterUser
device_id          required
refresh_token_hash required bcrypt hash
device_name        nullable
last_used_at
created_at
revoked_at         nullable
unique(center_user_id, device_id)
```

Delete behavior:

- `CenterUser -> Center`: `Restrict`; accidental center deletion must not silently erase identities.
- `CenterDeviceSession -> CenterUser`: `Cascade`; deleting an identity must remove its sessions.
- This phase exposes no delete endpoint.

The migration is additive. Rolling application code back can leave the unused tables safely in place; production rollback must not drop tables containing user data.

## Token Contract

Center access token claims:

```json
{
  "type": "access",
  "actorType": "CENTER_USER",
  "centerUserId": "uuid",
  "centerId": "uuid",
  "deviceId": "installation-id",
  "sessionId": "uuid"
}
```

Center refresh token uses the same claims with `type: "refresh"` and a unique JWT ID.

Rules:

- student verification rejects center tokens;
- center verification rejects student and guest tokens;
- controller ownership always comes from signed `centerId`, never a request body or query parameter;
- refresh tokens rotate atomically; concurrent replay loses with `401 INVALID_REFRESH_TOKEN`;
- a revoked center session invalidates protected access in the same way as student sessions.

## API Contract

All center APIs return camelCase JSON. Center-specific errors use:

```json
{
  "error": "MACHINE_READABLE_CODE",
  "message": "Human-readable message"
}
```

### `POST /api/centers/register`

Request:

```json
{
  "centerName": "Goethe Language Center",
  "country": "Cameroon",
  "city": "Douala",
  "logoUrl": "https://cdn.example.com/centers/logo.webp",
  "managerFirstName": "Alain",
  "managerLastName": "Ngeukeu",
  "email": "manager@example.com",
  "phone": "+237690000000",
  "password": "private-password"
}
```

Response for new, existing verified, and existing unverified emails:

```json
{
  "message": "verification email sent"
}
```

Rules:

- normalize email before lookup;
- validate bounded string lengths and reject unknown fields;
- `logoUrl` is optional, HTTPS-only, and length-bounded;
- a repeated request never overwrites an existing unverified user's password, manager data, or center data;
- after the cooldown, a repeated unverified request rotates only the verification token and sends an explanatory email;
- send email after the database transaction commits; a delivery failure must not roll back a successfully created identity.

### `POST /api/center-auth/verify-email`

```json
{
  "token": "one-time-token",
  "deviceId": "installation-id",
  "deviceName": "Chrome on Windows"
}
```

Returns the center authentication response and consumes the verification token atomically.

### `POST /api/center-auth/login`

```json
{
  "email": "manager@example.com",
  "password": "private-password",
  "deviceId": "installation-id",
  "deviceName": "Chrome on Windows"
}
```

Incorrect email and incorrect password both return `401 INVALID_CREDENTIALS`. An unverified valid account returns `403 EMAIL_NOT_VERIFIED` and may resend verification after cooldown.

### Center authentication response

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "centerUser": {
    "id": "uuid",
    "role": "OWNER",
    "firstName": "Alain",
    "lastName": "Ngeukeu",
    "email": "manager@example.com",
    "phone": "+237690000000",
    "emailVerified": true
  },
  "center": {
    "id": "uuid",
    "name": "Goethe Language Center",
    "country": "Cameroon",
    "city": "Douala",
    "logoUrl": "https://cdn.example.com/centers/logo.webp"
  }
}
```

### Remaining auth endpoints

```text
POST /api/center-auth/refresh
  body: { refreshToken }
  response: { accessToken, refreshToken }

POST /api/center-auth/logout
  body: { refreshToken }
  response: { success: true }

POST /api/center-auth/forgot-password
  body: { email }
  response: { message: "If that email exists, a reset code was sent." }

POST /api/center-auth/reset-password
  body: { token, newPassword, deviceId, deviceName? }
  response: CenterAuthResponse
```

### Center profile

```text
GET /api/centers/me
PATCH /api/centers/me
```

Allowed PATCH fields:

```json
{
  "centerName": "Updated name",
  "country": "Cameroon",
  "city": "Yaounde",
  "logoUrl": "https://cdn.example.com/centers/new-logo.webp",
  "managerFirstName": "Alain",
  "managerLastName": "Ngeukeu",
  "phone": "+237690000001"
}
```

At least one field is required. `centerId`, role, email, verification state, password, pricing, and subscription state are never writable through this endpoint.

## Threat Model

| Abuse case | Control and required test |
|---|---|
| Enumerate registered center emails | Generic registration and forgot-password responses; identical status/shape |
| Pre-hijack an unverified center | Repeat registration rotates only verification token; never overwrites stored password/profile |
| Brute-force login/reset | Reuse distributed IP/email rate limits and short reset-code TTL |
| Use student token as center owner | Distinct `actorType` and center-token verifier; negative token-confusion tests |
| Access another center by changing an ID | No center ID accepted by `/me`; signed `centerId` is the only ownership source |
| Replay refresh token concurrently | Compare-and-update refresh hash atomically; exactly one request succeeds |
| Continue after logout | Session revocation checked in Valkey and database fallback |
| Inject unexpected profile fields | Global whitelist + `forbidNonWhitelisted`; explicit DTO allowlist |
| Abuse logo URL as SSRF | HTTPS validation and no server-side fetch or redirect following |
| Upload executable/oversized logo | No binary upload exists in this phase |
| Leak credentials/PII through logs or responses | Never log tokens/passwords; response DTO allowlists fields; generic internal errors |
| Hold database locks during email outage | Commit identity transaction before calling Resend |

## Task Dependency Graph

```text
Task 1 schema
  -> Task 2 center token contract
  -> Task 3 center email support
  -> Task 4 registration service
  -> Task 5 registration endpoint
  -> Task 6 auth/session service
  -> Task 7 verify + login endpoints
  -> Task 8 refresh + logout endpoints
  -> Task 9 password recovery
  -> Task 10 guard + profile endpoints
  -> Task 11 integration, docs, and final review
```

Tasks 2 and 3 are independent after Task 1. The remaining tasks are sequential vertical slices to keep the branch green.

## Detailed Tasks

### Task 1: Add center identity schema and additive migration

**Description:** Add the three center identity models, role enum, indexes, uniqueness, and foreign-key actions without changing existing student tables.

**Acceptance criteria:**

- Prisma validates and generates successfully.
- Migration contains only additive center identity objects and intended constraints.
- Existing `Student` and `DeviceSession` schema is byte-for-byte behaviorally unchanged.

**Verification:**

```text
npm.cmd run prisma:generate
npx.cmd prisma validate
npm.cmd run build
```

**Files likely touched:** `prisma/schema.prisma`, one new `prisma/migrations/*/migration.sql`  
**Estimated scope:** S  
**Dependencies:** none

### Task 2: Add typed center token support

**Description:** Extend token contracts and `TokenService` with center access/refresh generation and verification while preserving all student token behavior.

**Acceptance criteria:**

- Center tokens require `actorType`, `centerUserId`, `centerId`, `deviceId`, and `sessionId`.
- Student verifier rejects center tokens; center verifier rejects student/guest tokens.
- Existing token tests stay unchanged in intent and new center-token tests pass.

**Verification:**

```text
npm.cmd test -- token.service.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/shared/interfaces/token-payload.interface.ts`, `src/modules/auth/token.service.ts`, `test/token.service.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Task 1

### Task 3: Add center verification/reset email support

**Description:** Add center-specific verification, existing-account, and reset-code emails using the current Resend transport and center-dashboard URL paths; export only the auth infrastructure required by `CentersModule`.

**Acceptance criteria:**

- Center links point to center-specific website routes.
- Raw tokens appear only in the intended email body, never logs.
- Student email tests and behavior remain green.

**Verification:**

```text
npm.cmd test -- email.service.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/auth/email.service.ts`, `src/modules/auth/auth.module.ts`, `test/email.service.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Task 1

### Task 4: Implement registration business logic

**Description:** Implement normalized lookup, safe duplicate behavior, atomic center/owner creation, token hashing, bcrypt-12 password hashing, cooldown behavior, and post-commit email delivery in `CentersService`.

**Acceptance criteria:**

- New registration creates exactly one center and one owner.
- Duplicate unverified registration never replaces credentials/profile.
- Concurrent duplicate registration leaves one owner because the database unique constraint decides the winner.

**Verification:**

```text
npm.cmd test -- centers.service.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/centers.service.ts`, `src/modules/centers/dto/register-center.dto.ts`, `test/centers.service.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Tasks 1 and 3

### Task 5: Expose the center registration endpoint

**Description:** Add `CentersController`, center error formatting, registration rate limiting, Swagger contract, and module wiring without exposing any authenticated profile operation yet.

**Acceptance criteria:**

- Unknown fields and invalid URLs/lengths are rejected at the HTTP boundary.
- New/existing registration responses are indistinguishable.
- Rate-limit rejection happens before any registration write.

**Verification:**

```text
npm.cmd test -- centers.controller.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/centers.controller.ts`, `src/modules/centers/centers.module.ts`, `src/modules/centers/center-errors.ts`, `src/modules/centers/center-exception.filter.ts`, `test/centers.controller.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Task 4

### Checkpoint A: Registration slice

- focused registration tests pass;
- full 367-test regression suite stays green;
- production build passes;
- diff contains no subscription, student, or payment code;
- human reviews the registration contract before authentication expands.

### Task 6: Implement center authentication and session service

**Description:** Implement verification, credential validation, three-device session upsert, token issuance, last-seen update, refresh-hash rotation, and session revocation using center tables.

**Acceptance criteria:**

- Verification token is validated and consumed safely.
- Login uses generic invalid-credential behavior and blocks unverified users.
- Session creation/rotation is center-scoped and cannot affect student sessions.

**Verification:**

```text
npm.cmd test -- center-auth.service.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/center-auth.service.ts`, `src/modules/centers/dto/center-auth-response.dto.ts`, `test/center-auth.service.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Tasks 1-3

### Task 7: Expose verify-email and login endpoints

**Description:** Add the center auth controller and request DTOs for email verification and login, including existing distributed rate limits and Swagger responses.

**Acceptance criteria:**

- Verification returns the documented center auth response.
- Login normalizes email and requires stable `deviceId`.
- Validation, rate-limit, invalid credential, and unverified cases have contract tests.

**Verification:**

```text
npm.cmd test -- center-auth.controller.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/center-auth.controller.ts`, `src/modules/centers/dto/center-auth-request.dto.ts`, `src/modules/centers/centers.module.ts`, `test/center-auth.controller.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Task 6

### Task 8: Add refresh and logout with center token isolation

**Description:** Add refresh rotation and logout endpoints, then prove student/guest/center tokens cannot cross verifier boundaries and concurrent refresh succeeds once.

**Acceptance criteria:**

- Refresh token is single-use and replacement is atomic.
- Logout revokes only the authenticated center session.
- Center refresh/logout never queries `DeviceSession` or modifies student state.

**Verification:**

```text
npm.cmd test -- center-auth.controller.spec center-auth.service.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/center-auth.controller.ts`, `src/modules/centers/center-auth.service.ts`, `test/center-auth.controller.spec.ts`, `test/center-auth.service.spec.ts`  
**Estimated scope:** M  
**Dependencies:** Task 7

### Task 9: Add center password recovery

**Description:** Add generic forgot-password and one-time reset-code behavior. Reset deletes/revokes old center sessions and issues a new session for the submitted device.

**Acceptance criteria:**

- Forgot-password cannot enumerate center accounts.
- Reset code is hashed, expires after 10 minutes, and is consumed once.
- Password reset revokes all previous center sessions and does not touch student sessions.

**Verification:**

```text
npm.cmd test -- center-auth.service.spec center-auth.controller.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/center-auth.service.ts`, `src/modules/centers/center-auth.controller.ts`, `src/modules/centers/dto/center-auth-request.dto.ts`, two existing center auth specs  
**Estimated scope:** M  
**Dependencies:** Task 8

### Task 10: Add center guard and profile endpoints

**Description:** Add the typed center guard/decorator and `/api/centers/me` read/patch operations. Every update is scoped by signed `centerId` and allowlisted fields.

**Acceptance criteria:**

- Student/guest/malformed/revoked tokens cannot access center profile.
- No request can select or alter another center.
- PATCH updates only supplied allowed fields and requires at least one field.

**Verification:**

```text
npm.cmd test -- center-auth.guard.spec center-profile.controller.spec --runInBand
npm.cmd run build
```

**Files likely touched:** `src/modules/centers/guards/center-auth.guard.ts`, `src/modules/centers/decorators/current-center-user.decorator.ts`, `src/modules/centers/dto/center-profile.dto.ts`, `src/modules/centers/centers.controller.ts`, focused specs  
**Estimated scope:** M  
**Dependencies:** Tasks 6-9

### Checkpoint B: Complete center identity flow

- center registers, verifies, logs in, refreshes, views/updates profile, and logs out;
- revoked session fails on the next protected request;
- three-device limit works;
- student auth and learning regression suite remains green;
- human reviews the complete API before final documentation.

### Task 11: Wire, document, and perform final review

**Description:** Register `CentersModule`, add center API documentation and environment notes, add the critical center identity e2e flow, and run security/code-quality review.

**Acceptance criteria:**

- Swagger describes every Phase 1 endpoint and response.
- An e2e test covers registration through authenticated profile access.
- Full tests, e2e, build, and diff checks pass with no unrelated changes.

**Verification:**

```text
npm.cmd test -- --runInBand --no-coverage
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run lint
git diff --check
```

Because lint uses `--fix`, inspect its diff immediately and revert only unintended formatting through a targeted patch, never a destructive Git command.

**Files likely touched:** `src/app.module.ts`, `test/center-identity.e2e-spec.ts`, `.env.example` only if a new URL variable is truly required, center API documentation  
**Estimated scope:** M  
**Dependencies:** Tasks 1-10

## Branch and Commit Strategy

After this plan is approved:

```text
git status --short --branch
git switch -c feature/center-identity
```

No branch will be created if unrelated tracked changes are present without an explicit preservation decision.

Proposed atomic commits:

```text
feat: add center identity schema
feat: add typed center authentication tokens
feat: add center registration flow
feat: add center login and session rotation
feat: add center password recovery
feat: add authenticated center profile
docs: document center identity API
```

Tests may land with their behavior commit according to TDD; they should not be postponed into one final test-only commit.

## Phase Definition of Done

- Human approved this detailed plan before branch creation.
- Every new behavior was introduced with a failing test first.
- No task expanded beyond its declared scope without updating this plan.
- Center and student identities cannot be confused.
- Generic responses prevent email enumeration.
- Center ownership comes only from signed token context.
- Center sessions rotate and revoke safely.
- Center PII and secrets are not logged or exposed.
- All focused, full, e2e, build, and lint gates pass.
- Code-review and security-review findings are resolved.
- Human approves merge; nothing is pushed or merged automatically.

## Approval Decision

Approve this plan as written, or change one of these defaults before implementation:

1. logo is represented by an HTTPS URL; binary upload is handled outside this backend;
2. center and student accounts may use the same email;
3. a center user may use at most three devices;
4. profile email changes are deferred to a later verified-email-change feature.

