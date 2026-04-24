-- CreateTable
CREATE TABLE "lesen_teil3_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contentRevision" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesen_teil3_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_teil3_announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "lesen_teil3_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesen_teil3_situations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exerciseId" UUID NOT NULL,
    "situationNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "noMatch" BOOLEAN NOT NULL DEFAULT false,
    "correctAnnouncementId" UUID,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "lesen_teil3_situations_pkey" PRIMARY KEY ("id")
);

-- Enforce valid noMatch/correctAnnouncementId combinations
ALTER TABLE "lesen_teil3_situations"
  ADD CONSTRAINT "lesen_teil3_situations_no_match_check"
  CHECK (
    ("noMatch" = true  AND "correctAnnouncementId" IS NULL) OR
    ("noMatch" = false AND "correctAnnouncementId" IS NOT NULL)
  );

-- AddForeignKey
ALTER TABLE "lesen_teil3_announcements" ADD CONSTRAINT "lesen_teil3_announcements_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "lesen_teil3_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil3_situations" ADD CONSTRAINT "lesen_teil3_situations_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "lesen_teil3_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil3_situations" ADD CONSTRAINT "lesen_teil3_situations_correctAnnouncementId_fkey" FOREIGN KEY ("correctAnnouncementId") REFERENCES "lesen_teil3_announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
