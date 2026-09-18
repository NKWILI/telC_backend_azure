-- A reset gives a seat a new code value (D39). The event log keeps the value
-- it replaced, and that filled column is what marks an event as a reset: the
-- reset limit counts these rows rather than inferring resets from status
-- moves. Additive only.

-- AlterTable
ALTER TABLE "activation_code_events" ADD COLUMN     "previous_code" TEXT;

