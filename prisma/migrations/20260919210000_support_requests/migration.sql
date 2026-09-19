-- CreateEnum
CREATE TYPE "SupportRequestKind" AS ENUM ('CONTACT', 'ACCOUNT_DELETION');

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "kind" "SupportRequestKind" NOT NULL,
    "center_id" TEXT NOT NULL,
    "center_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailed_at" TIMESTAMP(3),

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_requests_center_id_kind_created_at_idx" ON "support_requests"("center_id", "kind", "created_at");

