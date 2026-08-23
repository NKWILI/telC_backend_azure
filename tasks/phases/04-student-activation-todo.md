# Phase 4 Todo: Center-Managed Student Activation

Companion to `tasks/phases/04-student-activation-plan.md`.

## Approval gate

- [ ] Human answers the four open questions
- [ ] Human approves this specific plan
- [ ] Create `feature/student-activation` from `dev`

## Task 1: Activation schema

- [ ] Add activation_key_hash, activation_key_expires, activated_at to Student
- [ ] Additive migration; existing students unaffected
- [ ] Prisma validate and build pass
- [ ] Commit the green increment

## Task 2: Provisioning with seat enforcement

- [ ] Write seat-limit and concurrency tests first
- [ ] Count and insert inside one Serializable transaction
- [ ] Store only the key hash; return the raw key once
- [ ] Created student has no password
- [ ] Commit the green increment

## Task 3: Activation and the trial trigger

- [ ] Write replay, expiry and trial-start tests first
- [ ] Consume the key with one predicated update
- [ ] Student sets their own password
- [ ] First activation starts the trial; a second must not move it
- [ ] Commit the green increment

## Checkpoint A

- [ ] Seat concurrency and the trial trigger both proven
- [ ] Full suite green, build exit 0
- [ ] Human review before endpoints exist

## Task 4: Center student endpoints

- [ ] Write contract tests first
- [ ] List, get, patch, delete, mint key, revoke key
- [ ] Another center's student returns 404, never 403
- [ ] PATCH rejects email, password, center_id, activated_at
- [ ] DELETE unlinks and frees the seat; the account survives
- [ ] Commit the green increment

## Task 5: Public activation endpoint

- [ ] Write contract tests first
- [ ] Strict DTO, IP rate limiting, generic failure messages
- [ ] Commit the green increment

## Task 6: Integration tests

- [ ] Concurrent provisioning at the last seat: one wins
- [ ] Concurrent activation of one key: one wins
- [ ] Trial starts once and does not move
- [ ] Unlinking preserves the student and their sessions
- [ ] Commit the green increment

## Task 7: Bruno collection

- [ ] Center Students folder covering the full flow
- [ ] Student Activation request
- [ ] Document the manual checks the suites cannot make
- [ ] Commit the green increment

## Task 8: Gates and review

- [ ] Unit, e2e, integration, build and lint by exit code
- [ ] Code-quality and security review
- [ ] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`; do not push or merge automatically
