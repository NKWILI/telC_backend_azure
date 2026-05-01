# Auth System Overhaul — Implementation Plan

**Date:** 2026-05-01
**Spec:** SPEC-auth.md
**Idea doc:** docs/ideas/auth-system-overhaul.md
**Decision log:** tasks/auth-system-overhaul-plan.md

---

## Dependency Graph

```
FOUNDATION (no dependencies — must land first)
  prisma/schema.prisma          new Student fields + OAuthAccount model
  .env.example                  TOKEN_HMAC_SECRET, GOOGLE_CLIENT_ID, FRONTEND_URL, JWT expiries
  package.json                  npm install google-auth-library resend
  auth.errors.ts                new machine-readable error codes
  student.interface.ts          slim AuthStudentResponse shape

PRIMITIVES (depend on Foundation — can be done in any order after Task 1)
  token-crypto.service.ts       HMAC-SHA256 helpers — depends on: TOKEN_HMAC_SECRET env
  token.service.ts              expiry update 15m/7d — standalone
  email.service.ts              Resend wrapper — depends on: resend package, FRONTEND_URL env
  google.service.ts             google-auth-library wrapper — depends on: package, GOOGLE_CLIENT_ID

SHARED SESSION LOGIC (depends on Foundation schema)
  auth.service.ts               upsert-by-deviceId + eviction-by-created_at in $transaction
                                shared by every token-issuing method

VERTICAL SLICES (each depends on Foundation + Primitives + Session Logic)
  Slice A  register + verify-email     DTOs → service → controller → tests
  Slice B  login                       DTO  → service → controller → tests
  Slice C  forgot-password + reset-password  DTOs → service → controller → tests
  Slice D  google + google/link        DTOs → service → controller → tests

WIRING (depends on all slices)
  auth.module.ts                register all new providers
  Full build + test suite       final validation
```

---

## Slicing Strategy

Work is sliced **vertically** — each task delivers one complete user journey from DTO to
controller to tests. The exception is Task 1 (Foundation) which is an unavoidable horizontal
prerequisite, and Task 2 (Primitives) which are shared building blocks small enough to do once.

A slice is **done** when:
1. The new DTO compiles
2. The service method works
3. The controller endpoint is wired
4. Unit tests cover happy path + error paths + documented edge cases
5. E2E tests cover every case in the spec table
6. `npm run build` exits 0

---

## Task 1 — Foundation

**Files touched:** `prisma/schema.prisma`, `.env.example`, `package.json`,
`src/modules/auth/auth.errors.ts`, `src/shared/interfaces/student.interface.ts`

### 1a — Install packages

```bash
npm install google-auth-library resend
```

Verify both appear in `package.json` dependencies.

### 1b — Update Prisma schema

Edit `prisma/schema.prisma`:

```prisma
model Student {
  id                         String    @id @default(uuid())
  first_name                 String?
  last_name                  String?
  email                      String    @unique          // non-null going forward
  password_hash              String?                    // null for Google-only users
  email_verified             Boolean   @default(false)
  email_verification_token   String?                    // stores HMAC-SHA256 hash
  email_verification_expires DateTime?
  password_reset_token       String?                    // stores HMAC-SHA256 hash
  password_reset_expires     DateTime?
  created_at                 DateTime  @default(now())
  updated_at                 DateTime  @default(now()) @updatedAt
  last_seen_at               DateTime  @default(now())

  device_sessions DeviceSession[]
  oauth_accounts  OAuthAccount[]
  exam_sessions   ExamSession[]
  lesen_sessions  LesenSession[]

  @@index([email])
  @@map("students")
}

model OAuthAccount {
  id          String  @id @default(uuid())
  student_id  String
  provider    String
  provider_id String
  email       String?

  student Student @relation(fields: [student_id], references: [id], onDelete: Cascade)

  @@unique([provider, provider_id])
  @@index([student_id])
  @@map("oauth_accounts")
}
```

Also add `@@index([student_id])` to `DeviceSession` if not already present.

### 1c — Update .env.example

Add:
```env
# Token hashing — HMAC key for verification and reset tokens
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
TOKEN_HMAC_SECRET=

# Google OAuth
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

# Frontend URL — used in email links
FRONTEND_URL=https://your-flutter-web-url.com

# JWT expiry (was 1h / 30d)
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d
```

### 1d — Replace auth error constants

Rewrite `src/modules/auth/auth.errors.ts`:

