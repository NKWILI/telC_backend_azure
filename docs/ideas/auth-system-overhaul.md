# Auth System Overhaul

## Problem Statement
How might we replace the activation-code-only auth with a standard email/password + Google OAuth system that any student can self-register into — across Flutter mobile (iOS/Android) and Flutter web?

## Recommended Direction
**Flutter-first mobile approach: custom auth + Google ID Token verification on the backend.**

Keep what works: JWT access/refresh tokens, device session management (max 3 devices), bcrypt hashing, token rotation on refresh, `POST /api/auth/refresh`, `POST /api/auth/logout`.

Replace what doesn't: activation codes → email/password registration with email verification + Google OAuth via Flutter's `google_sign_in` package.

**Why not Passport.js OAuth redirects?** That's a web browser pattern (redirect → callback URL). Flutter uses `google_sign_in` natively — it handles the Google popup/sheet on the device and returns a Google ID Token directly to Flutter. Flutter then POSTs that token to the backend. No redirects needed. Works identically on iOS, Android, and Flutter web.

**Why not Clerk or Neon Auth?** Clerk is vendor lock-in — if pricing changes, auth goes down. Neon Auth has no Flutter SDK. The building blocks (JWT, bcrypt, Prisma) are already in place.

**Apple OAuth**: skipped for now — requires Apple Developer account ($99/yr). Add in a future sprint.

---

## What Gets REMOVED (✅ DONE)

| Removed | Replaced by |
|---------|-------------|
| `POST /api/auth/activate` | `POST /api/auth/register` |
| `POST /api/auth/login-with-code` | `POST /api/auth/login` |
| `ActivationCode` Prisma model | `OAuthAccount` Prisma model |
| `Student.activation_code` field | `Student.password_hash` + `Student.email_verified` |
| `Student.is_registered` field | `Student.email_verified` |

**Activation code system has been deleted from the codebase** (branch `feat/auth-system`):
- Deleted DTOs: `activate-request.dto.ts`, `activate-response.dto.ts`, `login-with-code-request.dto.ts`
- Removed `validateActivationCode()`, `createStudent()`, `loginWithActivationCode()`, `checkMembershipExpiry()`, `getActivationCodeExpiry()` from `AuthService`
- Removed `POST /api/auth/activate` and `POST /api/auth/login-with-code` endpoints from `AuthController`
- Removed `ActivationCode` model and `Student.activation_code`, `Student.is_registered` from Prisma schema
- Removed `isRegistered` from JWT access token payload
- Removed activation code validation from `SpeakingGateway`
- All 14 test suites passing after cleanup

---

## New Endpoints

### Registration & Email Verification
- `POST /api/auth/register` — `{ firstName, lastName, email, password }` → hashes password, sends verification email via Resend, returns `{ message: 'verification email sent' }`
- `POST /api/auth/verify-email` — `{ token }` → marks email as verified, returns JWT token pair. **Idempotent**: if the email is already verified (user clicked the link twice), return success and a fresh JWT pair — do not error.

### Login
- `POST /api/auth/login` — `{ email, password }` → verifies password hash, returns JWT token pair

### Forgot Password
- `POST /api/auth/forgot-password` — `{ email }` → sends reset link via Resend (token expires in 1h)
- `POST /api/auth/reset-password` — `{ token, newPassword }` → resets password, revokes all active device sessions, returns JWT token pair

### Google OAuth (Flutter-first — no server redirect)
- `POST /api/auth/google` — `{ idToken }` → Flutter sends the Google ID Token it received from `google_sign_in` package → backend verifies with `google-auth-library` → creates or finds student → returns JWT token pair

### Unchanged
- `POST /api/auth/refresh` — same token rotation logic
- `POST /api/auth/logout` — same device session revocation
- `PATCH /api/auth/profile` — same profile update

---

## How Flutter Calls These Endpoints

