# SPEC — Auth System Overhaul

**Date:** 2026-05-01
**Branch:** feat/auth-system
**Source plan:** tasks/auth-system-overhaul-plan.md

---

## 1. Objective

Replace the activation-code authentication system with a standard email/password + Google OAuth flow that any student can self-register into. The backend serves a Flutter app running on iOS, Android, and Flutter web.

**Target users:** Language exam students registering and logging in to the telC speaking-exam app.

**What changes:**
- Remove `POST /api/auth/activate` and `POST /api/auth/login-with-code`
- Add `POST /api/auth/register`, `/verify-email`, `/login`, `/forgot-password`, `/reset-password`, `/google`, `/google/link`

**What stays:**
- JWT access/refresh token model
- Device session tracking (max 3 sessions per student)
- Refresh token rotation on `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `PATCH /api/auth/profile`

---

## 2. Commands

```bash
# Development
npm run start:dev

# Build (generates Prisma client then compiles)
npm run build

# Database
npm run prisma:migrate        # run migrations
npm run prisma:generate       # generate Prisma client after schema changes
npm run prisma:studio         # open Prisma Studio

# Testing
npm test                      # all unit tests (*.spec.ts)
npm run test:e2e              # E2E tests (*.e2e-spec.ts)
npm run test:integration      # integration tests
npm run test:cov              # coverage report

# Validation sequence after any schema change
npm run prisma:generate && npm run build && npm test
```

---

## 3. Project Structure

Only the files being created or modified in this overhaul. The rest of the project is unchanged.

```
prisma/
  schema.prisma                         ← MODIFY: add new Student fields, OAuthAccount model

src/
  modules/
    auth/
      dto/
        register-request.dto.ts         ← NEW
        login-request.dto.ts            ← NEW
        verify-email-request.dto.ts     ← NEW
        forgot-password-request.dto.ts  ← NEW
        reset-password-request.dto.ts   ← NEW
        google-login-request.dto.ts     ← NEW
        google-link-request.dto.ts      ← NEW
        auth-response.dto.ts            ← NEW  (shared slim token-pair + student shape)
      auth.controller.ts                ← MODIFY: remove old endpoints, add new ones
      auth.service.ts                   ← MODIFY: add register/login/verify/reset/google methods
      auth.module.ts                    ← MODIFY: register EmailService, GoogleService, TokenCryptoService
      auth.errors.ts                    ← MODIFY: replace activation errors with new codes
      email.service.ts                  ← NEW   (Resend wrapper — auth-scoped)
      google.service.ts                 ← NEW   (google-auth-library wrapper)
      token-crypto.service.ts           ← NEW   (HMAC-SHA256 helpers for verify/reset tokens)
      token.service.ts                  ← MODIFY: update default expiry to 15m / 7d
  shared/
    interfaces/
      student.interface.ts              ← MODIFY: add emailVerified, slim auth shape
      token-payload.interface.ts        ← keep as-is (no new claims needed)
    guards/
      jwt-auth.guard.ts                 ← keep as-is (only verified students get tokens)

test/
  auth.service.spec.ts                  ← NEW
  token-crypto.service.spec.ts          ← NEW
  auth.e2e-spec.ts                      ← MODIFY: replace activation tests with new flows

.env.example                            ← MODIFY: add TOKEN_HMAC_SECRET, GOOGLE_CLIENT_ID,
                                                   FRONTEND_URL, update JWT expiry defaults
