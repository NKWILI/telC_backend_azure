# Phase 1 Todo: Center Identity and Profile

Companion to `tasks/phases/01-center-identity-plan.md`.

## Approval gate

- [x] Inspect existing auth, token, email, validation, rate-limit, Valkey, Prisma, and test patterns
- [x] Define Phase 1 API contract and threat model
- [ ] Human approves the four defaults in the plan's Approval Decision
- [ ] Human approves this specific Phase 1 plan
- [ ] Confirm tracked worktree changes are limited to approved planning files
- [ ] Create `feature/center-identity` only after approval

## Task 1: Schema

- [ ] Write failing/schema contract check where applicable
- [ ] Add `Center`, `CenterUser`, `CenterDeviceSession`, and `CenterUserRole`
- [ ] Add additive Prisma migration with reviewed FK actions and unique constraints
- [ ] Prisma validate/generate and production build pass
- [ ] Commit the green increment

## Task 2: Center tokens

- [ ] Write token isolation tests first
- [ ] Add center access/refresh payload types
- [ ] Add center token generation and verification to `TokenService`
- [ ] Prove student, guest, and center token types cannot cross
- [ ] Commit the green increment

## Task 3: Center emails

- [ ] Write email transport/template tests first
- [ ] Add center verification, existing-account, and reset emails
- [ ] Export only required auth infrastructure
- [ ] Keep all student email tests green
- [ ] Commit the green increment

## Task 4: Registration service

- [ ] Write new/duplicate/concurrent registration tests first
- [ ] Implement normalized, atomic center/owner creation
- [ ] Implement safe duplicate behavior and bcrypt-12 hashing
- [ ] Send verification after database commit
- [ ] Commit the green increment

## Task 5: Registration endpoint

- [ ] Write HTTP contract and rate-limit tests first
- [ ] Add registration DTO, controller, error contract, and module
- [ ] Reject invalid/extra input and preserve generic responses
- [ ] Pass Checkpoint A and human review
- [ ] Commit the green increment

## Task 6: Authentication/session service

- [ ] Write verification/login/session tests first
- [ ] Implement verification, login, token issuance, and three-device policy
- [ ] Implement atomic center refresh-hash rotation and revocation primitives
- [ ] Confirm no student table/session mutation
- [ ] Commit the green increment

## Task 7: Verify and login endpoints

- [ ] Write controller contract tests first
- [ ] Add typed DTOs and endpoints
- [ ] Add rate limiting and Swagger responses
- [ ] Verify generic credential and unverified-email behavior
- [ ] Commit the green increment

## Task 8: Refresh and logout

- [ ] Write replay and token-confusion tests first
- [ ] Add refresh and logout endpoints
- [ ] Prove exactly one concurrent refresh succeeds
- [ ] Prove logout invalidates protected access
- [ ] Commit the green increment

## Task 9: Password recovery

- [ ] Write enumeration, expiry, one-use, and session-revocation tests first
- [ ] Add forgot/reset endpoints and business logic
- [ ] Ensure student sessions are untouched
- [ ] Commit the green increment

## Task 10: Guard and profile

- [ ] Write authentication/IDOR/profile allowlist tests first
- [ ] Add center guard and current-center-user decorator
- [ ] Add `GET/PATCH /api/centers/me`
- [ ] Pass Checkpoint B and human review
- [ ] Commit the green increment

## Task 11: Final integration

- [ ] Wire `CentersModule` into `AppModule`
- [ ] Add critical center identity e2e flow
- [ ] Update Swagger/API documentation
- [ ] Run full unit suite
- [ ] Run full e2e suite
- [ ] Run production build
- [ ] Run lint and inspect auto-fix diff
- [ ] Run code-quality and security reviews
- [ ] Report changes, non-changes, concerns, and verification evidence
- [ ] Human approves merge; do not push or merge automatically
