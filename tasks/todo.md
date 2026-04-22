# Todo — Sprachbausteine Module

## Task 1 — Database: schema, migration, seed
- [ ] Add `SprachbausteineExercise` model to `prisma/schema.prisma`
- [ ] Add `SprachbausteineGap` model to `prisma/schema.prisma` (FK → exercise, `sort_order`)
- [ ] Add `SprachbausteineGapOption` model to `prisma/schema.prisma` (FK → gap, `is_correct`, `sort_order`)
- [ ] Run `npx prisma migrate dev --name sprachbausteine_schema`
- [ ] Run `002_seed_modelltest1.sql` against the database
- [ ] Verify: 1 exercise, 10 gaps, 30 options in DB

## Task 2 — GET /exercise: DTOs + service + controller
- [ ] Create `src/modules/sprachbausteine/dto/sprachbausteine-option.dto.ts`
- [ ] Create `src/modules/sprachbausteine/dto/sprachbausteine-gap.dto.ts`
- [ ] Create `src/modules/sprachbausteine/dto/sprachbausteine-exercise-response.dto.ts`
- [ ] Create `src/modules/sprachbausteine/dto/index.ts`
- [ ] Create `src/modules/sprachbausteine/sprachbausteine.service.ts` with `getExercise()`
- [ ] Create `src/modules/sprachbausteine/sprachbausteine.controller.ts` with `GET /exercise`
- [ ] Create `src/modules/sprachbausteine/sprachbausteine.module.ts`
- [ ] Register `SprachbausteineModule` in `src/app.module.ts`
- [ ] Manual test: `GET /api/sprachbausteine/exercise` returns 10 gaps, 3 options each, non-null `correctOptionId`

## ✦ CHECKPOINT 1 — Review GET endpoint before continuing

## Task 3 — POST /submit: DTO + service stub + controller
- [ ] Create `src/modules/sprachbausteine/dto/submit-sprachbausteine.dto.ts` with class-validator decorators
- [ ] Add `submit()` stub to `SprachbausteineService` (returns `{ score: 0 }`)
- [ ] Add `POST /submit` to `SprachbausteineController`
- [ ] Manual test: valid body → `{ score: 0 }`, missing field → 400

## ✦ CHECKPOINT 2 — Review full API, run `npm run build`

## Task 4 — Unit tests
- [ ] Create `src/modules/sprachbausteine/sprachbausteine.service.spec.ts`
- [ ] Test: `getExercise` returns correct DTO shape (10 gaps, correctOptionId non-null)
- [ ] Test: `getExercise` throws 404 when no exercise in DB
- [ ] Test: `submit` returns `{ score: 0 }`
- [ ] Run `npm test` — all pass
