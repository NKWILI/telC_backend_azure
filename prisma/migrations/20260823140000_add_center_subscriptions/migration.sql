-- CreateEnum
CREATE TYPE "CenterPlan" AS ENUM ('TRIAL', 'PAID');

-- CreateTable
CREATE TABLE "center_subscriptions" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "plan" "CenterPlan" NOT NULL DEFAULT 'TRIAL',
    "seats" INTEGER NOT NULL DEFAULT 3,
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "paid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "center_subscriptions_center_id_key" ON "center_subscriptions"("center_id");

-- AddForeignKey
ALTER TABLE "center_subscriptions" ADD CONSTRAINT "center_subscriptions_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every center registered before this migration gets a subscription,
-- so "a center without a subscription" is a bug rather than a state the code
-- has to keep handling forever. Left at TRIAL_PENDING with no trial clock
-- running, exactly as a newly registered center would be.
INSERT INTO "center_subscriptions" ("id", "center_id", "plan", "seats", "created_at", "updated_at")
SELECT gen_random_uuid()::text, c."id", 'TRIAL', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "centers" c
WHERE NOT EXISTS (
  SELECT 1 FROM "center_subscriptions" s WHERE s."center_id" = c."id"
);
