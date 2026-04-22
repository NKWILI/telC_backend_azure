-- CreateTable
CREATE TABLE "lesen_teil2_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contentRevision" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "cautionNote" TEXT NOT NULL,
    "topSender" TEXT NOT NULL,
    "topReceiver" TEXT NOT NULL,
    "topBody" TEXT NOT NULL,
    "quotedThread" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_teil2_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_teil2_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "questionNumber" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "lesen_teil2_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_teil2_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "questionId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "lesen_teil2_options_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lesen_teil2_questions" ADD CONSTRAINT "lesen_teil2_questions_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "lesen_teil2_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil2_options" ADD CONSTRAINT "lesen_teil2_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "lesen_teil2_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