```

---

## 4. Code Style

Follow existing conventions exactly. Do not introduce new patterns.

### 4.1 File naming
- `kebab-case.ts` for all files
- DTOs: `<action>-<noun>-request.dto.ts` / `<action>-<noun>-response.dto.ts`
- Services: `<domain>.service.ts`

### 4.2 Class naming
PascalCase: `RegisterRequestDto`, `EmailService`, `TokenCryptoService`

### 4.3 DTOs
Use `class-validator` decorators. Always provide a `message` string. Apply email normalization via `@Transform`, not inside the service.

```typescript
import { IsEmail, IsString, IsNotEmpty, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterRequestDto {
  @IsNotEmpty({ message: 'First name is required' })
  @IsString({ message: 'First name must be a string' })
  firstName: string;

  @IsNotEmpty({ message: 'Last name is required' })
  @IsString({ message: 'Last name must be a string' })
  lastName: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be valid' })
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}
```

### 4.4 Services

```typescript
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
    private readonly googleService: GoogleService,
  ) {}
}
```

- Constructor injection, always `private readonly`
- Throw NestJS HTTP exceptions: `BadRequestException`, `UnauthorizedException`, `ForbiddenException`
- Use error codes from `auth.errors.ts` as exception messages — never inline strings
- Catch only what you handle; let others propagate

### 4.5 Controllers

```typescript
@Controller('api/auth')
export class AuthController {
  /**
   * POST /api/auth/register
   * Register a new student account and send a verification email.
   */
  @Post('register')
  async register(@Body() dto: RegisterRequestDto): Promise<{ message: string }> {
    return this.authService.register(dto);
  }
}
```

- One JSDoc comment per endpoint
- No logic in controllers — delegate to the service
- Explicit return types

### 4.6 Error codes

All codes live in `auth.errors.ts`. Format:

```typescript
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  EMAIL_NOT_VERIFIED: 'Please verify your email to continue.',
  VERIFICATION_TOKEN_EXPIRED: 'Verification link has expired. Please request a new one.',
  VERIFICATION_TOKEN_INVALID: 'Invalid verification token.',
  TOKEN_ALREADY_USED: 'This link has already been used.',
  RESET_TOKEN_EXPIRED: 'Password reset link has expired.',
  RESET_TOKEN_INVALID: 'Invalid password reset token.',
  LINKING_REQUIRED: 'An account with this email already exists. Confirm to link your Google account.',
  INVALID_GOOGLE_TOKEN: 'Google authentication failed. Please try again.',
};
```

### 4.7 Prisma schema conventions
- Snake_case field names, `@@map("table_name")`
- `@id @default(uuid())`
- `created_at DateTime @default(now())`, `updated_at DateTime @default(now()) @updatedAt`
- Nullable optional columns: `String?`
- `@@index([field])` on all FKs and frequently queried columns

### 4.8 Comments
No comments unless the WHY is non-obvious. Never describe what the code does.

---

## 5. Testing Strategy

### 5.1 Unit tests

Location: `test/`, runner: `npm test`

**Files to create or extend:**

| File | What to cover |
|---|---|
| `token-crypto.service.spec.ts` | `generateToken`, `hashToken`, `isExpired` — pure functions, no mocks |
| `auth.service.spec.ts` | Each method with mocked `PrismaService`, `EmailService`, `TokenService`, `GoogleService` |
| `token.service.spec.ts` | Extend existing: new 15m/7d expiry defaults, payload shape unchanged |

**Pattern:**

```typescript
describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(() => {
    prisma = {
      student: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    } as any;
    emailService = { sendVerificationEmail: jest.fn() } as any;
    service = new AuthService(prisma, tokenService, tokenCrypto, emailService, googleService);
  });

  describe('register', () => {
    it('returns generic success for a new email');
    it('returns generic success for an existing verified email without resending');
    it('resends verification for existing unverified email past the 2-min window');
    it('does not resend within the 2-min cooldown');
    it('throws if email sending fails and rolls back');
  });
});
```

**Coverage requirement:** Each service method must have — happy path, primary error path, and every edge case listed in the plan.

### 5.2 E2E tests

Location: `test/auth.e2e-spec.ts`, runner: `npm run test:e2e`
Full HTTP round-trip with mocked services via `Test.createTestingModule`.

| Endpoint | Cases |
|---|---|
| `POST /api/auth/register` | success; duplicate verified; duplicate unverified |
| `POST /api/auth/verify-email` | success; idempotent second click; expired token; invalid token |
| `POST /api/auth/login` | success verified; unverified → 403; invalid credentials → 401 |
| `POST /api/auth/forgot-password` | always 200; email exists; email not found |
| `POST /api/auth/reset-password` | success; expired; invalid |
| `POST /api/auth/google` | new user; returning user; linking required |
| `POST /api/auth/google/link` | success; expired linkingToken |
| `POST /api/auth/refresh` | success (unchanged) |
| `POST /api/auth/logout` | success (unchanged) |
| `PATCH /api/auth/profile` | success (unchanged) |

Every test must assert both HTTP status code and the `code` / `message` fields in the response body.

### 5.3 Validation sequence (run after each implementation step)

```bash
npm run prisma:generate
npm run build
npm test -- --testPathPattern=token-crypto
npm test -- --testPathPattern=auth.service
npm run test:e2e
npm run test:cov
```

---

## 6. Boundaries

### Always do
- Normalize email (lowercase + trim) via `@Transform` on the DTO — not in the service
- Store only the HMAC-SHA256 hash of verification and reset tokens
- Wrap password-reset (session delete + password update) in a single `$transaction`
- Wrap token DB write + email send in a `$transaction` — roll back if Resend throws
- Upsert `DeviceSession` by `deviceId` — never blind-insert
- Evict the earliest-`created_at` session inside a `$transaction` when count >= 3
- Return `{ message: 'verification email sent' }` from `register` always
- Return `{ message: 'If that email exists, a reset link was sent.' }` from `forgotPassword` always
- Return slim student shape `{ id, firstName, lastName, email, emailVerified }` from all token-issuing endpoints
- Use error codes from `auth.errors.ts` — never throw with inline strings

### Ask before doing
- Adding any Prisma model not in this spec
- Installing any npm package not listed in section 9
- Changing the JWT payload shape (claims added or removed)
- Adding any auth endpoint not listed in section 1
- Modifying any module outside `src/modules/auth/` or `src/shared/`

### Never do
- Store raw verification or reset tokens in the database
- Return a success response when email delivery has failed
- Auto-link a Google account to an existing local account without user confirmation via `/google/link`
- Issue access tokens to an unverified student
- Expose `password_hash`, `email_verification_token`, `password_reset_token`, or session internals in any API response
- Add Passport.js strategies
- Add Apple OAuth (deferred to a future sprint)
- Touch exam, speaking, writing, listening, sprachbausteine, or lesen modules

---

## 7. Confirmed Design Decisions (quick reference)

| # | Decision |
|---|---|
| 1 | `deviceId` required on `login`, `verify-email`, `reset-password`, `google`, `google/link` |
| 2 | `register` always returns generic success — no email enumeration |
| 3 | Tokens stored as HMAC-SHA256 (`TOKEN_HMAC_SECRET`); one active token per type |
| 4 | Google linking requires explicit confirm via `linkingToken` (10 min, single-use) |
| 5 | No Passport.js |
| 6 | Duplicate register → generic success; resend for unverified (2-min cooldown) |
| 7 | Unverified login → HTTP 403 `EMAIL_NOT_VERIFIED`, no tokens, resend if > 2 min |
| 8 | Verification tokens are single-use; idempotent on second click |
| 9 | `student.email_verified` in DB is always the source of truth |
| 10 | Password reset is one atomic `$transaction` |
| 11 | Post-reset: upsert session by `deviceId` |
| 12 | Session eviction uses earliest `created_at`, inside a `$transaction` |
| 13 | Profile updates allowed with any valid JWT (no verified gate on profile endpoint) |
| 14 | Auth responses return slim student: `{ id, firstName, lastName, email, emailVerified }` |
| 15 | Email normalized (lowercase + trim) via `@Transform` on the DTO |
| 16 | Email send failure → roll back token write, return error |
| 17 | Backend builds full `FRONTEND_URL` links in email templates |
| 18 | Error contract: generic for credentials, specific codes for branching flows |

---

## 8. Error Contract

| Scenario | HTTP | `code` |
|---|---|---|
| Wrong email or password | 401 | `INVALID_CREDENTIALS` |
| Expired / invalid JWT | 401 | `TOKEN_EXPIRED` / `TOKEN_INVALID` |
| Verification token expired | 400 | `VERIFICATION_TOKEN_EXPIRED` |
| Verification token not found | 400 | `VERIFICATION_TOKEN_INVALID` |
| Token already consumed | 400 | `TOKEN_ALREADY_USED` |
| Reset token expired | 400 | `RESET_TOKEN_EXPIRED` |
| Reset token not found | 400 | `RESET_TOKEN_INVALID` |
| Login — email not verified | 403 | `EMAIL_NOT_VERIFIED` |
| Google — email matches local account | 200 | `LINKING_REQUIRED` |
| Google ID token rejected | 401 | `INVALID_GOOGLE_TOKEN` |

---

## 9. New Environment Variables

Add to `.env.example`:

```env
# Token hashing — HMAC key for verification and reset tokens
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
TOKEN_HMAC_SECRET=

# Google OAuth — Client ID from Google Cloud Console
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

# Frontend URL — used in verification and reset email links
FRONTEND_URL=https://your-flutter-web-url.com

# Update existing JWT expiry defaults (was 1h / 30d)
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d
```

---

## 10. New Packages

```bash
npm install google-auth-library resend
```

No other packages are needed. `@nestjs/passport`, `passport`, and `passport-local` are explicitly excluded.
