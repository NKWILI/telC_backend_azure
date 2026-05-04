-- NOTE: This migration was partially applied in a previous attempt.
-- Only the remaining statements are included here.

-- DeduplicateDeviceSessions: keep the most recently used row per device_id
DELETE FROM "device_sessions"
WHERE id NOT IN (
  SELECT DISTINCT ON (device_id) id
  FROM "device_sessions"
  ORDER BY device_id, last_used_at DESC NULLS LAST
);

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_device_id_key" ON "device_sessions"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_email_key" ON "students"("email");

-- CreateIndex
CREATE INDEX "students_email_idx" ON "students"("email");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
