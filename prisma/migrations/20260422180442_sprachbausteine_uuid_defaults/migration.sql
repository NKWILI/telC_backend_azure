/*
  Warnings:

  - The primary key for the `sprachbausteine_exercises` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `sprachbausteine_exercises` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `sprachbausteine_gap_options` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `sprachbausteine_gap_options` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `sprachbausteine_gaps` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `sprachbausteine_gaps` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `gap_id` on the `sprachbausteine_gap_options` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `exercise_id` on the `sprachbausteine_gaps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "sprachbausteine_gap_options" DROP CONSTRAINT "sprachbausteine_gap_options_gap_id_fkey";

-- DropForeignKey
ALTER TABLE "sprachbausteine_gaps" DROP CONSTRAINT "sprachbausteine_gaps_exercise_id_fkey";

-- AlterTable
ALTER TABLE "sprachbausteine_exercises" DROP CONSTRAINT "sprachbausteine_exercises_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "sprachbausteine_exercises_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sprachbausteine_gap_options" DROP CONSTRAINT "sprachbausteine_gap_options_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "gap_id",
ADD COLUMN     "gap_id" UUID NOT NULL,
ADD CONSTRAINT "sprachbausteine_gap_options_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sprachbausteine_gaps" DROP CONSTRAINT "sprachbausteine_gaps_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "exercise_id",
ADD COLUMN     "exercise_id" UUID NOT NULL,
ADD CONSTRAINT "sprachbausteine_gaps_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "sprachbausteine_gaps_exercise_id_gap_key_key" ON "sprachbausteine_gaps"("exercise_id", "gap_key");

-- AddForeignKey
ALTER TABLE "sprachbausteine_gaps" ADD CONSTRAINT "sprachbausteine_gaps_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "sprachbausteine_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprachbausteine_gap_options" ADD CONSTRAINT "sprachbausteine_gap_options_gap_id_fkey" FOREIGN KEY ("gap_id") REFERENCES "sprachbausteine_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
