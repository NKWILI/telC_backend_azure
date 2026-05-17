-- CreateTable
CREATE TABLE "sprachbausteine_attempts" (
    "attempt_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "teil_id" TEXT NOT NULL,
    "modelltest_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "score" INTEGER,
    "feedback" TEXT,
    "answers" JSONB,
    "content_revision" TEXT,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sprachbausteine_attempts_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateIndex
CREATE INDEX "sprachbausteine_attempts_student_id_teil_id_idx" ON "sprachbausteine_attempts"("student_id", "teil_id");