```
EMAIL/PASSWORD REGISTER:
Flutter → POST /api/auth/register { firstName, lastName, email, password }
        ← { message: 'verification email sent' }
User checks email → clicks link → Flutter opens link
Flutter → POST /api/auth/verify-email { token }
        ← { accessToken, refreshToken, student }

EMAIL/PASSWORD LOGIN:
Flutter → POST /api/auth/login { email, password }
        ← { accessToken, refreshToken, student }

GOOGLE LOGIN (any Flutter platform):
Flutter calls google_sign_in → gets idToken
Flutter → POST /api/auth/google { idToken }
        ← { accessToken, refreshToken, student }

FORGOT PASSWORD:
Flutter → POST /api/auth/forgot-password { email }
        ← { message: 'reset email sent' }
User checks email → clicks link (opens app via deep link on mobile, URL on web)
Flutter → POST /api/auth/reset-password { token, newPassword }
        ← { accessToken, refreshToken, student }
```

---

## Database Changes (Prisma)

### Student model — updated
```prisma
model Student {
  id                          String    @id @default(uuid())
  first_name                  String?
  last_name                   String?
  email                       String    @unique
  password_hash               String?         // null for Google-only users
  email_verified              Boolean   @default(false)
  email_verification_token    String?
  email_verification_expires  DateTime?
  password_reset_token        String?
  password_reset_expires      DateTime?
  created_at                  DateTime  @default(now())
  updated_at                  DateTime  @default(now())
  last_seen_at                DateTime  @default(now())

  device_sessions DeviceSession[]
  oauth_accounts  OAuthAccount[]
  exam_sessions   ExamSession[]
  lesen_sessions  LesenSession[]

  @@index([email])
  @@map("students")
}
```

### New OAuthAccount model
```prisma
model OAuthAccount {
  id          String  @id @default(uuid())
  student_id  String
  provider    String  // 'google' (apple: future)
  provider_id String  // the user's sub/id from Google
  email       String?

  student Student @relation(fields: [student_id], references: [id], onDelete: Cascade)

  @@unique([provider, provider_id])
  @@index([student_id])
  @@map("oauth_accounts")
}
```

### Remove entirely
- `ActivationCode` model
- `Student.activation_code` field
- `Student.is_registered` field

---

## New Packages

```bash
# Backend
npm install google-auth-library    # verify Google ID tokens Flutter sends
npm install resend                 # send verification + reset emails
npm install @nestjs/passport passport passport-local
npm install @types/passport-local --save-dev
```

Flutter team installs (frontend — not your concern):
```
google_sign_in: ^6.0.0   # handles Google on iOS, Android, web
```

---

## New Environment Variables

```env
# Google OAuth — get from Google Cloud Console
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

# App URLs
APP_URL=https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net
FRONTEND_URL=https://your-flutter-web-url.com   # for reset password links

# Email — Resend (already in .env, already working)
EMAIL_FROM=noreply@yourdomain.com
```

---

## Key Assumptions
- [x] Flutter is cross-platform (iOS, Android, web) — confirmed
- [x] Resend API is configured and working — confirmed
- [x] Apple OAuth skipped for now — confirmed
- [x] No password linking for Google users — confirmed
- [ ] Resend sender domain is verified (can send from EMAIL_FROM address)
- [ ] Google Cloud Console project exists with OAuth 2.0 credentials created
- [ ] Flutter team will integrate `google_sign_in` on their side

---

## Implementation Order

```
Step 1 — Prisma migration
         - Drop ActivationCode model
         - Update Student model (add password_hash, email_verified, reset fields)
         - Add OAuthAccount model
         - Add @@index on Student.email, DeviceSession.student_id

Step 2 — Email service (Resend)
         - EmailService with sendVerificationEmail() and sendPasswordResetEmail()
         - HTML email templates

Step 3 — AuthService rewrite
         - register() — hash password, generate verification token, send email
         - verifyEmail() — validate token, mark verified, return JWT pair
         - login() — validate email+password, return JWT pair
         - forgotPassword() — generate reset token, send email
         - resetPassword() — validate token, hash new password, revoke sessions

Step 4 — Google OAuth service
         - verifyGoogleToken() — validate idToken with google-auth-library
         - findOrCreateGoogleUser() — upsert OAuthAccount + Student

Step 5 — Update JwtAuthGuard
         - Replace membership expiry check with email_verified check
         - Verified students only can access protected routes

Step 6 — Update auth.controller.ts
         - Remove: /activate, /login-with-code
         - Add: /register, /verify-email, /login, /forgot-password, /reset-password, /google

Step 7 — Update .env.example + schema.prisma directUrl

Step 8 — Tests for each new service method
```

