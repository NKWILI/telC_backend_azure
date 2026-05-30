-- CreateTable: writing_exercises (one per Modelltest for TELC Schreiben)
CREATE TABLE "writing_exercises" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "content_revision"  TEXT        NOT NULL,
    "title"             TEXT        NOT NULL,
    "subtitle"          TEXT,
    "task_type"         TEXT        NOT NULL,
    "intro"             TEXT,
    "stimulus"          JSONB,
    "task_instructions" TEXT        NOT NULL,
    "bullet_points"     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    "closing_reminder"  TEXT,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelltest_id"     UUID,

    CONSTRAINT "writing_exercises_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add modelltest_id to writing_attempts
ALTER TABLE "writing_attempts" ADD COLUMN "modelltest_id" UUID;

-- AddForeignKey
ALTER TABLE "writing_exercises" ADD CONSTRAINT "writing_exercises_modelltest_id_fkey"
    FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
