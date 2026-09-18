import type { Skill } from '@prisma/client';
import type { PrismaService } from '../../shared/services/prisma.service';
import { PERCENT } from './student-activity.writer';

/** How a skill is named on the wire. */
export type SkillId =
  | 'hoeren'
  | 'lesen'
  | 'sprachbausteine'
  | 'schreiben'
  | 'sprechen';

export const SKILL_ID: Record<Skill, SkillId> = {
  HOEREN: 'hoeren',
  LESEN: 'lesen',
  SPRACHBAUSTEINE: 'sprachbausteine',
  SCHREIBEN: 'schreiben',
  SPRECHEN: 'sprechen',
};

/**
 * The fields every module's `/sessions` item carries (D29), beside whatever
 * that module already returned. Added, never renamed: the app reads the old
 * ones today.
 */
export interface SharedHistoryFields {
  attemptId: string;
  skill: SkillId;
  teil: number;
  /** Null while a Writing attempt waits for its correction. */
  score: number | null;
  maxScore: number;
  status: 'completed' | 'pending';
  completedAt: string | null;
  durationSeconds: number | null;
  modelltestId: string | null;
}

export function historyFields(
  skill: Skill,
  row: {
    attemptId: string;
    teil: number;
    score: number | null | undefined;
    completedAt: Date | null | undefined;
    durationSeconds?: number | null;
    modelltestId?: string | null;
  },
): SharedHistoryFields {
  const completed = row.score !== null && row.score !== undefined;
  return {
    attemptId: row.attemptId,
    skill: SKILL_ID[skill],
    teil: row.teil,
    score: completed ? row.score! : null,
    maxScore: PERCENT,
    status: completed ? 'completed' : 'pending',
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    durationSeconds: row.durationSeconds ?? null,
    modelltestId: row.modelltestId ?? null,
  };
}

/** The fields every module's `/teils` item carries (D29), per Teil. */
export interface TeilStats {
  attempts: number;
  bestScore: number | null;
  lastScore: number | null;
  lastAttemptAt: string | null;
  maxScore: number;
}

const NO_ATTEMPTS: TeilStats = {
  attempts: 0,
  bestScore: null,
  lastScore: null,
  lastAttemptAt: null,
  maxScore: PERCENT,
};

/**
 * Per-Teil numbers read from `StudentActivity`, the one record of what a
 * student completed. A guest has no rows and gets zeros. A failure also gives
 * zeros: the numbers must never hide the exercises they sit beside.
 */
export async function teilStats(
  prisma: Pick<PrismaService, 'studentActivity'>,
  studentId: string,
  skill: Skill,
  teils: number[],
): Promise<Record<number, TeilStats>> {
  const result: Record<number, TeilStats> = {};
  for (const teil of teils) result[teil] = { ...NO_ATTEMPTS };

  try {
    const [totals, latest] = await Promise.all([
      prisma.studentActivity.groupBy({
        by: ['teil'],
        where: { student_id: studentId, skill },
        _count: { _all: true },
        _max: { score: true },
      }),
      prisma.studentActivity.findMany({
        where: { student_id: studentId, skill },
        orderBy: [{ teil: 'asc' }, { created_at: 'desc' }],
        distinct: ['teil'],
        select: { teil: true, score: true, created_at: true },
      }),
    ]);
    for (const teil of teils) {
      const total = totals.find((row) => row.teil === teil);
      if (!total) continue;
      const last = latest.find((row) => row.teil === teil);
      result[teil] = {
        attempts: total._count._all,
        bestScore: total._max.score,
        lastScore: last?.score ?? null,
        lastAttemptAt: last?.created_at.toISOString() ?? null,
        maxScore: PERCENT,
      };
    }
  } catch {
    // Zeros, as initialised.
  }
  return result;
}
