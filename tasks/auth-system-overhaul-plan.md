# Plan - Auth System Overhaul

**Date:** 2026-05-01
**Source:** docs/ideas/auth-system-overhaul.md

## Overview

Replace the current activation-code auth flow with email/password registration, email verification, password reset, and Google ID token login while preserving the existing JWT access/refresh token model, device session tracking, refresh rotation, logout, and profile update behavior.

The current auth surface is small and centralized:
- `src/modules/auth/auth.controller.ts`
- `src/modules/auth/auth.service.ts`
- `src/modules/auth/token.service.ts`
- `src/shared/guards/jwt-auth.guard.ts`
- `prisma/schema.prisma`
- `test/auth.e2e-spec.ts`
- `test/token.service.spec.ts`

That makes this a schema-first rewrite with a narrow service/controller surface, not a new module.

## Confirmed Decisions

1. **`deviceId` required on every token-issuing endpoint.** `login`, `verify-email`, `reset-password`, and `google` all accept `{ deviceId, deviceName? }` and create or upsert a `DeviceSession`. `register` and `forgot-password` do not issue tokens and therefore do not require `deviceId`.

2. **`Student.email` is non-null for new users.** Backfill or remove any legacy null-email rows before running the migration.

3. **Verification and reset tokens are stored as HMAC-SHA256** using a server secret (`TOKEN_HMAC_SECRET` env var). The raw token travels only in the email link; only the HMAC is persisted. Only one active token of each type per account — generating a new one overwrites the previous hash.

4. **Google account linking requires explicit user confirmation.** If a Google login matches an existing email/password account (verified or unverified), return `{ status: "LINKING_REQUIRED", linkingToken: "..." }`. The frontend prompts the user; a second call to `POST /api/auth/google/link` with the `linkingToken` completes the merge. The `linkingToken` is short-lived (10 min, single-use).

5. **Passport local is not needed.** Direct service logic is sufficient.

6. **Duplicate registration always returns a generic success message** to prevent email enumeration. For an existing unverified account, silently resend the verification email (subject to the 2-minute rate-limit). For an existing verified account, do nothing.

7. **Unverified login returns `{ verified: false, message }` with no tokens.** Verification email is resent automatically, subject to a 2-minute cooldown.

8. **Verification tokens are single-use.** After `verifyEmail()` succeeds, clear token fields. If already verified, return idempotent success with a fresh JWT pair.

9. **Source of truth for `email_verified` is always `student.email_verified` in the DB.** Google login sets it to `true` at account creation. Local accounts set it to `true` only after the verification link is clicked.

10. **Password reset runs in a single Prisma transaction:** delete all `DeviceSession` rows + update `password_hash` atomically. After commit, create one new session for the requesting device.

11. **After password reset, upsert the session by `deviceId`** so the same device keeps its identity.

12. **Oldest-session eviction uses earliest `created_at`.** Session creation is wrapped in a serialized transaction to prevent concurrent logins from exceeding the 3-session cap.

13. **Profile updates are allowed before email verification** as long as the JWT is valid.

14. **Auth response shape is slim** — token-issuing endpoints return `{ accessToken, refreshToken, student: { id, firstName, lastName, email, emailVerified } }`. Full student data comes from `GET /api/auth/profile`.

15. **Emails are normalized** (lowercase + trim) at the start of every auth method that accepts an email.

16. **If email sending fails, roll back the token write** and return an error. Never return a false success when the verification or reset email was not delivered.

17. **Backend builds the full clickable URL** in email templates: `${FRONTEND_URL}/verify-email?token=<rawToken>` and `${FRONTEND_URL}/reset-password?token=<rawToken>`.

18. **Error contract** — generic for credential failures, machine-readable codes for branching flows:

| Scenario | HTTP | `code` |
|---|---|---|
| Wrong email or password | 401 | `INVALID_CREDENTIALS` |
| Expired / invalid JWT | 401 | `TOKEN_EXPIRED` / `TOKEN_INVALID` |
| Verification token expired | 400 | `VERIFICATION_TOKEN_EXPIRED` |
| Reset token expired | 400 | `RESET_TOKEN_EXPIRED` |
| Login — email not verified | 403 | `EMAIL_NOT_VERIFIED` |
| Google — linking required | 200 | `LINKING_REQUIRED` |
| Token already used | 400 | `TOKEN_ALREADY_USED` |