---

## Design Decisions (Edge Cases)

### 1. Reset Password — Session Revocation Scope
**Question:** Should `resetPassword()` revoke all sessions or just the current one?

| Option | Description |
|--------|-------------|
| A ✅ | Revoke **all** active device sessions |
| B | Revoke only the session that triggered the reset |

**Decision: A — revoke all sessions.**
Password reset implies potential compromise. Force every device to re-authenticate.

---

### 2. Google Account Linking — Same Email Already Exists
**Question:** User registers with `john@gmail.com`, then later logs in via Google with the same email. What happens?

| Option | Description |
|--------|-------------|
| A | Create a new duplicate account ❌ |
| B | Link Google to existing account automatically |
| C | Reject the Google login |
| D ✅ | Ask user to confirm linking |

**Decision: D — ask for confirmation before linking.**
Option B is an account takeover vector (attacker could own the Google account). Explicit confirmation is safe and clear.

---

### 3. Email Not Verified — Login Attempt
**Question:** User registered but never clicked the verification link. Can they log in?

| Option | Description |
|--------|-------------|
| A | Allow login but restrict API access |
| B | Block login entirely |
| C ✅ | Allow login but return `{ verified: false }` + auto-resend verification email |
| D | Allow everything ❌ |

**Decision: C — allow login, surface unverified state, resend automatically.**
Best balance of UX and security. User can still recover without re-registering.

---

### 4. Refresh Token Rotation — Race Condition
**Question:** Two refresh requests arrive simultaneously (double-tap / network retry). What happens?

| Option | Description |
|--------|-------------|
| A | Accept both |
| B ✅ | Accept first, reject second |
| C | Invalidate session entirely (too aggressive) |
| D | Allow multiple valid refresh tokens |

**Decision: B — first refresh wins, second gets `INVALID_REFRESH_TOKEN`.**
Standard secure approach. The rotated token from the first request is valid; the old token used by the second is already invalidated.

---

### 5. Device Limit — 4th Device Logs In
**Question:** Student already has 3 active sessions (phone, laptop, tablet) and logs in on a new phone.

| Option | Description |
|--------|-------------|
| A | Reject the new login |
| B ✅ | Automatically remove the oldest session |
| C | Ask user which device to remove |
| D | Allow temporarily |

**Decision: B — silently evict the oldest session.**
Simple, automatic, and matches the UX of services like Netflix/Spotify. No friction for the user.

---

### 6. Google ID Token — `email_verified: false`
**Question:** `google-auth-library` returns a valid token but `email_verified` is `false`. Accept or reject?

| Option | Description |
|--------|-------------|
| A | Allow login anyway |
| B | Reject login |
| C ✅ | Accept and set `email_verified = true` automatically |
| D | Ask user to verify manually |

**Decision: C — trust Google.**
Google controls the email address — if Google issued the token, the email is effectively verified. Industry standard (used by Auth0, Firebase). Setting `email_verified = true` avoids blocking the user unnecessarily.

---

### 7. Token Expiration Strategy
**Question:** How long should access and refresh tokens live?

| Option | Access Token | Refresh Token |
|--------|-------------|---------------|
| A ✅ | 15 minutes | 7 days |
| B | 1 hour | 30 days |
| C | 5 minutes | 1 day |
| D | 24 hours | 90 days ❌ |

**Decision: A — 15 min access / 7 day refresh.**
Secure and balanced. Short access token limits damage from token leak. 7-day refresh is reasonable for a study app (students use it regularly). The existing `JWT_ACCESS_TOKEN_EXPIRY` / `JWT_REFRESH_TOKEN_EXPIRY` env vars make this configurable without code changes.

> **Action required:** Update `.env.example` defaults from `1h` / `30d` → `15m` / `7d`.

---

### 8. Email Token Storage — Verification & Reset Tokens
**Question:** Should `email_verification_token` and `password_reset_token` be stored raw or hashed in the DB?

