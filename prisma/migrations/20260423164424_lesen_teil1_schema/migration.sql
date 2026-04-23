-- CreateTable
CREATE TABLE "lesen_teil1_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contentRevision" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_teil1_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_teil1_texts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "textNumber" INTEGER NOT NULL,
    "von" TEXT,
    "an" TEXT,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "correctTitleId" UUID NOT NULL,

    CONSTRAINT "lesen_teil1_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_teil1_titles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "lesen_teil1_titles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lesen_teil1_texts" ADD CONSTRAINT "lesen_teil1_texts_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "lesen_teil1_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil1_texts" ADD CONSTRAINT "lesen_teil1_texts_correctTitleId_fkey" FOREIGN KEY ("correctTitleId") REFERENCES "lesen_teil1_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil1_titles" ADD CONSTRAINT "lesen_teil1_titles_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "lesen_teil1_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
