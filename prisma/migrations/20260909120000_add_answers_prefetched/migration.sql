-- Records whether an attempt was taken after the answer key began shipping with
-- GET /api/sprachbausteine/exercise.
--
-- Additive and defaulted, so existing rows backfill to true. That is the honest
-- value for them: this column exists precisely because attempts from here on
-- cannot be assumed answer-blind, and rows written before it are indistinguishable
-- from rows written after by any other means.
ALTER TABLE "sprachbausteine_attempts"
  ADD COLUMN "answers_prefetched" BOOLEAN NOT NULL DEFAULT true;
