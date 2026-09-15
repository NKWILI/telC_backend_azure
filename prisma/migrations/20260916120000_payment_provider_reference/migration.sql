-- Where a payment provider's transaction id lives, and when a payment settled.
--
-- provider_reference is how a webhook finds its payment. It is unique so one
-- provider transaction can never be applied to two payments; Postgres permits
-- any number of NULLs under a unique index, so payments without a checkout
-- yet are unaffected.
--
-- Additive only: three nullable columns and an index. Nothing reads or writes
-- them until the activation step and the provider seam land.
ALTER TABLE "payments"
  ADD COLUMN "provider_reference" TEXT,
  ADD COLUMN "succeeded_at" TIMESTAMP(3),
  ADD COLUMN "failed_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "payments_provider_reference_key"
  ON "payments"("provider_reference");
