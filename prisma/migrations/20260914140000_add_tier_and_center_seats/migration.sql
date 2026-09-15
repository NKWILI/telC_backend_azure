-- The tier model. Additive only: nothing is dropped here.
--
-- Center.unit_price_xaf and CenterSubscription.seats are superseded by this
-- table, but code still reads them, so they go in a later migration once every
-- reader has moved. Dropping them now would leave commits that do not compile.
CREATE TYPE "Tier" AS ENUM ('START', 'PRO', 'PREMIUM');

-- A trial is deliberately NOT a tier. It is an ordinary START seat priced at
-- zero with a 14-day clock, which keeps trial and paid Start students
-- identical everywhere except that clock.
CREATE TABLE "center_seats" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "quantity" INTEGER NOT NULL,
    -- Copied in at purchase rather than looked up. This is what makes
    -- grandfathering automatic: raising the list price later cannot rewrite
    -- what a center already agreed to pay.
    "unit_price_xaf" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_seats_pkey" PRIMARY KEY ("id")
);

-- One row per tier per center. Two rows for the same tier would mean a seat
-- count depends on remembering to sum them, which is how a count goes wrong.
CREATE UNIQUE INDEX "center_seats_center_id_tier_key"
    ON "center_seats"("center_id", "tier");

ALTER TABLE "center_seats"
    ADD CONSTRAINT "center_seats_center_id_fkey" FOREIGN KEY ("center_id")
    REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- quantity must be positive: a row saying "no seats" is not the same as no
-- row. The price may be zero, because that is how a free trial seat is held,
-- so this is "not negative" rather than "positive".
ALTER TABLE "center_seats"
    ADD CONSTRAINT "center_seats_quantity_positive" CHECK ("quantity" > 0),
    ADD CONSTRAINT "center_seats_unit_price_xaf_not_negative" CHECK ("unit_price_xaf" >= 0);

-- Which tier a student's seat is. Nullable for every student no center
-- governs: those who predate centers, and anyone removed from one.
ALTER TABLE "students" ADD COLUMN "tier" "Tier";
