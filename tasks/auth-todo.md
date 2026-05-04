# Todo — Auth System Overhaul

> Spec: SPEC-auth.md | Detailed plan: tasks/auth-plan.md

---

## Task 1 — Foundation

- [x] `npm install google-auth-library resend` — verify both appear in `package.json`
- [x] Update `prisma/schema.prisma`: add `password_hash`, `email_verified`, `email_verification_token`, `email_verification_expires`, `password_reset_token`, `password_reset_expires` to `Student`
- [x] Update `prisma/schema.prisma`: add `OAuthAccount` model with `@@unique([provider, provider_id])` and `@@index([student_id])`
- [x] Update `prisma/schema.prisma`: confirm `DeviceSession` has `@@index([student_id])` and `@@unique([device_id])`
- [x] Update `.env.example`: add `TOKEN_HMAC_SECRET`, `GOOGLE_CLIENT_ID`, `FRONTEND_URL`, update `JWT_ACCESS_TOKEN_EXPIRY=15m` and `JWT_REFRESH_TOKEN_EXPIRY=7d`
- [x] Rewrite `src/modules/auth/auth.errors.ts`: remove activation-code codes, add all new machine-readable codes from SPEC §8
- [x] Add `AuthStudentResponse` interface to `src/shared/interfaces/student.interface.ts`

### ✦ CHECKPOINT 1 — `npm run prisma:generate && npm run build` exits 0

---

## Task 2 — Shared Primitives

- [x] Create `src/modules/auth/token-crypto.service.ts` — `generateToken()`, `hashToken(raw)` (HMAC-SHA256), `isExpired(date)`
- [x] Create `src/modules/auth/email.service.ts` — `sendVerificationEmail(to, rawToken)` and `sendPasswordResetEmail(to, rawToken)` using Resend; build full `FRONTEND_URL` link internally
- [x] Create `src/modules/auth/google.service.ts` — `verifyIdToken(idToken): GooglePayload`; normalizes email; throws `INVALID_GOOGLE_TOKEN` on failure
- [x] Update `src/modules/auth/token.service.ts`: change access token expiry to `15m`, refresh token expiry to `7d`
- [x] Create `test/token-crypto.service.spec.ts`: cover `generateToken` (random, 64-char hex), `hashToken` (deterministic, different inputs → different output), `isExpired` (past → true, future → false)

### ✦ CHECKPOINT 2 — `npm test -- --testPathPatterns=token-crypto` passes; `npm run build` exits 0

---

## Task 3 — Device Session Infrastructure

- [x] Add `upsertDeviceSession(studentId, deviceId, refreshTokenHash, deviceName?)` to `AuthService` — inside a single `$transaction`: count active sessions → evict earliest `created_at` if count >= 3 → upsert on `device_id`
- [x] Add unit tests in `test/auth.service.spec.ts` for `upsertDeviceSession`: creates when count < 3; evicts oldest when count = 3; reuses existing `device_id`; runs in `$transaction`

### ✦ CHECKPOINT 3 — device session unit tests pass; `npm run build` exits 0

---

## Task 4 — Register + VerifyEmail (Slice A)

- [x] Create `src/modules/auth/dto/register-request.dto.ts` — `firstName`, `lastName`, `email` (`@Transform` lowercase+trim, `@IsEmail`), `password` (`@MinLength(8)`)
- [x] Create `src/modules/auth/dto/verify-email-request.dto.ts` — `token`, `deviceId`, `deviceName?`
- [x] Create `src/modules/auth/dto/auth-response.dto.ts` — `AuthTokenResponse` interface with `accessToken`, `refreshToken`, `student: AuthStudentResponse`
- [x] Implement `AuthService.register()`: generic success always; new student → bcrypt + HMAC token + `$transaction`(create + email); existing unverified → resend if > 2 min; existing verified → no-op
- [x] Implement `AuthService.verifyEmail()`: HMAC lookup → idempotent if already verified → single-use clear → set `email_verified = true` → `upsertDeviceSession` → return token pair
- [x] Wire `POST /api/auth/register` and `POST /api/auth/verify-email` in `auth.controller.ts`
- [x] Unit tests in `auth.service.spec.ts` — `register`: 5 cases; `verifyEmail`: 4 cases (see plan)
- [x] E2E tests in `auth.e2e-spec.ts` — `register`: 3 cases; `verify-email`: 4 cases (see plan)

