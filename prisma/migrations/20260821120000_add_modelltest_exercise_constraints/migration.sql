-- ============================================================
-- Constrain every exercise table to exactly one row per Modelltest.
--
-- Readiness audit findings 03 (no uniqueness guarantee) and 04
-- (modelltest_id nullable). Both are gates for seeding Modelltest 2:
--
--   NOT NULL  — a row with a NULL modelltest_id belongs to no exam and is
--               invisible to every filtered query. Harmless with one exam,
--               undiscoverable content with two.
--   UNIQUE    — nothing currently stops a seed running twice from inserting
--               a second Lesen Teil 1 for the same exam. Combined with an
--               unordered findFirst that produces a non-reproducible bug.
--
-- Preflight against the live database on 2026-08-21 (read-only):
--   all six tables: 1 row, 0 NULL modelltest_id, max 1 row per Modelltest.
-- Both constraints therefore apply without any data fix.
--
-- This migration is inherently safe: SET NOT NULL aborts if any NULL exists
-- and CREATE UNIQUE INDEX aborts if any duplicate exists. It fails loudly
-- rather than damaging data.
--
-- Deliberately NOT included: Prisma's generated diff also wanted to drop and
-- recreate all six foreign keys (unnecessary — Postgres allows SET NOT NULL
-- with an FK in place) and to alter writing_exercises.bullet_points /
-- created_at. That last one is pre-existing schema drift unrelated to this
-- change and should be handled on its own.
--
-- The attempt tables (writing_attempts, sprachbausteine_attempts) keep a
-- nullable modelltest_id on purpose: many attempts per Modelltest, and
-- historical rows predate the column.
-- ============================================================

BEGIN;

-- ── Finding 04: modelltest_id is required on exercise tables ──

ALTER TABLE "lesen_teil1_exercises"           ALTER COLUMN "modelltest_id" SET NOT NULL;
ALTER TABLE "lesen_teil2_exercises"           ALTER COLUMN "modelltest_id" SET NOT NULL;
ALTER TABLE "lesen_teil3_exercises"           ALTER COLUMN "modelltest_id" SET NOT NULL;
ALTER TABLE "sprachbausteine_exercises"       ALTER COLUMN "modelltest_id" SET NOT NULL;
ALTER TABLE "sprachbausteine_teil2_exercises" ALTER COLUMN "modelltest_id" SET NOT NULL;
ALTER TABLE "writing_exercises"               ALTER COLUMN "modelltest_id" SET NOT NULL;

-- ── Finding 03: at most one exercise per Modelltest per table ──

CREATE UNIQUE INDEX "lesen_teil1_exercises_modelltest_id_key"
  ON "lesen_teil1_exercises"("modelltest_id");
CREATE UNIQUE INDEX "lesen_teil2_exercises_modelltest_id_key"
  ON "lesen_teil2_exercises"("modelltest_id");
CREATE UNIQUE INDEX "lesen_teil3_exercises_modelltest_id_key"
  ON "lesen_teil3_exercises"("modelltest_id");
CREATE UNIQUE INDEX "sprachbausteine_exercises_modelltest_id_key"
  ON "sprachbausteine_exercises"("modelltest_id");
CREATE UNIQUE INDEX "sprachbausteine_teil2_exercises_modelltest_id_key"
  ON "sprachbausteine_teil2_exercises"("modelltest_id");
CREATE UNIQUE INDEX "writing_exercises_modelltest_id_key"
  ON "writing_exercises"("modelltest_id");

COMMIT;

-- Verification after applying:
--   SELECT table_name, is_nullable FROM information_schema.columns
--   WHERE column_name = 'modelltest_id' AND table_schema = 'public'
--   ORDER BY table_name;
--   -- the six *_exercises tables must read NO; the two *_attempts tables YES
