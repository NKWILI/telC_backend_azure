import { Prisma } from '@prisma/client';

/**
 * Whether an error is a unique-constraint violation on a particular column or
 * index — and only that.
 *
 * Read from the whole of `meta`, not from `meta.target`. With the driver
 * adapter this app uses, a P2002 carries no `target` at all: the column is in
 * `meta.driverAdapterError.cause.constraint.fields` and the index name in its
 * `originalMessage`. Code that read `target` alone never matched, so a retry
 * written for a collision silently never retried and a race that should have
 * answered in words answered with a raw database error.
 *
 * `marker` is a column name or an index name. Matching either shape keeps this
 * working if the client is ever run without the adapter again.
 */
export function isUniqueViolationOn(error: unknown, marker: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== 'P2002') {
    return false;
  }

  const meta = JSON.stringify(error.meta ?? {});

  // Quoted, so `code` cannot match `code_id` or `student_id` match
  // `grandfathered_student_id`: a column name is always a whole JSON string.
  return meta.includes(`"${marker}"`) || meta.includes(`\\"${marker}\\"`);
}
