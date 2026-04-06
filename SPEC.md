# Spec — Listening (Hören) Module Backend

**Status:** Draft — 2026-04-06  
**Source:** `docs/listening_horen_rest.md`

---

## 1. Objective

Implement the `ListeningModule` in the existing NestJS backend (`telC_backend_azure`) to serve the four REST endpoints consumed by the `telC_frontend` Flutter app for the **Hören (Listening)** exam module.

Target users: telC exam students using the Flutter app.

---

## 2. Endpoints to Implement

### 2.1 `GET /api/listening/teils`
Returns the static list of listening exercise types with per-student progress.

**Response:** `ExerciseTypeDto[]` (same shape as `/api/writing/teils`)

Static Teile (3 parts):
| id | title | subtitle | durationMinutes |
|----|-------|----------|-----------------|
| `"1"` | Teil 1 | Globales Hören | 10 |
| `"2"` | Teil 2 | Detailliertes Hören | 10 |
| `"3"` | Teil 3 | Selektives Hören | 10 |

Progress is computed from `listening_attempts` (100 if ≥1 completed attempt, else 0).

---

### 2.2 `GET /api/listening/sessions`
Returns past attempts for the authenticated student, optionally filtered by `teilNumber` (query param, int).

**Response:** `ExerciseAttemptDto[]`  
**Source table:** `listening_attempts`  
**Fields mapped:**
- `attempt_id` → `id`
- `created_at` / `completed_at` → `date`, `dateLabel`
- `score`, `feedback`, `duration_seconds` → same camelCase fields

---

### 2.3 `GET /api/listening/exercise?type=<teilId>`
Returns the full exercise payload for a given Teil: audio metadata + questions with options.

**Response shape:**
```json
{
  "content_revision": "mock-horen-teil-1-v1",
  "issued_at": "<ISO 8601>",
  "audio_url": "",
  "bundled_audio_asset": "images/modules/Telc - A1.mp3",
  "questions": [
    {
      "id": "q11",
      "prompt": "...",
      "options": [
        { "id": "a", "label": "..." },
        { "id": "b", "label": "..." },
        { "id": "c", "label": "..." }
      ]
    }
  ]
}
```

In the initial implementation, exercise data is **static/mock** (hardcoded catalog), mirroring how Writing uses `STATIC_TEILS`. A future migration to a database-backed catalog is out of scope here.

---

### 2.4 `POST /api/listening/submit`
Receives student answers, scores them against the answer key, persists the attempt, and returns the score.

**Request body:**
```json
{
  "type": "1",
  "timed": true,
  "content_revision": "mock-horen-teil-1-v1",
  "answers": { "q11": "a", "q12": "c" }
}
```

**Response:** `{ "score": 85 }` (0–100)

**Scoring:** percentage of correct answers × 100, rounded to nearest integer.

**Validation:**
- `type` must match a known Teil id
- `content_revision` must match the current revision for that Teil (returns 422 if stale)
- `answers` must be a non-empty object

**Persistence:** Insert a row into `listening_attempts` with status `'completed'`, computed score, duration (null for now), feedback (null).

---

## 3. Project Structure

Following the existing pattern (Writing/Speaking modules):

```
src/modules/listening/
  dto/
    exercise-type.dto.ts          ← re-export from shared or duplicate (same shape)
    exercise-attempt.dto.ts       ← re-export or duplicate
    listening-exercise.dto.ts     ← GET /exercise response shape
    submit-listening.dto.ts       ← POST /submit request body
    submit-listening-response.dto.ts
    index.ts
  listening.controller.ts
  listening.service.ts
  listening.module.ts
```

**Shared DTOs:** `ExerciseTypeDto` and `ExerciseAttemptDto` are already defined in `src/modules/writing/dto/`. Re-use them via import (no duplication).

**Database table:** `listening_attempts`
```sql
-- Supabase / Postgres
create table listening_attempts (
  attempt_id     uuid primary key default gen_random_uuid(),
  student_id     text not null,
  exercise_id    text not null,
  status         text not null default 'completed',
  score          int,
  feedback       text,
  duration_seconds int,
  content_revision text,
  timed          boolean,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
```

---

## 4. Code Style

- NestJS conventions: `@Controller`, `@Get`, `@Post`, `@Query`, `@Body`, `@UseGuards(JwtAuthGuard)`, `@CurrentStudent()` decorator.
- TypeScript interfaces for DTOs (not classes), same as Writing module.
- Static catalog defined as a `const` array in `listening.service.ts`, same as `STATIC_TEILS` pattern.
- Logger via `new Logger(ListeningService.name)`.
- All errors use NestJS exceptions (`NotFoundException`, `UnprocessableEntityException`).
- No rate limiting on submit (unlike Writing) — listening is auto-scored, no LLM call needed.
- camelCase JSON keys (Flutter client expectation).

---

## 5. Testing Strategy

Unit tests (`listening.service.spec.ts`):
- `getTeils` returns 3 items with progress 0 when no attempts
- `getTeils` returns progress 100 for a Teil with a completed attempt
- `getSessions` returns empty array on DB error
- `getSessions` filters by teilNumber correctly
- `getExercise` throws 404 for unknown type
- `getExercise` returns correct shape for valid type
- `submit` throws 422 for unknown type
- `submit` throws 422 for stale `content_revision`
- `submit` throws 422 for empty answers
- `submit` calculates score correctly (all correct, partial, all wrong)
- `submit` inserts row and returns score

Mocking pattern: mock `DatabaseService` same as Writing tests.

---

## 6. Boundaries

**Always do:**
- Guard all endpoints with `JwtAuthGuard`
- Return `[]` (not 500) when DB fetch fails (same as Writing)
- Validate `content_revision` on submit to prevent scoring stale exercises

**Ask first about:**
- Whether audio files are served from Azure Blob Storage or bundled as Flutter assets (currently spec uses bundled asset path)
- Whether a 3rd Teil needs different question count than Teile 1 & 2

**Never do:**
- Call Gemini/LLM for scoring (answers are auto-scored against a hardcoded key)
- Add a WebSocket gateway (not required by the API spec)
- Expose the answer key in any GET response

---

## 7. Acceptance Criteria

- [ ] `GET /api/listening/teils` returns 3 items, each with a valid `progress` field
- [ ] `GET /api/listening/sessions` returns filtered results; empty array if no attempts
- [ ] `GET /api/listening/exercise?type=1` returns a payload with `questions` array and `content_revision`
- [ ] `GET /api/listening/exercise?type=99` returns 404
- [ ] `POST /api/listening/submit` with valid body returns `{ score: <0-100> }`
- [ ] `POST /api/listening/submit` with wrong `content_revision` returns 422
- [ ] All endpoints return 401 without a valid JWT
- [ ] Unit tests pass (`npm test`)
- [ ] `ListeningModule` is registered in `AppModule`
