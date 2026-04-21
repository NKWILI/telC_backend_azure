-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "activation_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "is_registered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_codes" (
    "code" TEXT NOT NULL,
    "student_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "claimed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "activation_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_name" TEXT,
    "last_used_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "session_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "teil_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "use_timer" BOOLEAN NOT NULL,
    "time_limit_seconds" INTEGER,
    "server_start_time" TIMESTAMP(3) NOT NULL,
    "pause_timestamp" TIMESTAMP(3),
    "elapsed_time" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "teil_transcripts" (
    "session_id" TEXT NOT NULL,
    "transcript_text" TEXT NOT NULL,
    "conversation_history" JSONB NOT NULL,
    "word_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teil_transcripts_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "teil_evaluations" (
    "session_id" TEXT NOT NULL,
    "pronunciation_score" DOUBLE PRECISION,
    "fluency_score" DOUBLE PRECISION,
    "grammar_score" DOUBLE PRECISION,
    "vocabulary_score" DOUBLE PRECISION,
    "overall_score" DOUBLE PRECISION,
    "corrections_json" JSONB,
    "strengths" TEXT,
    "areas_for_improvement" TEXT,
    "evaluation_requested_at" TIMESTAMP(3),

    CONSTRAINT "teil_evaluations_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "writing_attempts" (
    "attempt_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "corrections" JSONB,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "writing_attempts_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateTable
CREATE TABLE "listening_attempts" (
    "attempt_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "timed" BOOLEAN,
    "content_revision" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "listening_attempts_pkey" PRIMARY KEY ("attempt_id")
);

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teil_transcripts" ADD CONSTRAINT "teil_transcripts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teil_evaluations" ADD CONSTRAINT "teil_evaluations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_attempts" ADD CONSTRAINT "writing_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_attempts" ADD CONSTRAINT "listening_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
