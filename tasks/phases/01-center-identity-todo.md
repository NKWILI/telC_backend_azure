# Phase 1 Todo: Center Identity and Profile

Companion to `tasks/phases/01-center-identity-plan.md`.

## Approval gate

- [x] Inspect existing auth, token, email, validation, rate-limit, Valkey, Prisma, and test patterns
- [x] Define Phase 1 API contract and threat model
- [x] Human approves the four defaults in the plan's Approval Decision
- [x] Human approves this specific Phase 1 plan
- [x] Confirm tracked worktree changes are limited to approved planning files
- [x] Create `feature/center-identity` only after approval

## Task 1: Schema

- [x] Write failing/schema contract check where applicable
- [x] Add `Center`, `CenterUser`, `CenterDeviceSession`, and `CenterUserRole`
- [x] Add additive Prisma migration with reviewed FK actions and unique constraints
- [x] Prisma validate/generate and production build pass
- [x] Commit the green increment

## Task 2: Center tokens

- [x] Write token isolation tests first
- [x] Add center access/refresh payload types
- [x] Add center token generation and verification to `TokenService`
- [x] Prove student, guest, and center token types cannot cross
- [x] Commit the green increment

## Task 3: Center emails

- [x] Write email transport/template tests first
- [x] Add center verification, existing-account, and reset emails
- [x] Export only required auth infrastructure
- [x] Keep all student email tests green
- [x] Commit the green increment

## Task 4: Registration service

- [x] Write new/duplicate/concurrent registration tests first
- [x] Implement normalized, atomic center/owner creation
- [x] Implement safe duplicate behavior and bcrypt-12 hashing
- [x] Send verification after database commit
- [x] Commit the green increment

## Task 5: Registration endpoint

- [x] Write HTTP contract and rate-limit tests first
- [x] Add registration DTO, controller, error contract, and module
- [x] Reject invalid/extra input and preserve generic responses
- [x] Pass Checkpoint A and human review
- [x] Commit the green increment

## Task 6: Authentication/session service

- [x] Write verification/login/session tests first
- [x] Implement verification, login, token issuance, and three-device policy
- [x] Implement atomic center refresh-hash rotation and revocation primitives
- [x] Confirm no student table/session mutation
- [x] Commit the green increment

## Task 7: Verify and login endpoints

- [x] Write controller contract tests first
- [x] Add typed DTOs and endpoints
- [x] Add rate limiting and Swagger responses
- [x] Verify generic credential and unverified-email behavior
- [x] Commit the green increment

## Task 8: Refresh and logout

- [x] Write replay and token-confusion tests first
- [x] Add refresh and logout endpoints
- [x] Prove exactly one concurrent refresh succeeds
- [x] Prove logout invalidates protected access
- [x] Commit the green increment

## Task 9: Password recovery

- [x] Write enumeration, expiry, one-use, and session-revocation tests first
- [x] Add forgot/reset endpoints and business logic
- [x] Ensure student sessions are untouched
- [x] Commit the green increment

## Task 10: Guard and profile

- [x] Write authentication/IDOR/profile allowlist tests first
- [x] Add center guard and current-center-user decorator
- [x] Add `GET/PATCH /api/centers/me`
- [ ] Pass Checkpoint B and human review
- [x] Commit the green increment

## Task 11: Final integration

- [x] Wire `CentersModule` into `AppModule`
- [ ] Add critical center identity e2e flow
- [ ] Update Swagger/API documentation
- [ ] Run full unit suite
- [ ] Run full e2e suite
- [ ] Run production build
- [ ] Run lint and inspect auto-fix diff
- [ ] Run code-quality and security reviews
- [ ] Report changes, non-changes, concerns, and verification evidence
- [ ] Human approves merge; do not push or merge automatically