```typescript
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  // credential errors — kept generic, no enumeration
  INVALID_CREDENTIALS: 'Invalid email or password.',

  // verification flow
  EMAIL_NOT_VERIFIED: 'Please verify your email to continue.',
  VERIFICATION_TOKEN_EXPIRED: 'Verification link has expired. Please request a new one.',
  VERIFICATION_TOKEN_INVALID: 'Invalid verification token.',
  TOKEN_ALREADY_USED: 'This link has already been used.',

  // password reset flow
  RESET_TOKEN_EXPIRED: 'Password reset link has expired.',
  RESET_TOKEN_INVALID: 'Invalid password reset token.',

  // Google OAuth
  LINKING_REQUIRED: 'An account with this email already exists. Confirm to link your Google account.',
  INVALID_GOOGLE_TOKEN: 'Google authentication failed. Please try again.',

  // JWT
  TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  TOKEN_INVALID: 'Invalid session token.',

  // keep existing session/profile errors
  INVALID_SESSION: 'Invalid or expired session.',
  INVALID_REFRESH_TOKEN: 'Invalid or expired refresh token.',
  MISSING_REQUIRED_FIELDS: 'Required fields are missing.',
};
```

Remove any activation-code error codes.

### 1e — Update shared student interface

Add slim auth response shape to `src/shared/interfaces/student.interface.ts`:

```typescript
export interface AuthStudentResponse {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  emailVerified: boolean;
}
```

### Checkpoint 1

```bash
npm run prisma:generate
npm run build
```

Both must exit 0. No service code has changed yet — this is purely schema + config.

---

## Task 2 — Shared Primitives

**Files created:** `token-crypto.service.ts`, `email.service.ts`, `google.service.ts`
**Files modified:** `token.service.ts`, `auth.module.ts` (partial)

### 2a — TokenCryptoService

Create `src/modules/auth/token-crypto.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class TokenCryptoService {
  constructor(private readonly config: ConfigService) {}

  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  hashToken(raw: string): string {
    return crypto
      .createHmac('sha256', this.config.getOrThrow<string>('TOKEN_HMAC_SECRET'))
      .update(raw)
      .digest('hex');
  }

  isExpired(expiresAt: Date): boolean {
    return new Date() > expiresAt;
  }
}
```

### 2b — EmailService

Create `src/modules/auth/email.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.getOrThrow<string>('RESEND_API_KEY'));
  }

  async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const url = `${this.config.getOrThrow('FRONTEND_URL')}/verify-email?token=${rawToken}`;
    await this.resend.emails.send({
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
      to,
      subject: 'Verify your email address',
      html: `<p>Click the link below to verify your email:</p><p><a href="${url}">${url}</a></p>`,
    });
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const url = `${this.config.getOrThrow('FRONTEND_URL')}/reset-password?token=${rawToken}`;
    await this.resend.emails.send({
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
      to,
      subject: 'Reset your password',
      html: `<p>Click the link below to reset your password:</p><p><a href="${url}">${url}</a></p>`,
    });
  }
}
```

### 2c — GoogleService (skeleton)

Create `src/modules/auth/google.service.ts`:

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GooglePayload {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
}

@Injectable()
export class GoogleService {
  private readonly client: OAuth2Client;

  constructor(private readonly config: ConfigService) {
    this.client = new OAuth2Client(config.getOrThrow<string>('GOOGLE_CLIENT_ID'));
  }

