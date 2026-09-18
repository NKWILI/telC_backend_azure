import type { Prisma, Skill } from '@prisma/client';

/** Every skill is scored in percent today; carried per row all the same. */
export const PERCENT = 100;

export interface ActivityInput {
  studentId: string;
  skill: Skill;
  teil: number;
  score: number;
  maxScore?: number;
  durationSeconds?: number | null;
  modelltestId?: string | null;
  /** The detailed row this summarises, in the table `skill` names. */
  attemptId: string;
  completedAt?: Date;
}

/**
 * The one place a `StudentActivity` row is written (D26).
 *
 * Takes the transaction the caller writes its detailed attempt in, so a summary
 * never exists without its attempt nor an attempt without its summary. A plain
 * function rather than a service: it needs nothing but that transaction.
 *
 * Records nothing for a caller with no student row — a guest, whose token
 * carries a random id. Guests may practise, and their detailed attempts are
 * stored as before, but progress belongs to students (B16). Deciding it here
 * covers every caller, including the writing correction, which runs later
 * from a queue and no longer knows who was a guest.
 *
 * Returns whether a row was written.
 */
export async function recordActivity(
  tx: Prisma.TransactionClient,
  input: ActivityInput,
): Promise<boolean> {
  const maxScore = input.maxScore ?? PERCENT;
  if (
    !Number.isInteger(input.teil) ||
    input.teil < 1 ||
    !Number.isFinite(input.score) ||
    input.score < 0 ||
    input.score > maxScore
  ) {
    // A caller bug, not a student error: refuse rather than store nonsense
    // that every progress number would then read.
    throw new Error(
      `Invalid activity: ${input.skill} teil ${input.teil} score ${input.score}/${maxScore}`,
    );
  }
  const student = await tx.student.findUnique({
    where: { id: input.studentId },
    select: { id: true },
  });
  if (!student) return false;

  await tx.studentActivity.create({
    data: {
      student_id: input.studentId,
      skill: input.skill,
      teil: input.teil,
      score: Math.round(input.score),
      max_score: maxScore,
      duration_seconds: input.durationSeconds ?? null,
      modelltest_id: input.modelltestId ?? null,
      attempt_id: input.attemptId,
      ...(input.completedAt ? { created_at: input.completedAt } : {}),
    },
  });
  return true;
}
