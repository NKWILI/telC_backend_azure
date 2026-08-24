-- A center's intent to pay for seats.
--
-- Nothing in this table grants access. Only a verified provider event may move
-- paid_until (Phase 7), which is why SUCCEEDED exists in the enum from the
-- start while nothing writes it yet: Phase 7 needs somewhere to record a
-- verified result without another migration.
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    -- Snapshots, not a join back to the center's current terms. A price change
    -- next year must not rewrite what a center agreed to this year.
    "unit_price_xaf" INTEGER NOT NULL,
    "amount_xaf" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- THIS INDEX IS THE CONCURRENCY CONTROL, not a lookup optimisation.
--
-- Two simultaneous requests carrying one key both try to insert; Postgres lets
-- exactly one succeed and rejects the other with a unique violation, which the
-- service answers from the row that won. Without it, a double-clicked button
-- creates two payments for the same intent, and only one of them can ever be
-- reconciled against a provider event.
CREATE UNIQUE INDEX "payments_center_id_idempotency_key_key"
    ON "payments"("center_id", "idempotency_key");

-- Payment history, newest first, scoped to one center.
CREATE INDEX "payments_center_id_created_at_idx"
    ON "payments"("center_id", "created_at");

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_center_id_fkey" FOREIGN KEY ("center_id")
    REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money and counts have floors, enforced here so no future code path can write
-- a payment for zero seats or a negative amount.
ALTER TABLE "payments"
    ADD CONSTRAINT "payments_seats_positive" CHECK ("seats" > 0),
    ADD CONSTRAINT "payments_unit_price_xaf_positive" CHECK ("unit_price_xaf" > 0),
    ADD CONSTRAINT "payments_amount_xaf_positive" CHECK ("amount_xaf" > 0);
