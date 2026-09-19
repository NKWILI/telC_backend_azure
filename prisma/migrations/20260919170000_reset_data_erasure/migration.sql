-- AlterTable
ALTER TABLE "lesen_attempts" ADD COLUMN     "erasure_id" TEXT;

-- AlterTable
ALTER TABLE "listening_attempts" ADD COLUMN     "erasure_id" TEXT;

-- AlterTable
ALTER TABLE "speaking_attempts" ADD COLUMN     "erasure_id" TEXT;

-- AlterTable
ALTER TABLE "sprachbausteine_attempts" ADD COLUMN     "erasure_id" TEXT;

-- AlterTable
ALTER TABLE "student_activities" ADD COLUMN     "erasure_id" TEXT;

-- AlterTable
ALTER TABLE "writing_attempts" ADD COLUMN     "erasure_id" TEXT;

-- CreateTable
CREATE TABLE "data_erasures" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "center_user_id" TEXT,
    "since" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erase_after" TIMESTAMP(3) NOT NULL,
    "erased_at" TIMESTAMP(3),
    "restored_at" TIMESTAMP(3),

    CONSTRAINT "data_erasures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_erasures_erase_after_idx" ON "data_erasures"("erase_after");

-- CreateIndex
CREATE INDEX "data_erasures_student_id_idx" ON "data_erasures"("student_id");

-- CreateIndex
CREATE INDEX "lesen_attempts_erasure_id_idx" ON "lesen_attempts"("erasure_id");

-- CreateIndex
CREATE INDEX "listening_attempts_erasure_id_idx" ON "listening_attempts"("erasure_id");

-- CreateIndex
CREATE INDEX "speaking_attempts_erasure_id_idx" ON "speaking_attempts"("erasure_id");

-- CreateIndex
CREATE INDEX "sprachbausteine_attempts_erasure_id_idx" ON "sprachbausteine_attempts"("erasure_id");

-- CreateIndex
CREATE INDEX "student_activities_erasure_id_idx" ON "student_activities"("erasure_id");

-- CreateIndex
CREATE INDEX "writing_attempts_erasure_id_idx" ON "writing_attempts"("erasure_id");

