# Plan — Sprachbausteine Module

**Date:** 2026-04-22  
**Feature:** `GET /api/sprachbausteine/exercise` + `POST /api/sprachbausteine/submit`  
**Source:** User spec (10-step guide) + `001_schema.sql` + `002_seed_modelltest1.sql`

---

## Context

The project already has:
- **Prisma** wired up: `PrismaService`, `PrismaModule`, imported in `AppModule`
- **Global ValidationPipe** in `main.ts` (`whitelist`, `forbidNonWhitelisted`, `transform: true`) — no changes needed
- **Pattern to follow**: Listening/Writing modules (service + controller + module + typed DTOs)
- **No Sprachbausteine models** in `prisma/schema.prisma` — the 3 SQL tables must be added

---

## Dependency Graph

```
[A] Add 3 Prisma models to schema.prisma
         ↓
[B] Run prisma migrate dev
         ↓
[C] Run 002_seed_modelltest1.sql → 1 exercise, 10 gaps, 30 options
         ↓
    ┌────┴─────────────────────────────────────┐
[D] Define response DTOs                [E] nothing (parallel)
    └────┬─────────────────────────────────────┘
         ↓
[F] Service.getExercise() — DB query + mapping to DTO
         ↓
[G] Module + Controller: GET /api/sprachbausteine/exercise
         ↓
══════ CHECKPOINT 1 ══════
         ↓
[H] SubmitSprachbausteineDto (class-validator)
         ↓
[I] Service.submit() — stub { score: 0 }
         ↓
[J] Controller: POST /api/sprachbausteine/submit
         ↓
══════ CHECKPOINT 2 ══════
         ↓
[K] Unit tests for service
```

---

## Tasks

### Task 1 — Database: schema, migration, seed
**Slice:** A → B → C (foundation; nothing else can proceed without it)

**What to do:**
1. Add three models to `prisma/schema.prisma`:
   - `SprachbausteineExercise` mapping to `sprachbausteine_exercises`
   - `SprachbausteineGap` mapping to `sprachbausteine_gaps` (FK → exercise)
   - `SprachbausteineGapOption` mapping to `sprachbausteine_gap_options` (FK → gap)
   - Include `sort_order` fields and `is_correct` boolean on options
2. Run `npx prisma migrate dev --name sprachbausteine_schema`
3. Run `002_seed_modelltest1.sql` directly against the database (psql or Supabase SQL editor)

**Acceptance criteria:**
- `prisma migrate dev` exits 0 with a new migration file
- `SELECT COUNT(*) FROM sprachbausteine_exercises` → 1
- `SELECT COUNT(*) FROM sprachbausteine_gaps` → 10
- `SELECT COUNT(*) FROM sprachbausteine_gap_options` → 30

**Verification:**
```bash
npx prisma studio   # browse all three tables
# or
psql $DATABASE_URL -c "SELECT COUNT(*) FROM sprachbausteine_exercises;"
```

---

### Task 2 — GET /exercise: DTOs + service + controller (full vertical slice)
**Slice:** D → F → G  
**Depends on:** Task 1 complete (DB has data)

**What to do:**
1. Create `src/modules/sprachbausteine/dto/` with:
   - `sprachbausteine-option.dto.ts` — `{ id: string; content: string }`
   - `sprachbausteine-gap.dto.ts` — `{ id: string; options: SprachbausteineOptionDto[]; correctOptionId: string }`
   - `sprachbausteine-exercise-response.dto.ts` — `{ contentRevision: string; issuedAt: string; teil1: SprachbausteineTeilDto }` where `SprachbausteineTeilDto = { label, instruction, durationMinutes, body, gaps }`
   - `index.ts` re-exporting all
2. Create `src/modules/sprachbausteine/sprachbausteine.service.ts`:
   - Inject `PrismaService`
   - `getExercise()`: query `sprachbausteineExercise.findFirst({ include: { gaps: { include: { options: true }, orderBy: { sort_order: 'asc' } } }, orderBy: { sort_order: 'asc' for options })`
   - Map raw rows → response DTO: derive `correctOptionId` by finding the option where `is_correct === true`
   - Throw `NotFoundException` if no exercise found
3. Create `src/modules/sprachbausteine/sprachbausteine.controller.ts`:
   - `@Controller('api/sprachbausteine')`
   - `@Get('exercise')` — no auth guard for prototype
   - Call `sprachbausteineService.getExercise()` and return result
4. Create `src/modules/sprachbausteine/sprachbausteine.module.ts`:
   - Import `PrismaModule`
   - Declare controller and service
5. Register `SprachbausteineModule` in `src/app.module.ts` imports array

**Acceptance criteria:**
- `GET /api/sprachbausteine/exercise` returns 200 with:
  - `body` contains the full text with `-21-` through `-30-` markers
  - `gaps` array has exactly 10 items
  - Each gap has exactly 3 options
  - Each gap's `correctOptionId` points to a real option `id` in that gap's `options` array
  - Options are in a/b/c order (sort_order 0, 1, 2)