  async verifyIdToken(idToken: string): Promise<GooglePayload> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('Missing email in Google token payload');
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase().trim(),
        email_verified: payload.email_verified ?? false,
        given_name: payload.given_name,
        family_name: payload.family_name,
      };
    } catch {
      throw new UnauthorizedException('INVALID_GOOGLE_TOKEN');
    }
  }
}
```

### 2d — Update TokenService expiry defaults

Edit `src/modules/auth/token.service.ts`:
- Change access token default expiry from `'1h'` to `process.env.JWT_ACCESS_TOKEN_EXPIRY ?? '15m'`
- Change refresh token default expiry from `'30d'` to `process.env.JWT_REFRESH_TOKEN_EXPIRY ?? '7d'`

### 2e — Write TokenCryptoService unit tests

Create `test/token-crypto.service.spec.ts`:

```typescript
describe('TokenCryptoService', () => {
  let service: TokenCryptoService;

  beforeAll(() => {
    process.env.TOKEN_HMAC_SECRET = 'test-hmac-secret-64-chars-minimum-for-testing-purposes-1234567890';
  });

  beforeEach(() => {
    const config = { getOrThrow: (key: string) => process.env[key] } as any;
    service = new TokenCryptoService(config);
  });

  describe('generateToken', () => {
    it('returns a 64-char hex string');
    it('returns a different value each call');
  });

  describe('hashToken', () => {
    it('returns identical HMAC for the same input');
    it('returns different HMACs for different inputs');
    it('output is a 64-char hex string');
  });

  describe('isExpired', () => {
    it('returns true for a date in the past');
    it('returns false for a date in the future');
  });
});
```

### Checkpoint 2

```bash
npm test -- --testPathPattern=token-crypto
npm run build
```

---

## Task 3 — Device Session Infrastructure

**Files modified:** `src/modules/auth/auth.service.ts`

This is not a user-facing feature — it is the shared session helper called by every
token-issuing service method. Complete it before starting any Slice.

### What to implement

Replace (or refactor) the existing `createDeviceSession()` with a new
`upsertDeviceSession(studentId, deviceId, refreshTokenHash, deviceName?)` that:

1. Counts active (non-revoked) sessions for `studentId`
2. If count >= 3: deletes the session with the earliest `created_at`
3. Upserts on `device_id` (create if new device, update refresh token hash if existing)

All three steps run inside a single `prisma.$transaction`.

```typescript
private async upsertDeviceSession(
  studentId: string,
  deviceId: string,
  refreshTokenHash: string,
  deviceName?: string,
): Promise<DeviceSession> {
  return this.prisma.$transaction(async (tx) => {
    const sessions = await tx.deviceSession.findMany({
      where: { student_id: studentId, revoked_at: null },
      orderBy: { created_at: 'asc' },
    });

    if (sessions.length >= 3) {
      await tx.deviceSession.delete({ where: { id: sessions[0].id } });
    }

    return tx.deviceSession.upsert({
      where: { device_id: deviceId },
      create: {
        student_id: studentId,
        device_id: deviceId,
        refresh_token_hash: refreshTokenHash,
        device_name: deviceName ?? null,
      },
      update: {
        refresh_token_hash: refreshTokenHash,
        device_name: deviceName ?? null,
        revoked_at: null,
      },
    });
  });
}
```

### Unit tests for session logic

Add to `test/auth.service.spec.ts`:

```
describe('upsertDeviceSession', () => {
  it('creates a new session when count < 3');
  it('evicts the oldest session (earliest created_at) when count is already 3');
  it('reuses (upserts) an existing session for the same deviceId');
  it('runs inside a $transaction');
});
```

### Checkpoint 3

```bash
npm test -- --testPathPattern=auth.service
npm run build
```

---

## Task 4 — Register + VerifyEmail (Vertical Slice A)

**New files:** `register-request.dto.ts`, `verify-email-request.dto.ts`, `auth-response.dto.ts`
**Modified:** `auth.service.ts`, `auth.controller.ts`
**Tests:** `auth.service.spec.ts` (register + verifyEmail sections), `auth.e2e-spec.ts` (register + verify-email sections)

### DTOs

**`register-request.dto.ts`** — `{ firstName, lastName, email (@Transform lowercase+trim), password (MinLength 8) }`

**`verify-email-request.dto.ts`** — `{ token, deviceId, deviceName? }`

**`auth-response.dto.ts`** — shared response interface:
```typescript
export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  student: AuthStudentResponse;
}
```

### AuthService.register()

Behavior (see plan decisions 2, 3, 6, 16):
1. Email is already normalized by `@Transform` on DTO
2. Check if student exists with that email
3. **Existing + verified:** return generic success immediately — no write, no email
4. **Existing + unverified:** if `email_verification_expires` was set within the last 2 min, return generic success (rate-limit). Otherwise: generate new raw token, compute HMAC, overwrite token + expiry fields in `$transaction` with email send; return generic success
5. **New student:** hash password with bcrypt, generate raw token + HMAC, `$transaction` (create student + store token + send email). If email send throws, transaction rolls back; re-throw as 502
6. Always return `{ message: 'verification email sent' }`

### AuthService.verifyEmail()

Behavior (see plan decisions 4, 8, 9):
1. Hash the incoming raw token → look up student by `email_verification_token` field (HMAC match)
2. Not found → `VERIFICATION_TOKEN_INVALID`
3. Found but `email_verified = true` already → skip token check, upsert session, return fresh tokens (idempotent)
4. Found and `email_verification_expires` is past → `VERIFICATION_TOKEN_EXPIRED`
5. Valid → in one `prisma.student.update`: set `email_verified = true`, clear token fields
6. Call `upsertDeviceSession()` with the supplied `deviceId`
7. Generate token pair; return `AuthTokenResponse`

### Controller endpoints

```typescript
@Post('register')
async register(@Body() dto: RegisterRequestDto): Promise<{ message: string }>

