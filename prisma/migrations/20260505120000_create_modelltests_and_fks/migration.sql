-- CreateTable
CREATE TABLE "modelltests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modelltests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "modelltests_number_key" ON "modelltests"("number");

-- AlterTable
ALTER TABLE "sprachbausteine_exercises" ADD COLUMN "modelltest_id" UUID;

-- AlterTable
ALTER TABLE "sprachbausteine_teil2_exercises" ADD COLUMN "modelltest_id" UUID;

-- AlterTable
ALTER TABLE "lesen_teil1_exercises" ADD COLUMN "modelltest_id" UUID;

-- AlterTable
ALTER TABLE "lesen_teil2_exercises" ADD COLUMN "modelltest_id" UUID;

-- AlterTable
ALTER TABLE "lesen_teil3_exercises" ADD COLUMN "modelltest_id" UUID;

-- AddForeignKey
ALTER TABLE "sprachbausteine_exercises" ADD CONSTRAINT "sprachbausteine_exercises_modelltest_id_fkey" FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprachbausteine_teil2_exercises" ADD CONSTRAINT "sprachbausteine_teil2_exercises_modelltest_id_fkey" FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil1_exercises" ADD CONSTRAINT "lesen_teil1_exercises_modelltest_id_fkey" FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil2_exercises" ADD CONSTRAINT "lesen_teil2_exercises_modelltest_id_fkey" FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesen_teil3_exercises" ADD CONSTRAINT "lesen_teil3_exercises_modelltest_id_fkey" FOREIGN KEY ("modelltest_id") REFERENCES "modelltests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
