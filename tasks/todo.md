# Todo — Sprachbausteine Teil 2 Module

## Phase 1 — Database: schema, migration

- [ ] Add `SprachbausteineTeil2Exercise` model to `prisma/schema.prisma`
- [ ] Add `SprachbausteineTeil2Word` model to `prisma/schema.prisma` (FK → exercise, sortOrder)
- [ ] Add `SprachbausteineTeil2Gap` model to `prisma/schema.prisma` (FK → exercise, non-null FK → word, @@unique on [exerciseId, gapKey])
- [ ] Run `npx prisma migrate dev --name sprachbausteine_teil2_schema`
- [ ] Run `npx prisma generate`
- [ ] Verify: 3 tables exist (`sprachbausteine_teil2_exercises`, `sprachbausteine_teil2_words`, `sprachbausteine_teil2_gaps`)
- [ ] Verify: `correctWordId` on gaps is NOT NULL (non-nullable FK)
- [ ] Verify: `@@unique([exerciseId, gapKey])` constraint present on gaps table

## ✦ CHECKPOINT 1 — Migration clean, `npm run build` exits 0

## Phase 2 — Seed data

- [ ] Write `006_seed_sprachbausteine_teil2_modelltest1.sql` at project root:
  - Let DB generate all UUIDs (no hardcoded UUIDs in INSERT statements)
  - 1 exercise row (`contentRevision = 'modelltest-1-sprachbausteine-teil2-v1'`, full body text with -31- through -40- markers)
  - 15 words inserted via multi-row INSERT or `unnest` — letter column is the stable identifier
  - 10 gaps inserted with `correctWordId` via `(SELECT id FROM … WHERE letter = 'x')` subquery — correct answers: 31→a 32→m 33→d 34→c 35→o 36→n 37→g 38→e 39→h 40→l
  - Decoys (no gap references): b(ARBEIT) f(BESONDEREN) i(KARRIERE) j(LESEN) k(NAHM)
- [ ] Run seed via Node.js pg client
- [ ] Verify: `SELECT COUNT(*) FROM sprachbausteine_teil2_exercises` → 1
- [ ] Verify: `SELECT COUNT(*) FROM sprachbausteine_teil2_words` → 15
- [ ] Verify: `SELECT COUNT(*) FROM sprachbausteine_teil2_gaps` → 10
- [ ] Verify: 5 decoy words have no gap referencing them (LEFT JOIN check)
- [ ] Verify gap 31 → ANZEIGE (cross-join query on correctWordId)

## ✦ CHECKPOINT 2 — Seed verified, all row counts correct, 5 decoys confirmed

## Phase 3 — DTOs

- [ ] Create `src/modules/sprachbausteine/dto/sprachbausteine-word-bank-item.dto.ts` (`id`, `letter`, `content`)
- [ ] Create `src/modules/sprachbausteine/dto/sprachbausteine-teil2-gap.dto.ts` (`id`, `correctWordId`)
- [ ] Create `src/modules/sprachbausteine/dto/sprachbausteine-teil2.dto.ts` (`label`, `instruction`, `durationMinutes`, `body`, `wordBank`, `gaps`)
- [ ] Update `src/modules/sprachbausteine/dto/sprachbausteine-exercise-response.dto.ts` — change `teil2: SprachbausteineTeilDto` → `teil2: SprachbausteineTeil2Dto`
- [ ] Update `src/modules/sprachbausteine/dto/index.ts` — add 3 new exports
- [ ] Run `npm run build` → exits 0

## Phase 4 — Service (TDD: test first, then implement)

- [ ] Add `sprachbausteineTeil2Exercise: { findFirst: jest.fn() }` to `mockPrisma` in `sprachbausteine.service.spec.ts`
- [ ] Add `mockTeil2Exercise` constant (1 exercise, 15 words, 10 gaps with correct UUID→word mappings)
- [ ] Update existing `getExercise` test: add `mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise)` and replace old `teil2` assertion with `expect(result.teil2.wordBank).toHaveLength(15)` and `expect(result.teil2.gaps).toHaveLength(10)`
- [ ] Write failing test: shape (15 wordBank items, 10 gaps, "w"+letter ids, no raw UUIDs in ids)
- [ ] Write failing test: full answer key (all 10 gaps map to correct "w"+letter correctWordId)
- [ ] Write failing test: NotFoundException when no Teil 2 exercise found
- [ ] Implement `getTeil2Exercise()` on `SprachbausteineService` (query → wordIdMap → wordBank + gaps)
- [ ] Update `getExercise()` — replace stub `teil2: { ... }` with `Promise.all` call to `getTeil2Exercise()`
- [ ] Run `npm test` → new 3 tests pass, updated existing test passes, no regressions

## ✦ CHECKPOINT 3 — `npm test` all green, `npm run build` exits 0

## Phase 5 — End-to-end verification

- [ ] Start dev server: `npm run start:dev`
- [ ] `jq '.teil2.wordBank | length'` → 15
- [ ] `jq '.teil2.gaps | length'` → 10
- [ ] `jq '.teil2.wordBank[0]'` → `{ "id": "wa", "letter": "a", "content": "ANZEIGE" }`
- [ ] `jq '.teil2.wordBank[14]'` → `{ "id": "wo", "letter": "o", "content": "VERBESSERT" }`
- [ ] `jq '.teil2.gaps[0]'` → `{ "id": "31", "correctWordId": "wa" }`
- [ ] `jq '.teil2.gaps[9]'` → `{ "id": "40", "correctWordId": "wl" }`
- [ ] `jq '[.teil2.wordBank[].id]'` → `["wa","wb","wc","wd","we","wf","wg","wh","wi","wj","wk","wl","wm","wn","wo"]`
- [ ] `jq '.teil1.gaps | length'` → 10 (no regression)
- [ ] `jq 'keys'` → includes `"teil1"` and `"teil2"`

## ✦ CHECKPOINT 4 — All curl checks pass, commit
