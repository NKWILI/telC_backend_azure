-- Activation state for center-provisioned students.
--
-- All nullable and additive: every existing student keeps NULL and is
-- unaffected. A NULL activation_key_hash simply means no key is outstanding.
ALTER TABLE "students" ADD COLUMN "activation_key_hash" TEXT;
ALTER TABLE "students" ADD COLUMN "activation_key_expires" TIMESTAMP(3);
ALTER TABLE "students" ADD COLUMN "activated_at" TIMESTAMP(3);
ALTER TABLE "students" ADD COLUMN "activated_ip" TEXT;

-- Redemption looks a student up by the hash of the presented key.
CREATE INDEX "students_activation_key_hash_idx" ON "students"("activation_key_hash");