| Option | Description |
|--------|-------------|
| A | Store raw ❌ |
| B ✅ | Store hashed (bcrypt or SHA-256) |
| C | Store encrypted |
| D | Store nothing |

**Decision: B — hash tokens before storing.**
A DB leak would expose raw tokens, allowing an attacker to verify emails or reset passwords without the user's email access. Hash with SHA-256 (fast is fine here — tokens are random, not passwords).

---

### 9. Double Register — Race Condition
**Question:** User double-clicks register or network retries the request. What happens?

| Option | Description |
|--------|-------------|
| A | Create two users ❌ |
| B ✅ | Fail second request gracefully |
| C | Merge requests |
| D | Overwrite first |

**Decision: B — unique email constraint catches the duplicate.**
`Student.email` has `@unique` in Prisma. The second request hits a unique constraint violation. Catch it and return `{ message: 'verification email sent' }` (same response as success) — no information leak about whether the email is already registered.

---

- **Apple OAuth** — no Apple Developer account. Add in next sprint.
- **Passport.js OAuth redirect flow** — wrong pattern for Flutter. Flutter uses `google_sign_in` natively.
- **Clerk / Neon Auth** — vendor lock-in or no Flutter SDK. Building blocks already exist.
- **Facebook OAuth** — declining usage, adds scope. Google covers 95% of cases.
- **Magic link login** — adds scope. Email+password covers the need.
- **2FA / TOTP** — future sprint.
- **Account deletion (GDPR)** — future sprint.
- **Password linking for Google users** — confirmed not needed.
- **Keeping activation codes alongside new auth** — two systems = two codebases. Clean break confirmed.

---

### 10. `deviceId` Requirement on Token-Issuing Endpoints

**Decision: A — require `deviceId` on every token-issuing endpoint** (register/verify-email, login, reset-password, google).

Every endpoint that returns an access+refresh token pair must also create or update a `DeviceSession`. Without a `deviceId`, the session cannot be tracked, and refresh rotation and logout become ambiguous. All token-issuing endpoints (`verify-email`, `login`, `reset-password`, `google`) must accept `deviceId` in the request body.

---

### 11. Duplicate Registration — Response Strategy

**Decision: A — always return the same generic success message.**

If the email already exists, return `{ message: 'verification email sent' }` regardless of whether the account is verified or not. This prevents email enumeration. For existing **unverified** accounts, silently resend the verification email. For existing **verified** accounts, do nothing (the response still says "sent" — no leaking of account state).

---

### 12. Resend Verification Email on Duplicate Register

**Decision: A — resend verification email for existing unverified accounts.**

When a duplicate `register` request arrives for an unverified email, generate a new token (invalidating the old one) and resend. This gives the user a recovery path without needing support. Apply the same rate-limit cooldown as login (see decision 14).

---

### 13. Email Verification Token Invalidation

**Decision: A — tokens are single-use; invalidated immediately after successful verification. Generating a new token also invalidates all prior tokens of the same type.**

After `verifyEmail()` succeeds, set `email_verification_token = null` and `email_verification_expires = null`. If the same link is clicked a second time, the token lookup returns nothing — treat it as already-verified and return a fresh JWT pair (idempotent success, as specified). If a new verification email is sent, overwrite the existing token fields first.

---

### 14. Unverified Login — Response Body

**Decision: A — return only `{ verified: false }` plus a generic message.**

When a login succeeds but `email_verified = false`, return:
```json
{ "verified": false, "message": "Please verify your email to continue." }
```
No tokens are issued. The frontend is responsible for its own UX copy. Do not expose user identity fields in this response.

---

### 15. Unverified Login — Verification Email Rate-Limit

**Decision: B — resend only if the last email was sent more than 2 minutes ago.**

A 2-minute cooldown (stored via `email_verification_expires` / a separate `last_verification_sent_at` field or by checking whether the current token was generated within the window) prevents inbox spamming while keeping UX smooth. From a UX perspective, 2 minutes is short enough that a user who did not receive the email will not wait long to retry, but long enough to absorb accidental double-submits and abuse patterns.

---

### 16. Source of Truth for `email_verified`