@Post('verify-email')
async verifyEmail(@Body() dto: VerifyEmailRequestDto): Promise<AuthTokenResponse>
```

### Unit tests (auth.service.spec.ts — register section)

```
register()
  ✓ returns generic success for a new email
  ✓ returns generic success and does nothing for an existing verified email
  ✓ resends verification for existing unverified email past the 2-min window
  ✓ does NOT resend within the 2-min cooldown (returns same generic success)
  ✓ throws 502 and rolls back if email sending fails

verifyEmail()
  ✓ marks student verified, clears token, creates session, returns token pair
  ✓ returns fresh token pair idempotently if already verified
  ✓ throws VERIFICATION_TOKEN_INVALID for unknown token hash
  ✓ throws VERIFICATION_TOKEN_EXPIRED for expired token
```

### E2E tests (auth.e2e-spec.ts — register + verify-email section)

```
POST /api/auth/register
  ✓ 201 { message: 'verification email sent' } for new email
  ✓ 201 { message: 'verification email sent' } for existing verified (no enumeration)
  ✓ 201 { message: 'verification email sent' } for existing unverified

POST /api/auth/verify-email
  ✓ 201 { accessToken, refreshToken, student: { id, firstName, lastName, email, emailVerified: true } }
  ✓ 201 idempotent: second click on same link → same response shape
  ✓ 400 VERIFICATION_TOKEN_EXPIRED
  ✓ 400 VERIFICATION_TOKEN_INVALID
```

### Checkpoint 4

```bash
npm test -- --testPathPattern=auth.service
npm run test:e2e
```

Register + verifyEmail tests must pass. Refresh, logout, profile tests must still pass.

---

## Task 5 — Login (Vertical Slice B)

**New files:** `login-request.dto.ts`
**Modified:** `auth.service.ts`, `auth.controller.ts`
**Tests:** login sections in `auth.service.spec.ts` and `auth.e2e-spec.ts`

### LoginRequestDto

`{ email (@Transform), password, deviceId, deviceName? }`

### AuthService.login()

Behavior (see plan decisions 7, 9, 12, 14):
1. Find student by normalized email
2. Not found OR bcrypt mismatch → `INVALID_CREDENTIALS` (same response, no enumeration)
3. Found + unverified:
   - Do NOT issue tokens
   - If `email_verification_expires` was set more than 2 min ago: resend verification email (ignore send errors — log only, don't fail the login response)
   - Return HTTP 403 `{ code: 'EMAIL_NOT_VERIFIED', verified: false, message: ... }`
4. Found + verified:
   - Call `upsertDeviceSession()`
   - Generate token pair
   - Return `AuthTokenResponse`

### Controller endpoint

```typescript
@Post('login')
async login(@Body() dto: LoginRequestDto): Promise<AuthTokenResponse | { verified: false; code: string; message: string }>
```

### Unit tests

```
login()
  ✓ returns token pair for valid verified credentials
  ✓ throws INVALID_CREDENTIALS for wrong email (same as wrong password)
  ✓ throws INVALID_CREDENTIALS for wrong password
  ✓ returns 403 EMAIL_NOT_VERIFIED for unverified account
  ✓ resends verification email if > 2 min since last send
  ✓ does NOT resend verification email if within 2-min cooldown
```

### E2E tests

```
POST /api/auth/login
  ✓ 201 token pair for verified credentials
  ✓ 401 INVALID_CREDENTIALS for wrong password
  ✓ 401 INVALID_CREDENTIALS for unknown email (same shape as wrong password)
  ✓ 403 EMAIL_NOT_VERIFIED for unverified account (no tokens in body)
