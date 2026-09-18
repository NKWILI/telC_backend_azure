-- A student holds at most one connected activation code.
--
-- The redemption route checks this too, but a check in code runs before the
-- write and two requests can both pass it: a student redeeming two codes at
-- the same moment would otherwise end up holding seats at two schools. Only
-- the database can make the second one fail.
--
-- Partial, because only CONNECTED codes count: a student keeps a history of
-- deactivated codes, and those must not stop them redeeming a new one.
--
-- Prisma's schema cannot describe a partial index, so this lives here and is
-- documented on the model. Checked when it was added: `prisma migrate diff`
-- ignores it rather than proposing to drop it.
CREATE UNIQUE INDEX "activation_codes_one_connected_per_student"
    ON "activation_codes" ("student_id")
 WHERE "status" = 'CONNECTED';
