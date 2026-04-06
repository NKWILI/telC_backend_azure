# Implementation Plan: Listening (Hören) Module

## Overview

Add the `ListeningModule` to the NestJS backend. Four REST endpoints: `GET /api/listening/teils`, `GET /api/listening/sessions`, `GET /api/listening/exercise`, `POST /api/listening/submit`. Exercise content is hardcoded (no DB for catalog). Student attempts are persisted in the `listening_attempts` Supabase table. Scoring is automatic (no LLM).

## Architecture Decisions

- **Static catalog in service:** Questions, options, answer keys, and audio paths are hardcoded constants — same pattern as `STATIC_TEILS` in `WritingService`. No DB table for exercise content.
- **Re-use Writing DTOs:** `ExerciseTypeDto` and `ExerciseAttemptDto` are imported from `src/modules/writing/dto/` — not duplicated.
- **Submit DTOs use classes:** `SubmitListeningDto` uses a class with `class-validator` decorators (same as `SubmitWritingDto`) to enable NestJS `ValidationPipe`.
- **Response DTOs use interfaces:** All GET response shapes and the submit response are plain TypeScript interfaces.
- **No WebSocket, no rate limit:** Auto-scoring needs neither.

---

## Task List

### Phase 1: Foundation

#### Task 1: Create listening-specific DTOs
**Description:** Create the DTO files for the `ListeningModule`. These are pure type definitions — no logic. They must exist before any test file can compile.

**Acceptance criteria:**
- [ ] `src/modules/listening/dto/listening-exercise.dto.ts` defines `ListeningOptionDto`, `ListeningQuestionDto`, `ListeningExerciseDto` interfaces
- [ ] `src/modules/listening/dto/submit-listening.dto.ts` defines `SubmitListeningDto` class with `class-validator` decorators for `type` (string), `timed` (boolean), `content_revision` (string), `answers` (object)
- [ ] `src/modules/listening/dto/submit-listening-response.dto.ts` defines `SubmitListeningResponseDto` interface with `score: number`
- [ ] `src/modules/listening/dto/index.ts` re-exports all of the above plus `ExerciseTypeDto` and `ExerciseAttemptDto` from Writing

**Verification:**
- [ ] `npm run build` succeeds with no TS errors

**Dependencies:** None

**Files:**
- `src/modules/listening/dto/listening-exercise.dto.ts` *(new)*
- `src/modules/listening/dto/submit-listening.dto.ts` *(new)*
- `src/modules/listening/dto/submit-listening-response.dto.ts` *(new)*
- `src/modules/listening/dto/index.ts` *(new)*

**Estimated scope:** S

---

### Phase 2: Service — TDD cycle

#### Task 2: Write failing unit tests for ListeningService
**Description:** Write the full `listening.service.spec.ts` with a mocked `DatabaseService`. At this point `ListeningService` does not exist — every test must fail with a compile or import error. This defines the contract the service must satisfy.

**Acceptance criteria:**
- [ ] Test file imports `ListeningService` (file does not exist yet — expected compile failure)
- [ ] `getTeils` — returns 3 items with `progress: 0` when DB returns no rows
- [ ] `getTeils` — returns `progress: 100` for a Teil that has a completed attempt
- [ ] `getSessions` — returns `[]` on DB error (no throw)
- [ ] `getSessions` — filters by `teilNumber` when provided
- [ ] `getSessions` — returns all sessions when `teilNumber` is omitted
- [ ] `getExercise` — returns payload for valid type (`"1"`, `"2"`, `"3"`)
- [ ] `getExercise` — throws `NotFoundException` for unknown type
- [ ] `submit` — throws `UnprocessableEntityException` for unknown `type`
- [ ] `submit` — throws `UnprocessableEntityException` for stale `content_revision`
- [ ] `submit` — throws `UnprocessableEntityException` for empty `answers`
- [ ] `submit` — calculates score: all correct = 100, all wrong = 0, partial = expected %
- [ ] `submit` — inserts row and returns `{ score }`

**Verification:**
- [ ] `npm test -- --testPathPattern=listening.service` **fails** (red — expected at this step)

**Dependencies:** Task 1

**Files:**
- `src/modules/listening/listening.service.spec.ts` *(new)*

**Estimated scope:** M

