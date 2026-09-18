import type { Skill } from '@prisma/client';

/**
 * The D38 calculation, as pure functions: skill scores, readiness, alerts.
 *
 * Nothing here reads the database or stores a result. Every number is derived
 * from `StudentActivity` when asked, so changing a weight below changes every
 * student's history at once, with nothing to migrate.
 */

/** Teils per skill in telc B1. A Teil never attempted counts 0 (D38). */
export const TEILS_PER_SKILL: Record<Skill, number> = {
  HOEREN: 3,
  LESEN: 3,
  SPRACHBAUSTEINE: 2,
  SCHREIBEN: 1,
  SPRECHEN: 3,
};

/**
 * PROVISIONAL weights, agreed with Herman on 2026-09-19 until the official
 * telc B1+ Beruf points grid is entered. Change them here and nowhere else.
 *
 * The written skills weigh equally; written/oral is 75/25, the telc Deutsch
 * B1 split (225 / 75 points).
 */
export const WRITTEN_SKILL_WEIGHTS: Partial<Record<Skill, number>> = {
  LESEN: 1,
  SPRACHBAUSTEINE: 1,
  HOEREN: 1,
  SCHREIBEN: 1,
};
export const WRITTEN_WEIGHT = 75;
export const ORAL_WEIGHT = 25;

/** telc passes a candidate with at least 60 % in each part. */
export const PASS_MARK = 60;
/** Under this many attempts in total, readiness is not a number yet. */
export const MIN_ATTEMPTS_FOR_READINESS = 5;
/** How many recent attempts make a Teil score. */
export const RECENT_ATTEMPTS_PER_TEIL = 3;

/** Alert thresholds, the ones the dashboard already uses (D38). */
export const INACTIVE_AFTER_DAYS = 7;
export const LOW_PROGRESS_BELOW = 40;
export const WEAK_SKILL_BELOW = 45;

export const SKILLS: Skill[] = [
  'HOEREN',
  'LESEN',
  'SPRACHBAUSTEINE',
  'SCHREIBEN',
  'SPRECHEN',
];

/** One Teil's score: the mean of its recent attempts, in percent. */
export interface TeilScore {
  skill: Skill;
  teil: number;
  score: number;
}

export type SkillScores = Record<Skill, number | null>;

/**
 * Skill score = mean of its Teil scores, a Teil never attempted counting 0.
 * A skill with no attempt at all is null: "not practised yet", never 0 %.
 */
export function skillScores(teils: TeilScore[]): SkillScores {
  const result = {} as SkillScores;
  for (const skill of SKILLS) {
    const own = teils.filter(
      (t) =>
        t.skill === skill && t.teil >= 1 && t.teil <= TEILS_PER_SKILL[skill],
    );
    if (own.length === 0) {
      result[skill] = null;
      continue;
    }
    const sum = own.reduce((total, t) => total + t.score, 0);
    result[skill] = Math.round(sum / TEILS_PER_SKILL[skill]);
  }
  return result;
}

export interface Readiness {
  /** 0–100, or null under MIN_ATTEMPTS_FOR_READINESS attempts. */
  score: number | null;
  written: number | null;
  oral: number | null;
  /** Both parts at the pass mark. False while there is not enough data. */
  ready: boolean;
}

/**
 * Readiness mirrors telc scoring: a written and an oral part, each needing
 * the pass mark. Skills never practised count 0 here (option C): a student
 * who skips speaking is not ready, and the number says so.
 */
export function readiness(
  skills: SkillScores,
  totalAttempts: number,
): Readiness {
  if (totalAttempts < MIN_ATTEMPTS_FOR_READINESS) {
    return { score: null, written: null, oral: null, ready: false };
  }
  let weighted = 0;
  let weights = 0;
  for (const [skill, weight] of Object.entries(WRITTEN_SKILL_WEIGHTS)) {
    weighted += (skills[skill as Skill] ?? 0) * weight;
    weights += weight;
  }
  const written = weighted / weights;
  const oral = skills.SPRECHEN ?? 0;
  const score =
    (written * WRITTEN_WEIGHT + oral * ORAL_WEIGHT) /
    (WRITTEN_WEIGHT + ORAL_WEIGHT);
  return {
    score: Math.round(score),
    written: Math.round(written),
    oral: Math.round(oral),
    // Compared before rounding: 59.75 is not a pass.
    ready: written >= PASS_MARK && oral >= PASS_MARK,
  };
}

export type ProgressAlert =
  | { type: 'inactive'; lastActivityAt: Date | null }
  | { type: 'low_progress'; readiness: number }
  | { type: 'weak_skill'; skill: Skill; score: number };

export function alerts(
  skills: SkillScores,
  result: Readiness,
  lastActivityAt: Date | null,
  now: Date,
): ProgressAlert[] {
  const found: ProgressAlert[] = [];
  const inactiveSince = now.getTime() - INACTIVE_AFTER_DAYS * 86_400_000;
  if (!lastActivityAt || lastActivityAt.getTime() < inactiveSince) {
    found.push({ type: 'inactive', lastActivityAt });
  }
  if (result.score !== null && result.score < LOW_PROGRESS_BELOW) {
    found.push({ type: 'low_progress', readiness: result.score });
  }
  for (const skill of SKILLS) {
    const score = skills[skill];
    // Only a skill already practised: "not practised yet" is not weak.
    if (score !== null && score < WEAK_SKILL_BELOW) {
      found.push({ type: 'weak_skill', skill, score });
    }
  }
  return found;
}
