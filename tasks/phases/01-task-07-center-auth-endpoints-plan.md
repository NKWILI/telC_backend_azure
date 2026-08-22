# Task 7 Plan: Center Verification and Login Endpoints

## Goal

Expose the completed center verification and login service through validated, documented, rate-limited HTTP endpoints. This task adds no refresh, logout, password recovery, profile, subscription, or payment behavior.

## API contract

### `POST /api/center-auth/verify-email`

Request:

```json
{
  "token": "one-time-token",
  "deviceId": "installation-id",
  "deviceName": "Chrome on Windows"
}
```

- Returns `201` with `CenterAuthResponseDto`.
- Returns `400 VERIFICATION_TOKEN_INVALID`, `VERIFICATION_TOKEN_EXPIRED`, or validation errors.
- Returns `429 RATE_LIMIT_EXCEEDED` from a center-specific per-IP bucket.

### `POST /api/center-auth/login`

Request:

```json
{
  "email": "manager@example.com",
  "password": "private-password",
  "deviceId": "installation-id",
  "deviceName": "Chrome on Windows"
}
```

- Returns `201` with the same `CenterAuthResponseDto`.
- Returns `401 INVALID_CREDENTIALS` for both unknown email and wrong password.
- Returns `403 EMAIL_NOT_VERIFIED` only after a correct password.
- Returns `429 RATE_LIMIT_EXCEEDED` from center-specific IP and normalized-email buckets.

## Boundary rules

- Add a dedicated `CenterAuthController` at `/api/center-auth`; do not add auth routes to the center-registration controller.
- Validate and normalize all request data with strict DTOs and the existing global whitelist/unknown-field rejection.
- Bound email, password, token, device ID, and optional device-name sizes.
- Run rate limiting before calling `CenterAuthService`.
- Reuse the existing login/verification policy values, but never share student rate-limit keys.
- Return the existing center error shape: `{ error, message }`.
- Document success and all expected 4xx/5xx responses in Swagger.
- Never accept `centerId`, role, verification state, partnership state, or subscription state from the client.

## Threat model

| Abuse | Control |
| --- | --- |
| Password spraying | Per-IP center login bucket |
| Targeted brute force | Per-normalized-email center login bucket |
| Student traffic locking out centers | Separate `ratelimit:centers:*` namespaces |
| Oversized request values | DTO length and UTF-8 password bounds |
| Privilege or tenant injection | Strict DTO allowlist and forbidden unknown fields |
| Account enumeration | Generic service response for unknown email/wrong password |
| Verification-token guessing | Per-IP verification limit plus one-time atomic service consume |

## Increments

1. Add failing rate-limit tests, then center-specific login and verification buckets.
2. Add failing HTTP contract tests, then request/error DTOs, controller, module wiring, and Swagger metadata.
3. Run focused tests, full regression tests, build, targeted lint, staged diff/secret checks, and code/security review.

## Verification

```text
npm.cmd test -- rate-limit-valkey.spec rate-limit.service.spec --runInBand
npm.cmd test -- center-auth.controller.spec --runInBand
npm.cmd test -- --runInBand --no-coverage
npm.cmd run build
npx.cmd eslint <Task 7 changed TypeScript files>
git diff --check
```

## Completion gate

Task 7 is complete only when both endpoints enforce the documented contract, center and student rate-limit budgets are isolated, every focused/full gate passes, and the implementation is committed without pushing or merging.
