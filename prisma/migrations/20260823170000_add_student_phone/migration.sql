-- WhatsApp number for a student. Optional, and additive: every existing
-- student keeps NULL.
--
-- Email deliverability is the weaker channel in-market, so this is the one that
-- actually reaches a student for renewal reminders, and for the in-product
-- offer to continue when their center stops paying.
ALTER TABLE "students" ADD COLUMN "phone" TEXT;
