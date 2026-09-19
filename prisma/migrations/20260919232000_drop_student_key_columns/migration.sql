-- D20: the per-student activation keys were removed; students join by
-- redeeming a center's code (D17). Checked 2026-09-19, read-only: none of the
-- 13 production students has any of these columns set.

-- DropIndex
DROP INDEX "students_activation_key_hash_idx";

-- AlterTable
ALTER TABLE "students" DROP COLUMN "activated_at",
DROP COLUMN "activated_ip",
DROP COLUMN "activation_key_expires",
DROP COLUMN "activation_key_hash";