```

### Checkpoint 5

```bash
npm test -- --testPathPattern=auth.service
npm run test:e2e
```

---

## Task 6 — Forgot Password + Reset Password (Vertical Slice C)

**New files:** `forgot-password-request.dto.ts`, `reset-password-request.dto.ts`
**Modified:** `auth.service.ts`, `auth.controller.ts`
**Tests:** forgot/reset sections in `auth.service.spec.ts` and `auth.e2e-spec.ts`

### ForgotPasswordRequestDto

`{ email (@Transform) }`

### ResetPasswordRequestDto

`{ token, newPassword (MinLength 8), deviceId, deviceName? }`

### AuthService.forgotPassword()

Behavior (see plan decisions 3, 16, 18):
1. Find student by normalized email
2. Always return `{ message: 'If that email exists, a reset link was sent.' }`
3. If student exists: in `$transaction`, generate raw token + HMAC, overwrite `password_reset_token` + `password_reset_expires` (1h). Then send email. If email send throws: transaction rolls back, log error, still return generic success (unlike register — user can retry without leaking state)
4. If not found: return generic success immediately

Note: the difference from register is that forgotPassword always returns generic success even on email failure — resending is cheap and the user will try again.

### AuthService.resetPassword()

Behavior (see plan decisions 8, 9, 10, 11):
1. Hash the incoming raw token → find student by `password_reset_token` (HMAC match)
2. Not found → `RESET_TOKEN_INVALID`
3. Expired → `RESET_TOKEN_EXPIRED`
4. Valid → single `$transaction`:
   - Delete all `DeviceSession` rows for this student
   - Hash `newPassword` with bcrypt
   - Update `password_hash`, clear `password_reset_token` + `password_reset_expires`
5. After transaction: call `upsertDeviceSession()` for the requesting device
6. Generate token pair; return `AuthTokenResponse`

### Controller endpoints

```typescript
@Post('forgot-password')
async forgotPassword(@Body() dto: ForgotPasswordRequestDto): Promise<{ message: string }>

@Post('reset-password')
async resetPassword(@Body() dto: ResetPasswordRequestDto): Promise<AuthTokenResponse>
```

### Unit tests

```
forgotPassword()
  ✓ always returns generic message regardless of email existence
  ✓ generates and stores hashed reset token for existing email
  ✓ does nothing for non-existent email (same response)
  ✓ invalidates previous reset token by overwriting

resetPassword()
  ✓ resets password, revokes all sessions, creates new session, returns token pair
  ✓ throws RESET_TOKEN_INVALID for unknown token
  ✓ throws RESET_TOKEN_EXPIRED for expired token
  ✓ entire password + session-delete is atomic ($transaction)
```

### E2E tests

```
POST /api/auth/forgot-password
  ✓ 201 generic message for existing email
  ✓ 201 same generic message for non-existent email

POST /api/auth/reset-password
  ✓ 201 token pair, all prior sessions revoked
  ✓ 400 RESET_TOKEN_EXPIRED
  ✓ 400 RESET_TOKEN_INVALID
```

### Checkpoint 6

```bash
npm test -- --testPathPattern=auth.service
npm run test:e2e
```

---

## Task 7 — Google OAuth (Vertical Slice D)

**New files:** `google-login-request.dto.ts`, `google-link-request.dto.ts`
**Modified:** `auth.service.ts` (googleLogin + googleLink), `auth.controller.ts`, `google.service.ts` (full implementation if skeleton needed elaborating)
**Tests:** google sections in `auth.service.spec.ts` and `auth.e2e-spec.ts`

### GoogleLoginRequestDto

`{ idToken, deviceId, deviceName? }`

### GoogleLinkRequestDto

`{ linkingToken, deviceId, deviceName? }`

### AuthService.googleLogin()

Behavior (see plan decisions 4, 7, 9, 12, 13, 14, 22):
1. Call `googleService.verifyIdToken(idToken)` → throws `INVALID_GOOGLE_TOKEN` if invalid
2. Email is already normalized inside `GoogleService.verifyIdToken()`
3. Lookup path:
   - **OAuthAccount exists** for `(provider='google', provider_id=sub)` → returning Google user. Find their student, upsert session, return tokens
   - **No OAuthAccount but Student exists** with that email (verified or unverified) → generate a short-lived `linkingToken` (JWT signed with JWT_SECRET, `sub=studentId`, `googleSub=sub`, 10 min, `type='linking'`). Return `{ status: 'LINKING_REQUIRED', linkingToken }`
   - **No match** → create `Student` with `email_verified = true`, `first_name` from Google, create `OAuthAccount`. Upsert session. Return tokens
4. After resolving the student: enforce 3-session cap via `upsertDeviceSession()`

### AuthService.googleLink()

Behavior (see plan decision 4):
1. Verify and decode the `linkingToken` JWT (must have `type='linking'`, not expired)
2. Invalid/expired → `RESET_TOKEN_INVALID` (or a dedicated `LINKING_TOKEN_INVALID` error code)
3. Create `OAuthAccount` row for `(studentId, provider='google', provider_id=googleSub)`
4. Set `student.email_verified = true`
5. Upsert session, return token pair

### Controller endpoints

```typescript
@Post('google')
async googleLogin(@Body() dto: GoogleLoginRequestDto): Promise<AuthTokenResponse | LinkingRequiredResponse>

