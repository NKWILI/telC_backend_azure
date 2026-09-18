import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { isUniqueViolationOn } from '../../shared/prisma-errors';

/**
 * Stores an attempt once, however many times the app sends it (D29).
 *
 * The Flutter app's offline queue retries a submit whose answer it never
 * received, so the same attempt can arrive twice. When the app names the
 * attempt, that id becomes the attempt's primary key: the second arrival finds
 * the first and is answered from it instead of being stored again. Without an
 * id every submit is new, as before.
 *
 * Returns the earlier row when this is a repeat, or null when `write` stored
 * the attempt now.
 */
export async function submitOnce<R extends { student_id: string }>(
  studentId: string,
  clientAttemptId: string | undefined,
  find: (attemptId: string) => Promise<R | null>,
  write: (attemptId: string) => Promise<void>,
): Promise<{ attemptId: string; earlier: R | null }> {
  if (!clientAttemptId) {
    const attemptId = randomUUID();
    await write(attemptId);
    return { attemptId, earlier: null };
  }

  const repeat = async () => {
    const earlier = await find(clientAttemptId);
    // An id is only a key to the student's own attempt. Someone else's
    // attempt id must neither be answered from nor overwritten.
    if (earlier && earlier.student_id !== studentId) {
      throw new ConflictException('ATTEMPT_ID_TAKEN');
    }
    return earlier;
  };

  const before = await repeat();
  if (before) return { attemptId: clientAttemptId, earlier: before };

  try {
    await write(clientAttemptId);
    return { attemptId: clientAttemptId, earlier: null };
  } catch (error) {
    // Two copies raced past the check above; the database let one in.
    if (!isUniqueViolationOn(error, 'attempt_id')) throw error;
    const earlier = await repeat();
    if (!earlier) throw error;
    return { attemptId: clientAttemptId, earlier };
  }
}