---

#### Task 3: Implement ListeningService (make tests green)
**Description:** Implement `listening.service.ts` — static catalog, all four methods — until every test from Task 2 passes.

**Acceptance criteria:**
- [ ] `STATIC_CATALOG` constant defines 3 Teile, each with `exercisePayload` (realistic German exam questions) and `answerKey`
- [ ] Answer key is **not** included in the `getExercise` response
- [ ] `getTeils`, `getSessions`, `getExercise`, `submit` all satisfy the spec (see SPEC.md §2)

**Verification:**
- [ ] `npm test -- --testPathPattern=listening.service` passes (all green)
- [ ] `npm run build` succeeds

**Dependencies:** Task 2

**Files:**
- `src/modules/listening/listening.service.ts` *(new)*

**Estimated scope:** M

---

### Checkpoint: After Tasks 1–3
- [ ] `npm test -- --testPathPattern=listening.service` all green
- [ ] `npm run build` succeeds
- [ ] No regressions in existing tests (`npm test`)

---

### Phase 3: Controller — TDD cycle

#### Task 4: Write failing unit tests for ListeningController
**Description:** Write `listening.controller.spec.ts` with a mocked `ListeningService`. At this point the controller does not exist — tests must fail. Covers delegation, guard behaviour, and the `UnauthorizedException` on missing student.

**Acceptance criteria:**
- [ ] Test file imports `ListeningController` (does not exist yet — expected failure)
- [ ] `GET teils` — delegates to `service.getTeils(studentId)` and returns its result
- [ ] `GET teils` — returns `[]` when student is null
- [ ] `GET sessions` — delegates to `service.getSessions(studentId, teilNumber)`
- [ ] `GET sessions` — passes `undefined` for `teilNumber` when query param absent
- [ ] `GET exercise` — delegates to `service.getExercise(type)`
- [ ] `POST submit` — delegates to `service.submit(studentId, dto)` and returns result
- [ ] `POST submit` — throws `UnauthorizedException` when student is null

**Verification:**
- [ ] `npm test -- --testPathPattern=listening.controller` **fails** (red — expected)

**Dependencies:** Tasks 1, 3

**Files:**
- `src/modules/listening/listening.controller.spec.ts` *(new)*

**Estimated scope:** S

---

#### Task 5: Implement ListeningController and ListeningModule (make tests green)
**Description:** Implement the controller and module, then register `ListeningModule` in `AppModule`.

**Acceptance criteria:**
- [ ] `ListeningController` decorated with `@UseGuards(JwtAuthGuard)` and `@Controller('api/listening')`
- [ ] All four route handlers delegate to `ListeningService` with no inline business logic
- [ ] `ListeningModule` provides `ListeningController`, `ListeningService`, `DatabaseService`; imports `AuthModule`
- [ ] `ListeningModule` added to `AppModule` imports

**Verification:**
- [ ] `npm test -- --testPathPattern=listening.controller` passes (all green)
- [ ] `npm test` passes (full suite, no regressions)
- [ ] `npm run build` succeeds

**Dependencies:** Task 4

**Files:**
- `src/modules/listening/listening.controller.ts` *(new)*
- `src/modules/listening/listening.module.ts` *(new)*
- `src/app.module.ts` *(edit)*

**Estimated scope:** S

---

### Checkpoint: Complete
- [ ] `npm run build` succeeds
- [ ] `npm test` passes — all existing + 20+ new tests
- [ ] All 7 acceptance criteria from SPEC.md §7 are met
- [ ] Answer key absent from all GET responses (manual check)
- [ ] Ready for review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `listening_attempts` table doesn't exist in Supabase yet | High — `submit` will fail at runtime | Run the `CREATE TABLE` SQL from SPEC.md in Supabase before end-to-end testing |
| `class-validator` not running on `SubmitListeningDto` | Med — invalid bodies silently accepted | `ValidationPipe` is already global (Writing module relies on it); verify in `main.ts` |
| Writing DTOs import creates circular dependency | Low | Import is one-way: Listening → Writing DTOs; no reverse import |

## Open Questions

- *(Resolved)* Audio is bundled Flutter asset — no DB or Azure Blob needed.
- *(Resolved)* Questions are hardcoded — no DB table for exercise content.