@Post('google/link')
async googleLink(@Body() dto: GoogleLinkRequestDto): Promise<AuthTokenResponse>
```

### Unit tests

```
googleLogin()
  ✓ returns token pair for a returning Google user (OAuthAccount exists)
  ✓ creates new Student + OAuthAccount for a brand-new Google user
  ✓ returns LINKING_REQUIRED when email matches existing local account (verified)
  ✓ returns LINKING_REQUIRED when email matches existing local account (unverified)
  ✓ throws INVALID_GOOGLE_TOKEN when google-auth-library rejects the token

googleLink()
  ✓ creates OAuthAccount, sets email_verified, returns token pair
  ✓ throws for invalid/expired linkingToken
```

### E2E tests

```
POST /api/auth/google
  ✓ 201 token pair for new Google user
  ✓ 201 token pair for returning Google user
  ✓ 200 LINKING_REQUIRED with linkingToken for email collision

POST /api/auth/google/link
  ✓ 201 token pair after successful link confirmation
  ✓ 400 for expired linkingToken
```

### Checkpoint 7

```bash
npm test -- --testPathPattern=auth.service
npm run test:e2e
```

---

## Task 8 — Final Wiring + Full Validation

**Files modified:** `src/modules/auth/auth.module.ts`

### 8a — auth.module.ts

Register all new providers:

```typescript
@Module({
  imports: [JwtModule, ConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TokenCryptoService,
    EmailService,
    GoogleService,
    PrismaService,
  ],
})
export class AuthModule {}
```

### 8b — Remove all activation-code traces

Search and confirm:
- No `activate` or `login-with-code` routes in `auth.controller.ts`
- No `validateActivationCode`, `loginWithActivationCode`, `createStudent` in `auth.service.ts`
- No `ACTIVATION_CODE_*` error codes in `auth.errors.ts`
- No activation-code DTO files remaining

### 8c — Final validation

```bash
npm run prisma:generate
npm run build
npm test -- --testPathPattern=token-crypto
npm test -- --testPathPattern=auth.service
npm run test:e2e
npm run test:cov
```

### Final acceptance criteria

- No activation-code endpoints, DTOs, or error codes remain
- `POST /api/auth/register` returns generic success always
- `POST /api/auth/verify-email` is idempotent on second click
- `POST /api/auth/login` — unverified → 403, no tokens
- `POST /api/auth/forgot-password` returns generic success always
- `POST /api/auth/reset-password` revokes all sessions atomically
- `POST /api/auth/google` → new user / returning user / LINKING_REQUIRED
- `POST /api/auth/google/link` completes the account merge
- Device limit is enforced by earliest-`created_at` eviction inside a `$transaction`
- `POST /api/auth/refresh` and `POST /api/auth/logout` behavior is unchanged
- `npm run test:cov` passes with no regressions

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| `prisma.$transaction` not wrapping session eviction | Concurrent logins exceed 3-session cap | Task 3 explicitly requires transaction + unit test verifies it |
| Email send fails after token is written | Token exists but user can never receive it | `$transaction` wraps DB write + email send; rollback on failure |
| Raw token stored in DB | Token leak → account takeover without email access | HMAC-SHA256 stored, raw never persisted; `NEVER do` in SPEC |
| `linkingToken` stored in DB | Extra token store to maintain | Use existing JWT infrastructure (sign with JWT_SECRET, short expiry) |
| `TOKEN_HMAC_SECRET` rotated in production | All outstanding verification/reset tokens break | Document clearly in `.env.example`; add startup validation |
| `DeviceSession.device_id` not unique in schema | Prisma upsert on `device_id` fails | Verify schema has `@@unique([device_id])` — add if missing |