### ✦ CHECKPOINT 4 — Slice A e2e tests pass; existing refresh/logout tests still pass

---

## Task 5 — Login (Slice B)

- [x] Create `src/modules/auth/dto/login-request.dto.ts` — `email` (`@Transform`), `password`, `deviceId`, `deviceName?`
- [x] Implement `AuthService.login()`: `INVALID_CREDENTIALS` for bad creds (no enumeration); 403 `EMAIL_NOT_VERIFIED` for unverified + auto-resend if > 2 min; verified → `upsertDeviceSession` → token pair
- [x] Wire `POST /api/auth/login` in `auth.controller.ts`
- [x] Unit tests — `login`: 6 cases (see plan)
- [x] E2E tests — `login`: 4 cases (see plan)

### ✦ CHECKPOINT 5 — Slice B e2e tests pass; prior slices still pass

---

## Task 6 — Forgot Password + Reset Password (Slice C)

- [x] Create `src/modules/auth/dto/forgot-password-request.dto.ts` — `email` (`@Transform`)
- [x] Create `src/modules/auth/dto/reset-password-request.dto.ts` — `token`, `newPassword` (`@MinLength(8)`), `deviceId`, `deviceName?`
- [x] Implement `AuthService.forgotPassword()`: generic success always; if email exists → overwrite reset token (HMAC) + expiry in `$transaction` + send email
- [x] Implement `AuthService.resetPassword()`: HMAC lookup → `RESET_TOKEN_INVALID` / `RESET_TOKEN_EXPIRED`; `$transaction`(delete all sessions + bcrypt new password + clear token fields); then `upsertDeviceSession`; return token pair
- [x] Wire `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` in `auth.controller.ts`
- [x] Unit tests — `forgotPassword`: 4 cases; `resetPassword`: 4 cases (see plan)
- [x] E2E tests — `forgot-password`: 2 cases; `reset-password`: 3 cases (see plan)
- [x] Task 6 completed and validated

### ✦ CHECKPOINT 6 — Slice C e2e tests pass; prior slices still pass

---

## Task 7 — Google OAuth (Slice D)

- [x] Create `src/modules/auth/dto/google-login-request.dto.ts` — `idToken`, `deviceId`, `deviceName?`
- [x] Create `src/modules/auth/dto/google-link-request.dto.ts` — `linkingToken`, `deviceId`, `deviceName?`
- [x] Implement `AuthService.googleLogin()`: verify token → lookup path (returning / LINKING_REQUIRED / new user) → `upsertDeviceSession` → return token pair or `{ status: 'LINKING_REQUIRED', linkingToken }`
- [x] Implement `AuthService.googleLink()`: verify + consume `linkingToken` JWT → create `OAuthAccount` → set `email_verified = true` → `upsertDeviceSession` → return token pair
- [x] Wire `POST /api/auth/google` and `POST /api/auth/google/link` in `auth.controller.ts`
- [x] Unit tests — `googleLogin`: 5 cases; `googleLink`: 3 cases (see plan)
- [x] E2E tests — `google`: 3 cases; `google/link`: 2 cases (see plan)

### ✦ CHECKPOINT 7 — Slice D e2e tests pass; prior slices still pass

---

## Task 8 — Final Wiring + Validation

- [x] Update `src/modules/auth/auth.module.ts`: register `TokenCryptoService`, `EmailService`, `GoogleService` as providers
- [x] Confirm no activation-code routes, DTOs, or error codes remain anywhere in `src/modules/auth/`
- [x] Extend `test/token.service.spec.ts`: assert new 15m/7d expiry defaults
- [x] Run full validation sequence:
  - `npm run prisma:generate`
  - `npm run build`
  - `npm test`
  - _(e2e requires live DB — run manually against staging)_
  - `npm run test:cov`
- [x] Confirm all final acceptance criteria from SPEC §6 are met

### ✦ CHECKPOINT 8 (FINAL) — All tests pass, no activation code remains, build is clean
