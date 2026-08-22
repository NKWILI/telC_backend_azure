# Task 8 Plan: Center Refresh and Logout

## Goal

Add isolated center refresh-token rotation and logout endpoints. This task does
not add password recovery, center guards, profile operations, subscriptions, or
payments.

## API contract

### `POST /api/center-auth/refresh`

Request:

```json
{
  "refreshToken": "center-refresh-token"
}
```

- Returns `201` with `{ accessToken, refreshToken }`.
- The submitted refresh token is single-use.
- Concurrent requests using the same token produce one success and one
  `401 INVALID_CENTER_REFRESH_TOKEN`.
- Invalid, expired, student, guest, revoked, mismatched-device, and replayed
  tokens return the same `401 INVALID_CENTER_REFRESH_TOKEN` contract.

### `POST /api/center-auth/logout`

Request:

```json
{
  "refreshToken": "center-refresh-token"
}
```

- Returns `201` with `{ "success": true }`.
- A current refresh token revokes only its own `CenterDeviceSession`.
- Repeating logout after that session is already revoked or removed is
  idempotent and returns success.
- A stale token from before a refresh cannot revoke the replacement session and
  returns `401 INVALID_CENTER_REFRESH_TOKEN`.

## Boundary and security rules

- Validate the body with a strict DTO and cap the token at 4096 characters.
- Verify only with `verifyCenterRefreshToken`; student and guest token verifiers
  are never used by these endpoints.
- Scope every session lookup and mutation by signed center-user, center, device,
  and session identifiers.
- Read and write only `CenterDeviceSession`; never query `DeviceSession` or
  mutate `Student`.
- Compare the presented token with the stored bcrypt hash before rotation or
  logout.
- Rotate with one atomic `updateMany` predicate containing the expected hash;
  the losing concurrent request must not overwrite the winner.
- Keep database state authoritative. Valkey records successful logout so future
  center guards can reject the associated access token immediately; cache
  failure does not undo database revocation.
- Do not collapse infrastructure failures into 401 responses. Only validation
  and authentication failures use `INVALID_CENTER_REFRESH_TOKEN`.
- Do not add or change rate-limit policy in this task. Login remains the
  brute-force boundary; refresh/logout require an unguessable signed token, and
  changing throttling requires a separate approved policy decision.

## Threat model

| Abuse | Control |
| --- | --- |
| Student or guest token crosses into center auth | Center-only JWT verifier and token-isolation tests |
| Refresh replay | bcrypt comparison plus atomic expected-hash rotation |
| Two simultaneous refreshes overwrite each other | one compare-and-swap winner |
| Old token logs out a newly rotated session | current-hash comparison before revoke |
| One center revokes another center's session | signed owner/center/device/session scoped query and update |
| Center endpoint touches student state | throwing student-model test doubles |
| Oversized token consumes unnecessary work | DTO maximum length |
| Database failure is misreported as client auth failure | no broad exception-to-401 conversion |

## Increments

1. Add failing service tests for token confusion, replay, concurrent rotation,
   infrastructure errors, and scoped/idempotent logout.
2. Implement center refresh/logout orchestration using existing atomic center
   session primitives; run the focused service suite and build.
3. Add failing controller contract tests, then request/response DTOs, endpoints,
   and Swagger responses.
4. Run focused tests, full regression tests, build, targeted lint, diff/secret
   checks, and code/security review.

## Verification

```text
npm.cmd test -- center-auth.service.spec --runInBand
npm.cmd test -- center-auth.controller.spec --runInBand
npm.cmd test -- center-auth.controller.spec center-auth.service.spec --runInBand
npm.cmd test -- --runInBand --no-coverage
npm.cmd run build
npx.cmd eslint <Task 8 changed TypeScript files>
git diff --check
```

## Completion gate

Task 8 is complete only when refresh rotation is demonstrably single-use,
logout cannot cross center/session boundaries, student state remains untouched,
the HTTP contract is documented and validated, all quality gates pass, and the
implementation is committed without pushing or merging.
