-- A payment can now cover several tiers at different prices, so its breakdown
-- cannot live in one seats/unit_price pair on the payment row.
--
-- payments.seats and payments.unit_price_xaf are replaced by payments
-- .total_seats plus a payment_lines row per tier. Safe to rewrite rather than
-- migrate: no center is live, so there are no payments to preserve.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_seats_positive";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_unit_price_xaf_positive";

ALTER TABLE "payments" DROP COLUMN "unit_price_xaf";
ALTER TABLE "payments" RENAME COLUMN "seats" TO "total_seats";

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_total_seats_positive" CHECK ("total_seats" > 0);

CREATE TABLE "payment_lines" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "seats" INTEGER NOT NULL,
    -- The price that applied when the payment was made. This is what keeps an
    -- old invoice truthful after the list price moves.
    "unit_price_xaf" INTEGER NOT NULL,
    "amount_xaf" INTEGER NOT NULL,

    CONSTRAINT "payment_lines_pkey" PRIMARY KEY ("id")
);

-- One line per tier per payment. Two lines for the same tier would make the
-- payment total depend on remembering to sum them.
CREATE UNIQUE INDEX "payment_lines_payment_id_tier_key"
    ON "payment_lines"("payment_id", "tier");

ALTER TABLE "payment_lines"
    ADD CONSTRAINT "payment_lines_payment_id_fkey" FOREIGN KEY ("payment_id")
    REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A line is a real purchase, so every figure is positive. Unlike center_seats,
-- there is no free line: a trial seat is granted, never paid for.
ALTER TABLE "payment_lines"
    ADD CONSTRAINT "payment_lines_seats_positive" CHECK ("seats" > 0),
    ADD CONSTRAINT "payment_lines_unit_price_xaf_positive" CHECK ("unit_price_xaf" > 0),
    ADD CONSTRAINT "payment_lines_amount_xaf_positive" CHECK ("amount_xaf" > 0);