## Phase 1 - Schema and Config Foundation

### Step 1: Update Prisma schema

Edit `prisma/schema.prisma` to:
- Make auth-safe student fields explicit:
  - `password_hash` string, nullable
  - `email_verified` boolean default false
  - `email_verification_token` string or `*_hash` equivalent
  - `email_verification_expires` datetime
  - `password_reset_token` string or `*_hash` equivalent
  - `password_reset_expires` datetime
- Add `OAuthAccount` with a unique `(provider, provider_id)` pair.
- Remove legacy activation-code storage if it still exists.
- Ensure `DeviceSession.student_id` is indexed.
- Keep the device-session relation intact for refresh rotation and logout.

Also update any Prisma-generated access patterns that depend on the old student shape.

### Step 2: Reconcile database config

Update `.env.example` and Prisma config so the migration path is explicit:
- Add `GOOGLE_CLIENT_ID`
- Add or confirm `FRONTEND_URL`
- Add or confirm `EMAIL_FROM`
- Change JWT expiry defaults from `1h` / `30d` to `15m` / `7d`
- Reconcile the current `prisma.config.ts` setup with the direct migration URL strategy used in this repo

Current repo note:
- `prisma.config.ts` currently reads only `DATABASE_URL`
- `DIRECT_DATABASE_URL` exists in `.env.example` but is not currently wired in the config shown here
- The plan should include either wiring the direct URL into Prisma config or removing the stale example entry

### Step 3: Replace auth error constants

Update `src/modules/auth/auth.errors.ts`:
- Remove activation-code specific errors
- Add the following machine-readable codes (see decision 18):
  - `INVALID_CREDENTIALS` — wrong email or password (generic, no detail)
  - `EMAIL_NOT_VERIFIED` — login succeeded but account is unverified
  - `VERIFICATION_TOKEN_EXPIRED` — verification link is past expiry
  - `VERIFICATION_TOKEN_INVALID` — token not found in DB
  - `TOKEN_ALREADY_USED` — token was already consumed
  - `RESET_TOKEN_EXPIRED` — reset link is past expiry
  - `RESET_TOKEN_INVALID` — reset token not found
  - `LINKING_REQUIRED` — Google email matches an existing local account
  - `INVALID_GOOGLE_TOKEN` — `google-auth-library` rejected the ID token
  - `DEVICE_LIMIT_EXCEEDED` — only used internally; should not surface to the caller
- Keep the `{ error, message }` shape consistent with the existing exception filter

### Step 4: Update shared interfaces only where required

Review and update shared response interfaces as needed:
- `src/shared/interfaces/student.interface.ts`
- `src/shared/interfaces/token-payload.interface.ts`

Auth response shape (decision 14): token-issuing endpoints return a slim student object — `{ id, firstName, lastName, email, emailVerified }`. Do not expose `password_hash`, session data, or exam history in auth responses. Full student data is served only from `GET /api/auth/profile`.

Token payload shape can stay the same if verified status is enforced by the auth flow before access tokens are issued (only verified students receive tokens).

### Acceptance Criteria - Phase 1

- Prisma schema compiles
- Migration can be generated cleanly
- New auth columns and `OAuthAccount` exist
- Legacy activation-code schema is removed
- `.env.example` reflects the new auth settings and token expiries
- Prisma config and env vars are aligned

## Phase 2 - Auth Primitives and DTOs

### Step 5: Add email delivery support

Add an auth-scoped email service, likely under `src/modules/auth/`.
It should expose:
- `sendVerificationEmail(to, rawToken)` — builds `${FRONTEND_URL}/verify-email?token=<rawToken>`
- `sendPasswordResetEmail(to, rawToken)` — builds `${FRONTEND_URL}/reset-password?token=<rawToken>`

Backend constructs the full clickable URL (decision 17). `FRONTEND_URL` is an env var.

