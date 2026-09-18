-- Structured location for a center and for its manager.
--
-- Additive only. The old free-text `centers.country` and `centers.city` stay
-- exactly as they are: they still back the onboarding checklist for rows
-- written before this, and dropping a column is a migration of its own, run
-- after production has been looked at rather than carried along with the
-- feature that replaces it.
--
-- Every column is nullable because none of this is collected at registration.
-- A center supplies it during onboarding, at the point it goes to pay.
--
-- `region_id` is stored but never accepted from a client: it is looked up from
-- the chosen city, so a city cannot end up filed under a region it does not
-- belong to. `city_other` holds a town we do not list yet, so a school in one
-- is never blocked from finishing onboarding.

-- AlterTable
ALTER TABLE "centers" ADD COLUMN     "city_id" TEXT,
ADD COLUMN     "city_other" TEXT,
ADD COLUMN     "country_code" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "house_number" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "region_id" TEXT,
ADD COLUMN     "street" TEXT;

-- AlterTable
ALTER TABLE "center_users" ADD COLUMN     "city_id" TEXT,
ADD COLUMN     "city_other" TEXT,
ADD COLUMN     "country_code" TEXT,
ADD COLUMN     "region_id" TEXT;
