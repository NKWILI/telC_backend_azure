import { Prisma, type Skill } from '@prisma/client';
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
 *
 * `modelltestId` scopes them to one Modelltest, for the routes whose Teil list
 * is per Modelltest; otherwise every attempt at that Teil counts.
 *
 * One grouped query rather than Prisma's `distinct`, which without the
 * `nativeDistinct` feature loads every row and deduplicates in memory.
 */
export async function teilStats(
  prisma: Pick<PrismaService, '$queryRaw'>,
  studentId: string,
  skill: Skill,
  teils: number[],
  modelltestId?: string,
): Promise<Record<number, TeilStats>> {
  const result: Record<number, TeilStats> = {};
  for (const teil of teils) result[teil] = { ...NO_ATTEMPTS };

  try {
    const rows = await prisma.$queryRaw<
      {
        teil: number;
        attempts: number;
        best_score: number;
        last_score: number;
        last_at: Date;
      }[]
    >`
      SELECT teil,
             COUNT(*)::int AS attempts,
             MAX(score) AS best_score,
             (ARRAY_AGG(score ORDER BY created_at DESC))[1] AS last_score,
             MAX(created_at) AS last_at
      FROM student_activities
      WHERE student_id = ${studentId}
        AND skill = ${skill}::"Skill"
        ${modelltestId ? Prisma.sql`AND modelltest_id = ${modelltestId}::uuid` : Prisma.empty}
      GROUP BY teil`;
    for (const row of rows) {
      if (!(row.teil in result)) continue;
      result[row.teil] = {
        attempts: row.attempts,
        bestScore: row.best_score,
        lastScore: row.last_score,
        lastAttemptAt: row.last_at.toISOString(),
        maxScore: PERCENT,
      };
    }
  } catch {
    // Zeros, as initialised.
  }
  return result;
}