**Failure contract (decision 16):** if Resend throws, the calling service method must roll back the token write (via the Prisma transaction) and propagate an error. Never return success when the email was not sent. Log the Resend error for alerting.

Keep it small and specific to auth unless another module needs the same emails later.

### Step 6: Add token helpers for hashed reset and verification tokens

Use Node `crypto` to generate and hash verification and reset tokens before storage. Do not use bcrypt here — tokens are random secrets, not passwords.

**Algorithm (decision 3/17):** HMAC-SHA256 keyed with `process.env.TOKEN_HMAC_SECRET`. Example:
```ts
crypto.createHmac('sha256', process.env.TOKEN_HMAC_SECRET).update(rawToken).digest('hex')
```

The helper must support:
- `generateToken()` — cryptographically random token (e.g. `crypto.randomBytes(32).toString('hex')`)
- `hashToken(raw)` — returns HMAC-SHA256 hex string
- `timingSafeEqual(a, b)` — constant-time comparison for any case where you compare outside the DB lookup
- `isExpired(expiresAt)` — simple date check

**One active token per type (decision 18):** storing a new hash overwrites the previous one. There is no array of outstanding tokens — just a single `email_verification_token` and `password_reset_token` column per student.

### Step 7: Add auth DTOs

Create request/response DTOs for:
- `register`
- `login`
- `verify-email`
- `forgot-password`
- `reset-password`
- `google`

Expected request shapes in the implementation plan:
- `register`: `{ firstName, lastName, email, password }`
- `login`: `{ email, password, deviceId, deviceName? }`
- `verify-email`: `{ token, deviceId, deviceName? }`
- `forgot-password`: `{ email }`
- `reset-password`: `{ token, newPassword, deviceId, deviceName? }`
- `google`: `{ idToken, deviceId, deviceName? }`

Note:
- `register` does not create a session
- Any endpoint that returns a token pair must have device context available

### Step 8: Update TokenService defaults

Edit `src/modules/auth/token.service.ts`:
- Change default access token expiry to `15m`
- Change default refresh token expiry to `7d`
- Keep the token payload shape stable unless a later decision requires a new claim

### Acceptance Criteria - Phase 2

- New DTOs exist with validation decorators
- Email service is available to the auth module
- Token expiry defaults match the new security target
- Token hashing helper is covered by unit tests

## Phase 3 - Auth Flow Rewrite

### Step 9: Implement registration

Add `register()` to `AuthService` and expose `POST /api/auth/register`.
Behavior:
- **Normalize email** — lowercase + trim before any lookup or write (decision 15/21)
- Validate input; hash password with bcrypt
- Generate a raw token, compute its HMAC, store the hash + expiry
- Wrap the DB write and `sendVerificationEmail()` in a Prisma transaction — if email sending fails, roll back and return a 502 (decision 16)
- Always return `{ message: 'verification email sent' }` regardless of outcome (decision 2)

**Duplicate email handling (decisions 2, 3, 6):**
- If the email exists and the account is **unverified**: overwrite the existing token hash + expiry, resend — subject to the 2-minute rate-limit (check `last_verification_sent_at` or `email_verification_expires` window). Return the same generic success.
- If the email exists and the account is **verified**: do nothing silently. Return the same generic success. No error, no leak.

### Step 10: Implement email verification

Add `verifyEmail()` and expose `POST /api/auth/verify-email`.
Behavior:
- Hash the incoming raw token and look up the student by the stored HMAC hash
- Return `VERIFICATION_TOKEN_INVALID` if not found; `VERIFICATION_TOKEN_EXPIRED` if past expiry
- **Single-use (decision 4/8):** on success, immediately set `email_verification_token = null` and `email_verification_expires = null`
- Set `email_verified = true` — this is the only place a local account gains verified status (decision 7/9)
- Upsert a `DeviceSession` for the supplied `deviceId` (decision 1)
- Return slim JWT pair + student response (decision 14)

**Idempotency (decision 4/8):** if `student.email_verified` is already `true` when the request arrives, skip the token check, create/upsert the device session, and return a fresh JWT pair with HTTP 200.

### Step 11: Implement login

