-- AlterTable
ALTER TABLE "writing_attempts" ADD COLUMN "corrected_text" TEXT,
ADD COLUMN "diff" JSONB;
