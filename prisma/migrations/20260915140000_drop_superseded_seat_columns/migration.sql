-- Removes the three columns center_seats has superseded.
--
-- centers.unit_price_xaf and centers.min_seats were the Phase 6 single-price
-- model: one negotiated price and one minimum per center. Tiers replaced both
-- -- a price is now stamped per tier on center_seats, and the minimum is a
-- constant in code with a per-tier student floor beside it.
--
-- center_subscriptions.seats was a second number claiming to know a center's
-- seat count. Two authorities meant nobody reading the code could say which
-- was true, and a stale one that still looks authoritative eventually reaches
-- an invoice. The seat rows are now the only answer, and the seat limit is
-- summed from them.
--
-- Nothing to preserve, and this is verified rather than assumed: no code has
-- ever written centers.unit_price_xaf or centers.min_seats, so every row
-- carries the migration defaults of 4800 and 10 -- numbers nobody chose. A
-- backfill into center_seats would have been actively wrong: it would stamp
-- 4,800 onto the first centers when the launch price is 4,500, cancelling the
-- promotion on exactly the centers it was written for.
--
-- Deliberately last in the phase. Code read these columns until the commit
-- that carries this migration, so dropping them earlier would have left
-- commits that do not build.
ALTER TABLE "centers" DROP CONSTRAINT IF EXISTS "centers_unit_price_xaf_positive";
ALTER TABLE "centers" DROP CONSTRAINT IF EXISTS "centers_min_seats_positive";
ALTER TABLE "center_subscriptions" DROP CONSTRAINT IF EXISTS "center_subscriptions_seats_positive";

ALTER TABLE "centers"
  DROP COLUMN IF EXISTS "unit_price_xaf",
  DROP COLUMN IF EXISTS "min_seats";

ALTER TABLE "center_subscriptions" DROP COLUMN IF EXISTS "seats";
