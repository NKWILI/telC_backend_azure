# Phase 4 Todo: Center-Managed Student Activation

Companion to `tasks/phases/04-student-activation-plan.md`.

## Approval gate

- [x] Human answers the four open questions
- [x] Human approves this specific plan
- [x] Create `feature/student-activation` from `dev`

## Task 1: Activation schema

- [x] Add activation_key_hash, activation_key_expires, activated_at to Student
- [x] Additive migration; existing students unaffected
- [x] Prisma validate and build pass
- [x] Commit the green increment

## Task 2: Provisioning with seat enforcement

- [x] Write seat-limit and concurrency tests first
- [x] Count and insert inside one Serializable transaction
- [x] Store only the key hash; return the raw key once
- [x] Created student has no password
- [x] Commit the green increment

## Task 3: Activation and the trial trigger

- [x] Write replay, expiry and trial-start tests first
- [x] Consume the key with one predicated update
- [x] Student sets their own password
- [x] First activation starts the trial; a second must not move it
- [x] Commit the green increment

## Checkpoint A

- [x] Seat concurrency and the trial trigger both proven
- [x] Full suite green, build exit 0
- [x] Human review before endpoints exist

## Task 4: Center student endpoints

- [x] Write contract tests first
- [x] List, get, patch, delete, mint key, revoke key
- [x] Another center's student returns 404, never 403
- [x] PATCH rejects email, password, center_id, activated_at
- [x] DELETE unlinks and frees the seat; the account survives
- [x] Commit the green increment

## Task 5: Public activation endpoint

- [x] Write contract tests first
- [x] Strict DTO, IP rate limiting, generic failure messages
- [x] Commit the green increment

## Task 6: Integration tests

- [x] Concurrent provisioning at the last seat: one wins
- [x] Concurrent activation of one key: one wins
- [x] Trial starts once and does not move
- [x] Unlinking preserves the student and their sessions
- [x] Commit the green increment

## Task 7: Bruno collection

- [x] Center Students folder covering the full flow
- [x] Student Activation request
- [x] Document the manual checks the suites cannot make
- [x] Commit the green increment

## Task 8: Gates and review

- [x] Unit, e2e, integration, build and lint by exit code
- [x] Code-quality and security review
- [x] Report changes, non-changes, concerns and evidence

## Checkpoint B

- [x] Manual pass through Bruno
- [x] Human approves merge to `dev` (2026-08-24); do not push or merge automatically
