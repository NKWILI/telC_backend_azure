-- Let a center exist before it knows where it is.
--
-- Registration drops to five fields: center name, manager first and last name,
-- email, password. Country, city and the manager's phone move to onboarding,
-- which is impossible while those three columns refuse null.
--
-- Nothing is backfilled. Every center and manager already in the table holds a
-- value, and dropping NOT NULL is a catalogue change in Postgres, so no row is
-- rewritten and nothing can be lost.
--
-- Deliberately NOT relaxed: centers.name, and the manager's name, email and
-- password_hash. Those are what registration still collects, and a manager
-- without an email could never verify or log in.
ALTER TABLE "centers"
  ALTER COLUMN "country" DROP NOT NULL,
  ALTER COLUMN "city" DROP NOT NULL;

ALTER TABLE "center_users"
  ALTER COLUMN "phone" DROP NOT NULL;