- `GET /api/sprachbausteine/exercise` with empty DB returns 404

**Verification:**
```bash
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil1.gaps | length'
# → 10
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil1.gaps[0].options | length'
# → 3
```

---

### CHECKPOINT 1 — GET endpoint review
Before continuing to the POST slice:
- [ ] Response shape matches the contract above
- [ ] `correctOptionId` is non-null for all 10 gaps
- [ ] Options arrive in a/b/c order (not database-insertion order)
- [ ] No secrets (answer keys, `is_correct` flags) are leaked in the response

---

### Task 3 — POST /submit: DTO + service stub + controller (full vertical slice)
**Slice:** H → I → J  
**Depends on:** Task 2 (controller/module scaffolding in place)

**What to do:**
1. Create `src/modules/sprachbausteine/dto/submit-sprachbausteine.dto.ts`:
   ```ts
   export class SubmitSprachbausteineDto {
     @IsString() id: string;
     @IsString() exercise_type_id: string;
     @IsString() teil_id: string;
     @IsInt() @Min(0) @Max(100) score_percent: number;
     @IsString() @IsOptional() remark?: string;
     @IsString() tested_at: string;
     @IsObject() answers: Record<string, string>;
   }
   ```
2. Add `submit(dto: SubmitSprachbausteineDto)` to the service:
   - Validate body arrives (ValidationPipe handles it)
   - Return `{ score: 0 }` (stub — no DB write yet)
3. Add `@Post('submit')` to the controller:
   - `@Body() dto: SubmitSprachbausteineDto`
   - Return service result

**Acceptance criteria:**
- `POST /api/sprachbausteine/submit` with valid body → `{ "score": 0 }`
- `POST /api/sprachbausteine/submit` with missing required field → 400 with validation error
- `POST /api/sprachbausteine/submit` with `score_percent: 150` → 400 (`@Max(100)`)

**Verification:**
```bash
curl -X POST http://localhost:3000/api/sprachbausteine/submit \
  -H "Content-Type: application/json" \
  -d '{"id":"x","exercise_type_id":"1","teil_id":"1","score_percent":75,"tested_at":"2026-04-22T10:00:00Z","answers":{"21":"c"}}'
# → { "score": 0 }

curl -X POST http://localhost:3000/api/sprachbausteine/submit \
  -H "Content-Type: application/json" \
  -d '{"id":"x"}'
# → 400
```

---

### CHECKPOINT 2 — Full API surface review
Before writing tests:
- [ ] GET returns correct structure with real seed data
- [ ] POST stub accepts and rejects bodies correctly
- [ ] No `is_correct` or answer key data leaks through any endpoint
- [ ] `AppModule` registers `SprachbausteineModule` without conflicts
- [ ] `npm run build` exits 0

---

### Task 4 — Unit tests for service
**Slice:** K  
**Depends on:** Task 2 + Task 3 complete

**What to do:**
Create `src/modules/sprachbausteine/sprachbausteine.service.spec.ts`.

Tests to write:
1. `getExercise` — when Prisma returns one exercise with 10 gaps/3 options each:
   - Returns `contentRevision` = `'modelltest-1-v1'`
   - `teil1.gaps` has length 10
   - Each gap's `correctOptionId` is a non-null string
2. `getExercise` — when Prisma returns `null`:
   - Throws `NotFoundException`
3. `submit` — with valid DTO:
   - Returns `{ score: 0 }`

Mocking pattern: mock `PrismaService` same as Writing tests (jest.fn() / jest mock on `sprachbausteineExercise.findFirst`).

**Acceptance criteria:**
- `npm test` exits 0 with all 3+ cases passing

---

## File Map

```
src/modules/sprachbausteine/
  dto/
    sprachbausteine-option.dto.ts
    sprachbausteine-gap.dto.ts
    sprachbausteine-exercise-response.dto.ts
    submit-sprachbausteine.dto.ts
    index.ts
  sprachbausteine.service.ts
  sprachbausteine.service.spec.ts
  sprachbausteine.controller.ts
  sprachbausteine.module.ts

prisma/schema.prisma          ← add 3 models
prisma/migrations/<timestamp>_sprachbausteine_schema/migration.sql  ← auto-generated
src/app.module.ts             ← add SprachbausteineModule
```

---

## Assumptions

1. `class-validator` and `class-transformer` are already installed (used by Listening/Writing DTO classes).
2. No JWT guard on the prototype endpoints — can be added later without touching the service.
3. The seed SQL runs directly against the DB; no need for a Prisma seed script.
4. `correctOptionId` is derived at read time from `is_correct`, not stored as a column — this is intentional (single source of truth in `sprachbausteine_gap_options`).
5. The GET endpoint returns only Modelltest 1 for now (`findFirst` with no filter) — a `?teil=1` query param is out of scope.
