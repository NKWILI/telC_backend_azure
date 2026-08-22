# Task 6 Plan: Center Authentication and Sessions

## Goal

Build the center-domain service used later by verify, login, refresh, logout, and guards. This task adds no public endpoint.

## Contracts

### Verify email

Input: raw verification token, device ID, optional device name.

- Hash the raw token before lookup.
- Reject missing, unknown, consumed, or expired tokens.
- Atomically mark the owner verified and clear the stored token.
- Issue a center token pair and update `last_seen_at`.

### Login

Input: email, password, device ID, optional device name.

- Normalize email inside the service.
- Unknown email and wrong password both return `INVALID_CREDENTIALS`.
- A valid password for an unverified owner returns `EMAIL_NOT_VERIFIED`.
- A verified owner receives the same response shape as verification.

### Authentication response

```text
accessToken
refreshToken
centerUser: id, role, firstName, lastName, email, phone, emailVerified
center: id, name, country, city, logoUrl
```

No password hash, stored token hash, or internal session row is exposed.

### Sessions

- Store sessions only in `CenterDeviceSession`.
- Reuse and rotate the session for the same owner/device pair.
- Permit at most three active devices per owner.
- On a fourth device, delete the least recently used active center session and revoke its ID in Valkey after the database commit.
- Generate center tokens with `actorType=CENTER_USER`, `centerUserId`, `centerId`, `deviceId`, and the actual center session ID.
- Store only the bcrypt hash of the refresh token.
- Atomically rotate the refresh hash with a compare-and-swap predicate so concurrent refresh attempts cannot both succeed.
- Revoke only a session owned by the authenticated center user.

## Security invariants

- Center methods never query or mutate `Student` or `DeviceSession`.
- Verification tokens are single-use and checked with both hash and expiry predicates.
- Login errors do not reveal whether a center email exists.
- Database/session errors are mapped to stable codes and do not expose raw errors.
- Raw passwords, verification tokens, refresh tokens, and hashes are never logged.
- Valkey is an acceleration layer; the center-session database state remains authoritative.

## Implementation increments

1. Add failing service tests and the typed authentication response.
2. Implement center session issuance, same-device rotation, three-device eviction, and last-seen update.
3. Implement atomic email verification and generic credential login.
4. Implement refresh-hash compare-and-swap and owner-scoped revocation primitives.
5. Run focused tests after each increment, then the full regression suite, build, targeted lint, and diff checks.

## Out of scope

- Controllers, request DTO validation, rate limits, and Swagger (Task 7).
- Public refresh/logout endpoints and refresh-JWT orchestration (Task 8).
- Password recovery, authenticated profile, subscriptions, activation keys, and payments.

## Verification

```text
npm.cmd test -- center-auth.service.spec --runInBand
npm.cmd test -- --runInBand --no-coverage
npm.cmd run build
npx.cmd eslint src/modules/centers/center-auth.service.ts src/modules/centers/dto/center-auth-response.dto.ts test/center-auth.service.spec.ts
git diff --check
```

## Completion gate

Task 6 is complete only when all behavior is covered, all gates pass, no student-session call exists in the implementation, and the green increment is committed without merging or pushing.