**Decision: C — DB is the single source of truth; Google login sets `email_verified = true` at account creation.**

Local accounts: `student.email_verified` is set to `true` only after the user clicks the verification link.
Google accounts: at `findOrCreateGoogleUser()` time, set `email_verified = true` unconditionally (Google already controls that email). Once written to the DB, all subsequent checks go through `student.email_verified` regardless of auth method — no runtime forking between Google/local logic.

---

### 17. Password Reset — Atomicity of Session Revocation and Password Update

**Decision: C — wrap both operations in a single Prisma transaction.**

Delete all `DeviceSession` rows and update `password_hash` in the same transaction. If either fails, the entire operation rolls back. This prevents a half-reset state (sessions killed but password unchanged, or vice versa). After the transaction commits, create one new `DeviceSession` for the requesting device and issue a new token pair.

---

### 18. Password Reset — Session Reuse by `deviceId`

**Decision: A — after reset, upsert the session for the matching `deviceId` rather than always creating new.**

When `resetPassword()` runs: revoke all sessions (in the transaction), then create exactly one new `DeviceSession` for the `deviceId` that came with the reset request. If that `deviceId` was previously known, the same device slot is reclaimed. This keeps device identity stable and fits the 3-session cap cleanly.

---

### 19. Oldest-Session Eviction — Definition of "Oldest"

**Decision: A — evict the session with the earliest `created_at`.**

Using `created_at` is deterministic and immune to refresh-rotation timestamp noise (`updated_at` changes on every refresh). A session with the earliest creation date is the longest-lived one, which is a reasonable proxy for "least likely to be actively needed." Implementation: before inserting the new session, `DELETE FROM device_sessions WHERE student_id = $1 AND id = (SELECT id FROM device_sessions WHERE student_id = $1 ORDER BY created_at ASC LIMIT 1)` if count >= 3.

---

### 20. Concurrent Logins — Session Cap Race Condition

**Decision: A — use a serialized transaction to evict exactly one session per new login.**

Wrap the "count sessions → evict if ≥ 3 → insert new" logic in a transaction with a row-level lock on the student's sessions (e.g. `SELECT ... FOR UPDATE` or equivalent Prisma `$transaction`). This prevents two simultaneous logins from both seeing count = 2 and both inserting, exceeding the cap.

---

### 21. Google Login — Auto-Create Account

**Decision: A — create the account automatically when the Google email has no local match.**

After the Google ID token is verified by `google-auth-library`, if no `Student` exists with that email, create one with `email_verified = true` and an `OAuthAccount` row. No invitation or pre-creation required. Token validity is the authorization signal.

---

### 22. Google Linking — Explicit Confirmation Flow

**Decision: A — return a linking-required response with a one-time confirmation token.**

When Google login finds an existing password account with the same email, do **not** auto-link. Return:
```json
{
  "status": "LINKING_REQUIRED",
  "linkingToken": "<short-lived signed token>",
  "message": "An account with this email already exists. Confirm to link your Google account."
}
```
The frontend prompts the user, then POSTs `{ linkingToken }` to a new endpoint `POST /api/auth/google/link` to complete the merge. The `linkingToken` expires in 10 minutes and is single-use.

---

### 23. Google Match — Existing Unverified Local Account

**Decision: A — treat it as a linking-required case.**

Even if the local account is unverified, do not auto-link or auto-verify. Return the same `LINKING_REQUIRED` response as decision 22. The user must explicitly confirm. This avoids silently merging identities the user may not have intended to connect.

---

### 24. Profile Update Before Email Verification

**Decision: A — allow profile updates as long as the JWT is valid.**

The `JwtAuthGuard` checks token validity only. Profile fields like `firstName` and `lastName` are low-risk mutations. Blocking them pre-verification adds friction without meaningful security benefit. Protected exam/speaking routes remain gated on `email_verified = true`.

---

### 25. Refresh / Logout — Session Continuity

**Decision: A — preserve the session and rotate refresh tokens normally.**

`POST /api/auth/refresh` updates the `refresh_token` hash on the existing `DeviceSession` row (rotation in place). `POST /api/auth/logout` deletes that row. No session is recreated or fragmented on refresh. This is unchanged from the current model.

