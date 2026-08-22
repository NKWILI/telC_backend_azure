# Global Todo: Center Subscriptions and Student Activation

Companion to `tasks/center-subscription-global-plan.md`.

## Global planning gate

- [x] Inspect current Git state and preserve unrelated `tmp/`
- [x] Inspect existing NestJS modules, Prisma schema, auth/session infrastructure, tests, and documentation
- [x] Verify baseline unit suite: 35 suites / 367 tests pass
- [x] Verify baseline production build passes
- [x] Human approves the global architecture and phase order
- [x] Human authorizes progression into Phase 1 detailed planning; phase-specific defaults remain individually gated
- [x] Do not create a feature branch before this gate is approved

## Phase 1: Center identity and profile

- [ ] Write `tasks/phases/01-center-identity-plan.md`
- [ ] Resolve logo-storage choice required by the phase
- [x] Human approves the specific plan
- [x] Create `feature/center-identity` from the approved clean base
- [ ] Implement with TDD and incremental commits
- [ ] Pass focused tests, full tests, build, lint, and code review
- [ ] Human approves merge

## Phase 2: Partnership codes

- [ ] Write `tasks/phases/02-partnership-codes-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/partnership-codes`
- [ ] Implement secure CLI generation and atomic registration consumption
- [ ] Pass concurrency/security tests and regression gate
- [ ] Human approves merge

## Phase 3: Trial, subscription, and seats

- [ ] Write `tasks/phases/03-center-subscriptions-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/center-subscriptions`
- [ ] Implement policy and subscription/seat APIs
- [ ] Pass clock, state, and concurrency tests
- [ ] Human approves merge

## Phase 4: Student activation

- [ ] Resolve activation-key lifetime and seat-release policy
- [ ] Write `tasks/phases/04-student-activation-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/student-activation`
- [ ] Implement center student management and one-time activation
- [ ] Pass ownership, expiry, replay, and seat-concurrency tests
- [ ] Human approves merge

## Phase 5: Subscription access

- [ ] Resolve existing-student and guest-mode migration rules
- [ ] Write `tasks/phases/05-subscription-access-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/subscription-access`
- [ ] Apply subscription policy to every protected learning and refresh path
- [ ] Prove blocked access cannot be bypassed
- [ ] Human approves merge

## Phase 6: Payment records and pricing

- [ ] Write `tasks/phases/06-subscription-payments-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/subscription-payments`
- [ ] Implement backend-only pricing, payment records, and idempotency
- [ ] Pass amount-manipulation and retry tests
- [ ] Human approves merge

## Phase 7: Notch Pay

- [ ] Confirm Notch Pay merchant/test credentials and official current API contract
- [ ] Write `tasks/phases/07-notchpay-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/notchpay-checkout`
- [ ] Implement checkout and verified webhook fulfillment
- [ ] Pass provider sandbox, forgery, duplicate, and reordering tests
- [ ] Human approves merge

## Phase 8: Renewal and grace period

- [ ] Resolve reminder delivery channel
- [ ] Write `tasks/phases/08-subscription-renewal-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/subscription-renewal`
- [ ] Implement reminders, grace, blocking, and restoration
- [ ] Pass clock-controlled lifecycle and idempotent-job tests
- [ ] Human approves merge

## Phase 9: AI usage limits

- [ ] Decide paid AI quota after reviewing measured usage/cost
- [ ] Write `tasks/phases/09-ai-usage-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/ai-usage-limits`
- [ ] Implement atomic reservation, metering, and quota enforcement
- [ ] Prove denied requests never call the external AI provider
- [ ] Human approves merge

## Phase 10: Migration and rollout

- [ ] Write `tasks/phases/10-center-access-rollout-plan.md`
- [ ] Human approves the specific plan
- [ ] Create `feature/center-access-rollout`
- [ ] Migrate legacy paths and close registration/auth bypasses
- [ ] Complete full unit, integration, e2e, security, and rollback verification
- [ ] Human approves production rollout

## Initiative completion gate

- [ ] All phase branches are reviewed and merged
- [ ] Full test and build gates pass
- [ ] API and environment documentation is current
- [ ] Payment and subscription observability is operational
- [ ] Staged deployment succeeds
- [ ] Rollback procedure is verified
