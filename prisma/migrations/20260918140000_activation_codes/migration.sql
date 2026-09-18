-- Activation codes: one seat, as a value a center hands to a student.
--
-- Additive only. The per-student activation keys on `students` keep working
-- beside this for now; they are removed in a migration of their own once
-- production has been checked (D20).
--
-- `code` is stored readable rather than hashed, because a manager has to see
-- it again to hand it out; deactivation, not secrecy, protects a seat. There
-- is no EXPIRED status: expiry is a date compared on read, so a code cannot be
-- left in the wrong state by a job that did not run.

-- CreateEnum
CREATE TYPE "ActivationCodeStatus" AS ENUM ('ACTIVATED', 'CONNECTED', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "activation_codes" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "status" "ActivationCodeStatus" NOT NULL DEFAULT 'ACTIVATED',
    "student_id" TEXT,
    "linked_name" TEXT,
    "linked_email" TEXT,
    "connected_at" TIMESTAMP(3),
    "connected_ip" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activation_codes_code_key" ON "activation_codes"("code");

-- CreateIndex
CREATE INDEX "activation_codes_center_id_status_idx" ON "activation_codes"("center_id", "status");

-- CreateIndex
CREATE INDEX "activation_codes_student_id_idx" ON "activation_codes"("student_id");

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

