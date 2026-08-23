-- The seat-counting boundary: a seat is the existence of a student row
-- carrying a center's id, so there is no counter column to drift.
--
-- Nullable, and every existing student keeps NULL: students who predate the
-- center model are unaffected, and NULL is also how an independent student
-- would be represented if B2C ever happens.
ALTER TABLE "students" ADD COLUMN "center_id" TEXT;

-- Seat usage is COUNT(students WHERE center_id = X) on every dashboard read.
CREATE INDEX "students_center_id_idx" ON "students"("center_id");

-- SET NULL rather than CASCADE: deleting a center must never delete a person's
-- account and their learning history along with it.
ALTER TABLE "students" ADD CONSTRAINT "students_center_id_fkey"
  FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