---

### 26. Email Token Hashing — Algorithm

**Decision: C — HMAC-SHA256 with `JWT_SECRET` (or a dedicated `TOKEN_HMAC_SECRET`) as the key.**

Store `hmac-sha256(token, secret)` in the DB. When validating, recompute the HMAC and compare. The raw token travels only in the email link. A DB leak alone cannot validate tokens because the secret is not in the DB. Implementation: `crypto.createHmac('sha256', process.env.TOKEN_HMAC_SECRET).update(rawToken).digest('hex')`.

---

### 27. Outstanding Token Invalidation on Resend / Re-request

**Decision: A — only one active verification token and one active reset token per account at any time.**

When `register` (resend path), `forgot-password`, or a new verification send is triggered, overwrite `email_verification_token` / `password_reset_token` and their expiry fields. The previous token hash is gone; the old link in the user's inbox stops working immediately.

---

### 28. Email Sending Failure Handling

**Decision: A — fail the request and roll back the token write.**

Use a Prisma `$transaction`: write the token to the DB, call Resend, and if Resend throws, roll back. Return a 502/503 error to the caller. Do not return a false success. Log the failure with enough detail to retry or alert. The user can re-trigger the flow (register again, or hit "resend") once the mail service recovers.

---

### 29. Email Template — URL Shape

**Decision: A — backend builds the full clickable frontend URL with the token as a query parameter.**

Email templates embed URLs of the form:
- Verification: `${FRONTEND_URL}/verify-email?token=<rawToken>`
- Password reset: `${FRONTEND_URL}/reset-password?token=<rawToken>`

The raw token (not the hash) is embedded in the URL. The backend hashes it before storing; on receipt it hashes again to validate. `FRONTEND_URL` is an env var. Flutter web opens the URL directly; Flutter mobile intercepts it via deep link.

---

### 30. Email Normalization

**Decision: A — lowercase + trim on every inbound email before storage and comparison.**

Applied in a single shared helper called at the start of every auth method that accepts an email. This covers register, login, forgot-password, Google token payload, and profile update. Prevents duplicate accounts from case or whitespace differences (e.g. `User@Example.com` and `user@example.com` resolve to the same record).

---

### 31. Google + Password Auth Coexistence

**Decision: A — one `Student` can have both password auth and Google auth linked.**

After explicit linking (decision 22), the student's `password_hash` remains set and the `OAuthAccount` row is added. The user can sign in with either method. There is no "primary" auth method — both are valid paths to the same account.

---

### 32. Auth Response Shape

**Decision: B — slim auth-specific profile during auth flows; full profile only from `GET /api/auth/profile`.**

Token-issuing endpoints return:
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "student": {
    "id": "...",
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "emailVerified": true
  }
}
```
Fields sufficient for session state and header display. Full student data (exam history, lesen sessions, etc.) is fetched on demand from the profile endpoint.

---

### 33. Error Contract — Credentials, Expired Tokens, Linking

**Decision: C — generic for credentials; specific machine-readable codes for verification state and linking.**

| Scenario | HTTP | `code` field |
|----------|------|-------------|
| Wrong email or password | 401 | `INVALID_CREDENTIALS` |
| Expired or invalid JWT | 401 | `TOKEN_EXPIRED` / `TOKEN_INVALID` |
| Expired verification token | 400 | `VERIFICATION_TOKEN_EXPIRED` |
| Expired reset token | 400 | `RESET_TOKEN_EXPIRED` |
| Login — email not verified | 403 | `EMAIL_NOT_VERIFIED` |
| Google login — linking required | 200 | `LINKING_REQUIRED` + `linkingToken` |
| Token already used | 400 | `TOKEN_ALREADY_USED` |

Credentials errors stay generic to prevent enumeration. Verification and linking states are specific because the frontend must branch into different recovery flows.

---

## Open Questions
- What domain will the Resend emails be sent from? (needs to be verified in Resend dashboard)
- What URL does the Flutter web app run on? (needed for password reset links and CORS)
- Deep link scheme for Flutter mobile? (e.g. `telcapp://reset-password`) — Flutter team's responsibility but backend needs to know the format for reset email links
