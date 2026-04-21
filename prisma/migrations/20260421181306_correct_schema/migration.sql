/*
  Warnings:

  - You are about to alter the column `score` on the `listening_attempts` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - The primary key for the `teil_evaluations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `teil_transcripts` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `score` on the `writing_attempts` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Made the column `last_seen_at` on table `students` required. This step will fail if there are existing NULL values in that column.
  - The required column `id` was added to the `teil_evaluations` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - The required column `id` was added to the `teil_transcripts` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- DropForeignKey
ALTER TABLE "exam_sessions" DROP CONSTRAINT "exam_sessions_student_id_fkey";

-- DropForeignKey
ALTER TABLE "listening_attempts" DROP CONSTRAINT "listening_attempts_student_id_fkey";

-- DropForeignKey
ALTER TABLE "writing_attempts" DROP CONSTRAINT "writing_attempts_student_id_fkey";

-- AlterTable
ALTER TABLE "activation_codes" ADD COLUMN     "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "device_sessions" ALTER COLUMN "last_used_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "context_from_previous_teil" BOOLEAN DEFAULT false,
ADD COLUMN     "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_id" TEXT,
ALTER COLUMN "student_id" DROP NOT NULL,
ALTER COLUMN "use_timer" DROP NOT NULL,
ALTER COLUMN "use_timer" SET DEFAULT true,
ALTER COLUMN "server_start_time" DROP NOT NULL,
ALTER COLUMN "elapsed_time" DROP NOT NULL;

-- AlterTable
ALTER TABLE "listening_attempts" ADD COLUMN     "duration_seconds" INTEGER,
ADD COLUMN     "feedback" TEXT,
ALTER COLUMN "status" SET DEFAULT 'completed',
ALTER COLUMN "score" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "students" ALTER COLUMN "first_name" DROP NOT NULL,
ALTER COLUMN "last_name" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "last_seen_at" SET NOT NULL,
ALTER COLUMN "last_seen_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "teil_evaluations" DROP CONSTRAINT "teil_evaluations_pkey",
ADD COLUMN     "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "teil_evaluations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "teil_transcripts" DROP CONSTRAINT "teil_transcripts_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "interrupted_at" TIMESTAMP(3),
ALTER COLUMN "conversation_history" DROP NOT NULL,
ALTER COLUMN "word_count" SET DEFAULT 0,
ALTER COLUMN "created_at" DROP NOT NULL,
ADD CONSTRAINT "teil_transcripts_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "writing_attempts" ADD COLUMN     "notification_sent" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "status" SET DEFAULT 'pending',
ALTER COLUMN "score" SET DATA TYPE INTEGER;

-- CreateTable
CREATE TABLE "gemini_sessions" (
    "id" TEXT NOT NULL,
    "exam_session_id" TEXT NOT NULL,
    "gemini_session_id" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "gemini_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_passages" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "cefr_level" TEXT NOT NULL DEFAULT 'B1',
    "topic" TEXT,
    "word_count" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_passages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_questions" (
    "id" TEXT NOT NULL,
    "passage_id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "question_type" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct_answer" TEXT NOT NULL,
    "explanation" TEXT,
    "difficulty" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_sessions" (
    "session_id" TEXT NOT NULL,
    "user_id" TEXT,
    "student_id" TEXT,
    "question_ids" TEXT[],
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lesen_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "lesen_results" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_answers" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "correct_count" INTEGER NOT NULL,
    "total_questions" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_results_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gemini_sessions" ADD CONSTRAINT "gemini_sessions_exam_session_id_fkey" FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_questions" ADD CONSTRAINT "lesen_questions_passage_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "lesen_passages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_sessions" ADD CONSTRAINT "lesen_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_results" ADD CONSTRAINT "lesen_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lesen_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;
