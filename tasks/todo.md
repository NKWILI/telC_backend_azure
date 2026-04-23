# Todo — Lesen Teil 1 Module

## Task 1 — Database: schema, migration, seed
- [x] Add `LesenTeil1Exercise` model to `prisma/schema.prisma`
- [x] Add `LesenTeil1Title` model to `prisma/schema.prisma` (FK → exercise, `sortOrder`)
- [x] Add `LesenTeil1Text` model to `prisma/schema.prisma` (FK → exercise, FK `correctTitleId` → title, `von?`, `an?`)
- [x] Run `npx prisma migrate dev --name lesen_teil1_schema`
- [x] Run `npx prisma generate`
- [x] Verify `von` and `an` columns are nullable in DB
- [x] Run `004_seed_lesen_teil1_modelltest1.sql`
- [x] Verify: 1 exercise, 10 titles, 5 texts, each text has non-null `correctTitleId`
- [x] Verify: text 2 `von` and `an` are NULL

## Task 2 — DTOs + service + controller (full vertical slice)
- [x] Write failing test in `lesen.service.spec.ts` for `getTeil1Exercise()` (RED)
- [x] Create `src/modules/lesen/dto/lesen-teil1-title.dto.ts`
- [x] Create `src/modules/lesen/dto/lesen-teil1-text.dto.ts`
- [x] Create `src/modules/lesen/dto/lesen-teil1.dto.ts`
- [x] Update `lesen-exercise-response.dto.ts` to add `teil1: LesenTeil1Dto`
- [x] Update `dto/index.ts` to export new DTOs
- [x] Add `getTeil1Exercise()` to `LesenService`
- [x] Update `LesenController GET /exercise` to call both methods in parallel and merge
- [x] Run tests → GREEN
- [ ] Manual: `jq '.teil1.texts | length'` → 5
- [ ] Manual: `jq '.teil1.titles | length'` → 10
- [ ] Manual: `jq '.teil1.texts[1].von'` → null
- [ ] Manual: `jq '.teil1.texts[0] | has("correctTitleId")'` → false
- [ ] Manual: `jq '.teil1.correctMatches["1"]'` matches `Terminabsage` title id
- [ ] Manual: `jq '.teil1.correctMatches | keys | length'` → 5
- [ ] Manual: `jq '.teil1.titles[0].content'` → "Anfrage"
- [ ] Manual: `jq '.teil1.titles[9].content'` → "Übernachtung"
- [ ] Manual: `jq '.teil2.questions | length'` → 5 (no regression)

## ✦ CHECKPOINT 1 — All curl checks pass, `npm run build` exits 0

## Task 3 — Extend unit tests
- [x] Add `getTeil1Exercise` shape test (5 texts, 10 titles, null von/an on text 2, correctMatches map with 5 keys, no correctTitleId on texts)
- [x] Add `getTeil1Exercise` 404 test
- [x] Confirm existing Teil 2 tests still pass
- [x] Run `npm test` → all suites green

## ✦ CHECKPOINT 2 — `npm test` green, build clean, commit
