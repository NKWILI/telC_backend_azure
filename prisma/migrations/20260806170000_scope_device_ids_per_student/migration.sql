-- Device identifiers belong to a student account, not to the whole platform.
-- The previous global unique index allowed another student's login to claim an
-- existing device session. Existing data cannot conflict with the new index
-- because the old constraint was stricter.
DROP INDEX IF EXISTS "device_sessions_device_id_key";

CREATE UNIQUE INDEX "device_sessions_student_id_device_id_key"
ON "device_sessions"("student_id", "device_id");
