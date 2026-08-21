BEGIN;

CREATE TABLE "listening_exercises" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "modelltest_id" UUID NOT NULL,
  "part" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "instruction" TEXT NOT NULL,
  "content_revision" TEXT NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "audio_url" TEXT NOT NULL DEFAULT '',
  "bundled_audio_asset" TEXT NOT NULL DEFAULT '',
  "image_url" TEXT NOT NULL,
  "transcript" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listening_exercises_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listening_exercises_part_check" CHECK ("part" BETWEEN 1 AND 3),
  CONSTRAINT "listening_exercises_duration_check" CHECK ("duration_minutes" > 0),
  CONSTRAINT "listening_exercises_modelltest_id_fkey"
    FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "listening_exercises_modelltest_id_part_key"
  ON "listening_exercises"("modelltest_id", "part");
CREATE UNIQUE INDEX "listening_exercises_content_revision_key"
  ON "listening_exercises"("content_revision");
CREATE INDEX "listening_exercises_modelltest_id_idx"
  ON "listening_exercises"("modelltest_id");

CREATE TABLE "listening_questions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "exercise_id" UUID NOT NULL,
  "question_number" INTEGER NOT NULL,
  "prompt" TEXT NOT NULL,
  "correct_answer" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  CONSTRAINT "listening_questions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listening_questions_correct_answer_check"
    CHECK ("correct_answer" IN ('+', '-')),
  CONSTRAINT "listening_questions_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "listening_exercises"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "listening_questions_exercise_id_question_number_key"
  ON "listening_questions"("exercise_id", "question_number");
CREATE UNIQUE INDEX "listening_questions_exercise_id_sort_order_key"
  ON "listening_questions"("exercise_id", "sort_order");
CREATE INDEX "listening_questions_exercise_id_idx"
  ON "listening_questions"("exercise_id");

CREATE TABLE "speaking_exercises" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "modelltest_id" UUID NOT NULL,
  "part" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "topic_title" TEXT NOT NULL,
  "topic_description" TEXT NOT NULL,
  "topic_points" JSONB NOT NULL,
  "instructions" TEXT NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "prep_duration_seconds" INTEGER NOT NULL,
  "image_url" TEXT NOT NULL,
  "exam_image_url" TEXT,
  "content_revision" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "speaking_exercises_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "speaking_exercises_part_check" CHECK ("part" BETWEEN 1 AND 3),
  CONSTRAINT "speaking_exercises_duration_check" CHECK ("duration_minutes" > 0),
  CONSTRAINT "speaking_exercises_prep_duration_check" CHECK ("prep_duration_seconds" >= 0),
  CONSTRAINT "speaking_exercises_topic_points_check"
    CHECK (jsonb_typeof("topic_points") = 'array'),
  CONSTRAINT "speaking_exercises_modelltest_id_fkey"
    FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "speaking_exercises_modelltest_id_part_key"
  ON "speaking_exercises"("modelltest_id", "part");
CREATE UNIQUE INDEX "speaking_exercises_content_revision_key"
  ON "speaking_exercises"("content_revision");
CREATE INDEX "speaking_exercises_modelltest_id_idx"
  ON "speaking_exercises"("modelltest_id");

ALTER TABLE "listening_attempts"
  ADD COLUMN "listening_exercise_id" UUID;
CREATE INDEX "listening_attempts_listening_exercise_id_idx"
  ON "listening_attempts"("listening_exercise_id");
ALTER TABLE "listening_attempts"
  ADD CONSTRAINT "listening_attempts_listening_exercise_id_fkey"
  FOREIGN KEY ("listening_exercise_id") REFERENCES "listening_exercises"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
