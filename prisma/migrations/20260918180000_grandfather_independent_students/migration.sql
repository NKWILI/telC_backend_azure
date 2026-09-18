-- Access now requires an activation code (D9), except for the people already
-- using the app without a school (D34).
--
-- The column records who those people are, and this migration is the only
-- thing that ever sets it: every student row that, at the moment this runs,
-- belongs to no center and carries no tier. On production that moment is the
-- release, so "existing users keep their access" means exactly those rows —
-- no date to configure, and no account created afterwards can fall under it.
--
-- A row with a tier is excluded on purpose: a leftover tier means a school once
-- governed that student, and releasing them must not restore free access.

-- AlterTable
ALTER TABLE "students" ADD COLUMN "grandfathered_access" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: the people using the app on their own today.
UPDATE "students"
   SET "grandfathered_access" = true
 WHERE "center_id" IS NULL
   AND "tier" IS NULL;
