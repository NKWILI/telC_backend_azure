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
- `POST /api/auth/verify-email` — `{ token }` → marks email as verified, returns JWT token pair

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

## Not Doing (and Why)

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

## Open Questions
- What domain will the Resend emails be sent from? (needs to be verified in Resend dashboard)
- What URL does the Flutter web app run on? (needed for password reset links and CORS)
- Deep link scheme for Flutter mobile? (e.g. `telcapp://reset-password`) — Flutter team's responsibility but backend needs to know the format for reset email links
