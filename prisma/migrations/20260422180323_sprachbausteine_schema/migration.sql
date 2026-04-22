-- CreateTable
CREATE TABLE "sprachbausteine_exercises" (
    "id" TEXT NOT NULL,
    "teil_number" INTEGER NOT NULL,
    "content_revision" TEXT NOT NULL,
    "label" TEXT,
    "instruction" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprachbausteine_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprachbausteine_gaps" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "gap_key" TEXT NOT NULL,
    "gap_number" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "sprachbausteine_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprachbausteine_gap_options" (
    "id" TEXT NOT NULL,
    "gap_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "sprachbausteine_gap_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sprachbausteine_gaps_exercise_id_gap_key_key" ON "sprachbausteine_gaps"("exercise_id", "gap_key");

-- AddForeignKey
ALTER TABLE "sprachbausteine_gaps" ADD CONSTRAINT "sprachbausteine_gaps_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "sprachbausteine_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprachbausteine_gap_options" ADD CONSTRAINT "sprachbausteine_gap_options_gap_id_fkey" FOREIGN KEY ("gap_id") REFERENCES "sprachbausteine_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
