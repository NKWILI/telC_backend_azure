-- The first, free-text location pair on centers, replaced by the structured
-- columns in phase 8 (D14). Production holds demo data only (not launched,
-- 2026-09-19), so nothing is carried over.

-- AlterTable
ALTER TABLE "centers" DROP COLUMN "city",
DROP COLUMN "country";