Add `login()` and expose `POST /api/auth/login`.
Behavior:
- **Normalize email** (decision 15/21)
- If credentials are invalid (email not found or bcrypt mismatch), return `INVALID_CREDENTIALS` — same response in both cases, no enumeration
- If the student is not verified (decision 5/6/7):
  - Do **not** issue tokens
  - Return HTTP 403 `{ code: 'EMAIL_NOT_VERIFIED', verified: false, message: 'Please verify your email to continue.' }`
  - Resend verification email automatically **only if** the last send was more than **2 minutes ago** (check `email_verification_expires`; if the token was issued within the last 2 min, skip the resend silently)
- If the student is verified:
  - Enforce the 3-session cap via oldest-session eviction (see step 15)
  - Upsert `DeviceSession` for the supplied `deviceId`
  - Return slim JWT pair + student response (decision 14)

### Step 12: Implement forgot password

Add `forgotPassword()` and expose `POST /api/auth/forgot-password`.
Behavior:
- **Normalize email** (decision 15/21)
- Always return `{ message: 'If that email exists, a reset link was sent.' }` — no enumeration
- If the email exists: overwrite `password_reset_token` (HMAC) + `password_reset_expires` (1h), invalidating any prior token (decision 18)
- Wrap DB write + `sendPasswordResetEmail()` in a transaction — roll back on mail failure (decision 16)
- No rate-limit required here beyond what Resend's own throttle provides

### Step 13: Implement reset password

Add `resetPassword()` and expose `POST /api/auth/reset-password`.
Behavior:
- Hash the incoming raw token and look up the student by HMAC hash
- Return `RESET_TOKEN_INVALID` if not found; `RESET_TOKEN_EXPIRED` if past expiry
- **Single Prisma transaction (decision 8):** within one `$transaction`:
  1. Delete all `DeviceSession` rows for the student
  2. Update `password_hash` with the bcrypt hash of `newPassword`
  3. Clear `password_reset_token` and `password_reset_expires`
- After the transaction commits, **upsert one new `DeviceSession`** for the `deviceId` from the request (decision 9/11) — if that device had an old session, it is now recreated cleanly
- Enforce the 3-session cap (only one session exists post-reset so cap is never at risk here)
- Return slim JWT pair + student response (decision 14)

### Step 14: Implement Google login

Add `googleLogin()` and expose `POST /api/auth/google`. Add `googleLink()` and expose `POST /api/auth/google/link`.

**`googleLogin()` behavior:**
- Verify the Google ID token with `google-auth-library` against `GOOGLE_CLIENT_ID`. Return `INVALID_GOOGLE_TOKEN` on failure.
- **Normalize** the email from the Google payload (decision 15/21)
- **Set `email_verified = true`** unconditionally — Google controls that email (decision 7/9)
- Lookup path:
  1. If an `OAuthAccount` row exists for `(provider='google', provider_id=sub)` → this is a returning Google user; find their student, upsert session, return tokens
  2. If no `OAuthAccount` but a `Student` exists with the same email (verified **or** unverified) → return `{ status: 'LINKING_REQUIRED', linkingToken: '<signed 10-min token>' }` (decisions 13/14)
  3. If no match → create `Student` with `email_verified = true` + `OAuthAccount` row, upsert session, return tokens (decision 12)
- After resolving the student, enforce 3-session cap (step 15) and upsert `DeviceSession`
- Return slim JWT pair + student response (decision 14)
- Both password auth and Google auth can coexist on the same account (decision 22)

**`googleLink()` behavior:**
- Accept `{ linkingToken, deviceId, deviceName? }`
- Validate and consume the `linkingToken` (single-use, 10 min)
- Extract the `studentId` and Google `sub` encoded in the token
- Create the `OAuthAccount` row linking Google to the existing student
- Set `student.email_verified = true` (decision 7)
- Upsert `DeviceSession`, return slim JWT pair + student response

### Step 15: Update device session behavior

Edit the session-management logic in `src/modules/auth/auth.service.ts`.

**Upsert by `deviceId` (decisions 9/11):** use `upsert` on `deviceId` rather than always inserting. This keeps device identity stable across re-logins and password resets.

