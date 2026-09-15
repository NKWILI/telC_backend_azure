-- One row per successful chargeable AI operation.
--
-- These rows ARE the quota. There is no counter to keep and nothing to reset
-- on a schedule: the allowance is "how many of these are newer than 24 hours
-- ago", so there is no stored number that can drift away from the rows it
-- claims to describe. A rolling window also needs no timezone, which matters
-- because the product is not only for Cameroon -- UTC midnight is 1am in
-- Douala and 9am in Tokyo, and a student who can change their device's
-- timezone to get a fresh day does not have a quota.
CREATE TYPE "AiOperation" AS ENUM ('SPEAKING_EVALUATION');

CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "operation" "AiOperation" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- Exactly the shape of the quota question, and the reason it stays fast as the
-- table grows without bound: student first because it is the equality,
-- operation second, created_at last because it is the range scan.
CREATE INDEX "ai_usage_student_id_operation_created_at_idx"
    ON "ai_usage"("student_id", "operation", "created_at");

-- Cascade, unlike students.center_id. A usage row describes an account, so
-- when the account is genuinely deleted the rows have nothing left to describe
-- -- whereas a student leaving a center keeps their history, which is why that
-- relation sets null instead.
ALTER TABLE "ai_usage"
    ADD CONSTRAINT "ai_usage_student_id_fkey" FOREIGN KEY ("student_id")
    REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
