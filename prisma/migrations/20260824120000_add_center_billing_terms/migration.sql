-- Billing terms for a center: what one seat costs, and the fewest seats a paid
-- plan may buy.
--
-- Additive, with defaults, so every center already in the table comes out of
-- this migration priced rather than null. That matters more than it looks: the
-- pricing service reads these columns for every quote, and a null here would
-- mean no existing center could be quoted at all.
--
-- Postgres 11 and later rewrite nothing for a defaulted ADD COLUMN, so this is
-- a catalogue change even on a large table.
ALTER TABLE "centers"
  ADD COLUMN "unit_price_xaf" INTEGER NOT NULL DEFAULT 4800,
  ADD COLUMN "min_seats" INTEGER NOT NULL DEFAULT 10;

-- The constraints live in the table rather than only in validation, because a
-- negative price is not a discount, it is a payout, and a zero seat minimum
-- would let a paid plan cost nothing. Neither should depend on every future
-- code path remembering to check.
ALTER TABLE "centers"
  ADD CONSTRAINT "centers_unit_price_xaf_positive" CHECK ("unit_price_xaf" > 0),
  ADD CONSTRAINT "centers_min_seats_positive" CHECK ("min_seats" > 0);
