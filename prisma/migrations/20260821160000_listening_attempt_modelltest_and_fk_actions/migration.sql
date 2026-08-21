-- ============================================================
-- Two changes, both time-sensitive before a second Modelltest is seeded.
--
-- 1. listening_attempts.modelltest_id
--    WritingAttempt and SprachbausteineAttempt already record which exam an
--    attempt belongs to; ListeningAttempt did not. Existing rows can only be
--    attributed with confidence while one exam exists, so the backfill has to
--    happen now.
--
--    The backfill is driven by the content_revision prefix, not applied
--    blanket. Production on 2026-08-21 held 31 rows:
--        24  modelltest-1-teil-1-v1
--         3  modelltest-1-teil-2-v1
--         4  mock-horen-teil-1-v1     <- belongs to no exam
--    Attributing those last four to Modelltest 1 would be inventing data. They
--    stay NULL, which is why the column is nullable.
--
-- 2. Foreign key actions on modelltest_id
--    All six exercise tables carry ON DELETE SET NULL, which was correct while
--    the column was nullable. Migration 20260821120000 made it NOT NULL and did
--    not revisit the actions, leaving a self-contradictory pair: "on delete,
--    set this to NULL" on a column that cannot be NULL.
--
--    Deleting a Modelltest currently fails with a not-null violation instead of
--    a foreign key violation. The delete is still prevented, so no data is at
--    risk, but that is accidental rather than intended and the error misleads.
--    RESTRICT states the intent directly and matches what schema.prisma
--    describes now that the relation is required.
--
-- No data is deleted or overwritten by this migration.
-- ============================================================

BEGIN;

-- ── 1. Attribute listening attempts to an exam ────────────────

ALTER TABLE "listening_attempts"
  ADD COLUMN IF NOT EXISTS "modelltest_id" UUID;

-- Prefix-driven: 'modelltest-<n>-...' -> the Modelltest numbered <n>.
-- Anything else (mock-horen-*, NULL) is left unattributed on purpose.
UPDATE "listening_attempts" la
   SET "modelltest_id" = m."id"
  FROM "modelltests" m
 WHERE la."modelltest_id" IS NULL
   AND la."content_revision" ~ '^modelltest-[0-9]+-'
   AND m."number" = (substring(la."content_revision" from '^modelltest-([0-9]+)-'))::int;

-- ── 2. Make the FK actions agree with the NOT NULL columns ────

ALTER TABLE "lesen_teil1_exercises"
  DROP CONSTRAINT "lesen_teil1_exercises_modelltest_id_fkey",
  ADD  CONSTRAINT "lesen_teil1_exercises_modelltest_id_fkey"
       FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
       ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lesen_teil2_exercises"
  DROP CONSTRAINT "lesen_teil2_exercises_modelltest_id_fkey",
  ADD  CONSTRAINT "lesen_teil2_exercises_modelltest_id_fkey"
       FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
       ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lesen_teil3_exercises"
  DROP CONSTRAINT "lesen_teil3_exercises_modelltest_id_fkey",
  ADD  CONSTRAINT "lesen_teil3_exercises_modelltest_id_fkey"
       FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
       ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sprachbausteine_exercises"
  DROP CONSTRAINT "sprachbausteine_exercises_modelltest_id_fkey",
  ADD  CONSTRAINT "sprachbausteine_exercises_modelltest_id_fkey"
       FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
       ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sprachbausteine_teil2_exercises"
  DROP CONSTRAINT "sprachbausteine_teil2_exercises_modelltest_id_fkey",
  ADD  CONSTRAINT "sprachbausteine_teil2_exercises_modelltest_id_fkey"
       FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
       ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "writing_exercises"
  DROP CONSTRAINT "writing_exercises_modelltest_id_fkey",
  ADD  CONSTRAINT "writing_exercises_modelltest_id_fkey"
       FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
       ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

-- Verification after applying:
--   SELECT COALESCE(content_revision,'(null)') AS rev,
--          COUNT(*) FILTER (WHERE modelltest_id IS NOT NULL) AS attributed,
--          COUNT(*) AS total
--     FROM listening_attempts GROUP BY 1 ORDER BY 3 DESC;
--   -- modelltest-1-* rows attributed; mock-horen-* rows must stay unattributed
--
--   SELECT conname, confdeltype FROM pg_constraint
--    WHERE contype='f' AND conname LIKE '%modelltest_id_fkey';
--   -- confdeltype must be 'r' (RESTRICT) on all six