**Oldest-session eviction (decisions 10/11):** wrap the following in a `$transaction` to prevent race conditions:
1. Count active sessions for the student
2. If count >= 3, delete the session with the earliest `created_at`
3. Upsert the new/current session

Using `created_at` for eviction is deterministic and immune to refresh-rotation timestamp noise.

Keep refresh-token hashing and rotation behavior unchanged.

### Step 16: Update JwtAuthGuard only if required by the final flow

Current guard behavior only validates the token signature.

**Decision (13):** profile updates and similar low-risk mutations are allowed for any valid JWT, regardless of `email_verified`. Only exam/speaking routes need the verified gate.

Preferred plan outcome:
- Only verified students receive access tokens (the auth flow enforces this at issue time)
- If that invariant holds, the guard stays simple — no DB lookup needed in the guard itself
- If there is any path that issues tokens to unverified students, add an `email_verified` claim to the JWT payload and check it in the guard for protected routes only

### Step 17: Update controller wiring

Edit `src/modules/auth/auth.controller.ts` to:
- Remove activation endpoints
- Add the new endpoints
- Keep refresh, logout, and profile update behavior unchanged

### Step 18: Update auth module providers

Edit `src/modules/auth/auth.module.ts` to register any new providers introduced by the email or Google verification flow.

### Acceptance Criteria - Phase 3

- All new endpoints exist and return the expected contract
- Activation-code endpoints are gone
- Device-limit behavior matches the new decision
- Login, verification, password reset, and Google login all create stable device sessions
- Refresh rotation and logout still work unchanged

## Phase 4 - Tests and Verification

### Step 19: Rewrite auth e2e coverage

Update `test/auth.e2e-spec.ts` to cover the new API surface.
Remove the old activation-code assertions and replace them with:
- register
- verify-email
- login
- forgot-password
- reset-password
- google
- refresh
- logout
- profile update

### Step 20: Add or expand auth unit tests

Create `test/auth.service.spec.ts` if it does not exist yet.
Cover:
- register success path
- duplicate register handling
- verification token success and idempotency
- login verified vs unverified
- forgot-password generic response
- reset-password session revocation
- Google linking and new-user creation
- device-limit eviction behavior

### Step 21: Update token tests

Extend `test/token.service.spec.ts` to confirm:
- new expiry defaults are applied
- token payload shape is still correct
- refresh rotation behavior still works

### Step 22: Add guard coverage if the guard changes

If `JwtAuthGuard` gets DB-backed verification logic, add a focused guard test file for:
- missing bearer token
- invalid bearer token
- unverified student rejection
- verified student acceptance

### Step 23: Run validation after each slice

Recommended validation order:
1. `npm run prisma:generate`
2. `npm run build`
3. `npm test -- token.service.spec.ts`
4. `npm test -- auth.service.spec.ts`
5. `npm test -- auth.e2e-spec.ts`
6. `npm run test:cov`

If schema work changes the migration shape, validate the DB migration before moving on to service changes.

### Final Acceptance Criteria

- No activation-code DTOs, endpoints, or error codes remain in the auth flow
- Email/password registration works
- Email verification is idempotent
- Unverified login does not issue a usable session
- Password reset revokes all active sessions
- Google login verifies ID tokens and supports explicit account linking
- Device limit is enforced by oldest-session eviction
- Refresh and logout behavior remain intact
- Tests cover the new business rules and edge cases
- Build and test commands pass

## Notes and Risks

- `deviceId` is now confirmed required on all token-issuing endpoints. DTOs must validate it.
- Migration/backfill for any legacy null-email student rows must happen before the schema migration runs.
- Password reset and session-cap eviction both require `$transaction` — missing this is a data-integrity risk.
- The `LINKING_REQUIRED` flow introduces a short-lived `linkingToken`. Use the existing JWT infrastructure (short expiry, signed with `JWT_SECRET`) to avoid adding a separate token store.
- `TOKEN_HMAC_SECRET` must be added to `.env.example` and documented. Losing it invalidates all outstanding verification and reset tokens.
- Avoid adding Passport strategies unless the direct-service approach becomes impractical.
