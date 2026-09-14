-- A payment line has to agree with itself, and with its payment.
--
-- The line model exists so an invoice stays truthful after the list price
-- moves, which only holds if the numbers on it are consistent. Application
-- code computes amount as seats * unit_price today; this makes it impossible
-- for any future code path -- a backfill, a Phase 7 correction, a psql session
-- -- to write a line whose total does not follow from its own two factors.
--
-- Separate migration rather than an edit to 20260914160000, because that one
-- has already been applied and rewriting an applied migration breaks its
-- checksum.
ALTER TABLE "payment_lines"
  ADD CONSTRAINT "payment_lines_amount_matches_seats"
  CHECK ("amount_xaf" = "seats" * "unit_price_xaf");

-- Every other table carries these. A line without a timestamp cannot be
-- placed in a reconciliation, which is the one job an invoice line has.
ALTER TABLE "payment_lines"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
