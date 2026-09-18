-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "level" "CefrLevel";

