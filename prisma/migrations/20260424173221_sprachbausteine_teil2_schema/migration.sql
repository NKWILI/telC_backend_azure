-- CreateTable
CREATE TABLE "sprachbausteine_teil2_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contentRevision" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprachbausteine_teil2_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprachbausteine_teil2_words" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "letter" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "sprachbausteine_teil2_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprachbausteine_teil2_gaps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "gapKey" TEXT NOT NULL,
    "gapNumber" INTEGER NOT NULL,
    "correctWordId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "sprachbausteine_teil2_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sprachbausteine_teil2_gaps_exerciseId_gapKey_key" ON "sprachbausteine_teil2_gaps"("exerciseId", "gapKey");

-- AddForeignKey
ALTER TABLE "sprachbausteine_teil2_words" ADD CONSTRAINT "sprachbausteine_teil2_words_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "sprachbausteine_teil2_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprachbausteine_teil2_gaps" ADD CONSTRAINT "sprachbausteine_teil2_gaps_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "sprachbausteine_teil2_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprachbausteine_teil2_gaps" ADD CONSTRAINT "sprachbausteine_teil2_gaps_correctWordId_fkey" FOREIGN KEY ("correctWordId") REFERENCES "sprachbausteine_teil2_words"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
