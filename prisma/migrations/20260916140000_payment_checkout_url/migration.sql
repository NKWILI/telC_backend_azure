-- Where a center is sent to pay, stored with the provider reference.
--
-- A checkout that is retried or double-clicked must not open a second
-- provider transaction for one payment: the second one could be paid too, and
-- its webhook would name a reference no payment holds. Storing the URL lets a
-- repeat return the session already opened instead of asking again.
--
-- Additive and nullable. Nothing reads it until the checkout endpoint lands.
ALTER TABLE "payments" ADD COLUMN "checkout_url" TEXT;
