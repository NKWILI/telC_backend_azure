-- CreateEnum
CREATE TYPE "Skill" AS ENUM ('HOEREN', 'LESEN', 'SPRACHBAUSTEINE', 'SCHREIBEN', 'SPRECHEN');

-- CreateTable
CREATE TABLE "student_activities" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "skill" "Skill" NOT NULL,
    "teil" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "max_score" INTEGER NOT NULL,
    "duration_seconds" INTEGER,
    "modelltest_id" UUID,
    "attempt_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_attempts" (
    "attempt_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "teil_id" TEXT NOT NULL,
    "modelltest_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_attempts_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateTable
CREATE TABLE "speaking_attempts" (
    "attempt_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "teil_number" INTEGER NOT NULL,
    "transcript" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "evaluation" JSONB NOT NULL,
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speaking_attempts_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateIndex
CREATE INDEX "student_activities_student_id_created_at_idx" ON "student_activities"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "student_activities_student_id_skill_created_at_idx" ON "student_activities"("student_id", "skill", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_activities_skill_attempt_id_key" ON "student_activities"("skill", "attempt_id");

-- CreateIndex
CREATE INDEX "lesen_attempts_student_id_teil_id_idx" ON "lesen_attempts"("student_id", "teil_id");

-- CreateIndex
CREATE INDEX "speaking_attempts_student_id_teil_number_idx" ON "speaking_attempts"("student_id", "teil_number");

-- AddForeignKey
ALTER TABLE "student_activities" ADD CONSTRAINT "student_activities_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: the three skills that already stored attempts get their history.
--
-- Idempotent (ON CONFLICT on the one-summary-per-attempt key) and limited to
-- real students' completed, scored attempts. Writing rows scored by the stub
-- (the model failed, a placeholder 75 was stored) are not real results and
-- are left out, exactly as the live writer leaves them out.
INSERT INTO "student_activities"
  ("id", "student_id", "skill", "teil", "score", "max_score", "duration_seconds", "modelltest_id", "attempt_id", "created_at")
SELECT gen_random_uuid()::text, a."student_id", 'HOEREN', a."exercise_id"::int, a."score", 100,
       a."duration_seconds", a."modelltest_id", a."attempt_id", COALESCE(a."completed_at", a."created_at")
FROM "listening_attempts" a
JOIN "students" s ON s."id" = a."student_id"
WHERE a."status" = 'completed' AND a."score" IS NOT NULL AND a."exercise_id" IN ('1', '2', '3')
ON CONFLICT ("skill", "attempt_id") DO NOTHING;

INSERT INTO "student_activities"
  ("id", "student_id", "skill", "teil", "score", "max_score", "duration_seconds", "modelltest_id", "attempt_id", "created_at")
SELECT gen_random_uuid()::text, a."student_id", 'SPRACHBAUSTEINE', a."teil_id"::int, a."score", 100,
       a."duration_seconds", a."modelltest_id"::uuid, a."attempt_id", COALESCE(a."completed_at", a."created_at")
FROM "sprachbausteine_attempts" a
JOIN "students" s ON s."id" = a."student_id"
WHERE a."status" = 'completed' AND a."score" IS NOT NULL AND a."teil_id" IN ('1', '2')
  AND (a."modelltest_id" IS NULL OR a."modelltest_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
ON CONFLICT ("skill", "attempt_id") DO NOTHING;

INSERT INTO "student_activities"
  ("id", "student_id", "skill", "teil", "score", "max_score", "duration_seconds", "modelltest_id", "attempt_id", "created_at")
SELECT gen_random_uuid()::text, a."student_id", 'SCHREIBEN', 1, a."score", 100,
       a."duration_seconds", a."modelltest_id", a."attempt_id", COALESCE(a."completed_at", a."created_at")
FROM "writing_attempts" a
JOIN "students" s ON s."id" = a."student_id"
WHERE a."status" = 'completed' AND a."score" IS NOT NULL
  AND a."feedback" IS DISTINCT FROM 'Stub feedback. Echte Korrektur folgt.'
ON CONFLICT ("skill", "attempt_id") DO NOTHING;
