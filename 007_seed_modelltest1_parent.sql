-- ============================================================
-- MIGRATION 007 — Wire Modelltest 1 parent row
-- Run AFTER migration 20260505120000_create_modelltests_and_fks
-- ============================================================

-- Step 1: insert the Modelltest 1 parent row
INSERT INTO modelltests (number, title)
VALUES (1, 'Modelltest 1')
ON CONFLICT (number) DO NOTHING;

-- Step 2: wire each exercise table to the parent row
-- content_revision values confirmed from SELECT DISTINCT queries on 2026-05-05

UPDATE sprachbausteine_exercises
  SET modelltest_id = (SELECT id FROM modelltests WHERE number = 1)
  WHERE content_revision = 'modelltest-1-v1';

UPDATE sprachbausteine_teil2_exercises
  SET modelltest_id = (SELECT id FROM modelltests WHERE number = 1)
  WHERE "contentRevision" = 'modelltest-1-sprachbausteine-teil2-v1';

UPDATE lesen_teil1_exercises
  SET modelltest_id = (SELECT id FROM modelltests WHERE number = 1)
  WHERE "contentRevision" = 'modelltest-1-lesen-teil1-v1';

UPDATE lesen_teil2_exercises
  SET modelltest_id = (SELECT id FROM modelltests WHERE number = 1)
  WHERE "contentRevision" = 'modelltest-1-lesen-teil2-v1';

UPDATE lesen_teil3_exercises
  SET modelltest_id = (SELECT id FROM modelltests WHERE number = 1)
  WHERE "contentRevision" = 'modelltest-1-lesen-teil3-v1';

-- Verification query (run after applying):
-- SELECT t.table_name, COUNT(*) as wired
-- FROM information_schema.tables t
-- JOIN (
--   SELECT 'sprachbausteine_exercises' AS tbl, COUNT(*) AS n FROM sprachbausteine_exercises WHERE modelltest_id IS NOT NULL
--   UNION ALL SELECT 'sprachbausteine_teil2_exercises', COUNT(*) FROM sprachbausteine_teil2_exercises WHERE modelltest_id IS NOT NULL
--   UNION ALL SELECT 'lesen_teil1_exercises', COUNT(*) FROM lesen_teil1_exercises WHERE modelltest_id IS NOT NULL
--   UNION ALL SELECT 'lesen_teil2_exercises', COUNT(*) FROM lesen_teil2_exercises WHERE modelltest_id IS NOT NULL
--   UNION ALL SELECT 'lesen_teil3_exercises', COUNT(*) FROM lesen_teil3_exercises WHERE modelltest_id IS NOT NULL
-- ) counts ON t.table_name = counts.tbl
-- WHERE t.table_schema = 'public'
-- GROUP BY t.table_name;
