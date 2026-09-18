import { Injectable } from '@nestjs/common';
import type { CefrLevel, Skill } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';
import { SKILL_ID, type SkillId } from '../student-activity/student-history';
import {
  alerts,
  readiness,
  RECENT_ATTEMPTS_PER_TEIL,
  roundScores,
  SKILLS,
  skillScores,
  type ProgressAlert,
  type Readiness,
  type SkillScores,
  type TeilScore,
} from './progress-formula';

const WEEK_MS = 7 * 86_400_000;

export type WireAlert =
  | { type: 'inactive'; lastActivityAt: string | null }
  | { type: 'low_progress'; readiness: number }
  | { type: 'weak_skill'; skill: SkillId; score: number };

/** One student's numbers, as the dashboard and the Flutter app receive them. */
export interface StudentProgress {
  /** Per skill, 0–100; null = not practised yet. */
  skills: Record<SkillId, number | null>;
  readiness: Readiness;
  attempts: number;
  lastActivityAt: string | null;
  alerts: WireAlert[];
}

export interface CenterProgressSummary {
  students: number;
  /** Mean readiness of the students who have one; null when none does. */
  averageReadiness: number | null;
  /** How many students count as ready for the exam. */
  ready: number;
  /** Mean of each skill across the students who practised it. */
  skillAverages: Record<SkillId, number | null>;
  alerts: { inactive: number; lowProgress: number; weakSkill: number };
}

interface Activity {
  teils: TeilScore[];
  attempts: number;
  lastActivityAt: Date | null;
}

/**
 * D38, computed once in the backend from `StudentActivity`. The center
 * dashboard and the Flutter app both read this; neither computes anything.
 */
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every student's progress in one query, however many students. */
  async forStudents(
    studentIds: string[],
    now = new Date(),
  ): Promise<Map<string, StudentProgress>> {
    const activity = await this.activityOf(studentIds, now);
    const result = new Map<string, StudentProgress>();
    for (const id of studentIds) {
      result.set(id, this.progressOf(activity.get(id), now));
    }
    return result;
  }

  /**
   * The signed-in student's numbers, with the weekly change: readiness now
   * minus readiness on the activity up to 7 days ago (D38).
   */
  async forStudent(
    studentId: string,
    now = new Date(),
  ): Promise<
    StudentProgress & { weeklyChange: number | null; level: CefrLevel | null }
  > {
    const weekAgo = new Date(now.getTime() - WEEK_MS);
    const [current, before, student] = await Promise.all([
      this.activityOf([studentId], now),
      this.activityOf([studentId], weekAgo),
      // A guest has no row, and no level.
      this.prisma.student.findUnique({
        where: { id: studentId },
        select: { level: true },
      }),
    ]);
    const progress = this.progressOf(current.get(studentId), now);
    const earlier = this.progressOf(before.get(studentId), weekAgo);
    const weeklyChange =
      progress.readiness.score !== null && earlier.readiness.score !== null
        ? progress.readiness.score - earlier.readiness.score
        : null;
    return { ...progress, weeklyChange, level: student?.level ?? null };
  }

  /** The dashboard's headline numbers, over every student of the center. */
  async forCenter(
    centerId: string,
    now = new Date(),
  ): Promise<CenterProgressSummary> {
    const students = await this.prisma.student.findMany({
      where: { center_id: centerId },
      select: { id: true },
    });
    const all = [
      ...(
        await this.forStudents(
          students.map((s) => s.id),
          now,
        )
      ).values(),
    ];

    const mean = (values: number[]) =>
      values.length
        ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
        : null;

    const skillAverages = {} as Record<SkillId, number | null>;
    for (const skill of SKILLS) {
      const id = SKILL_ID[skill];
      skillAverages[id] = mean(
        all.map((p) => p.skills[id]).filter((v): v is number => v !== null),
      );
    }
    const count = (type: WireAlert['type']) =>
      all.filter((p) => p.alerts.some((a) => a.type === type)).length;

    return {
      students: all.length,
      averageReadiness: mean(
        all
          .map((p) => p.readiness.score)
          .filter((v): v is number => v !== null),
      ),
      ready: all.filter((p) => p.readiness.ready).length,
      skillAverages,
      alerts: {
        inactive: count('inactive'),
        lowProgress: count('low_progress'),
        weakSkill: count('weak_skill'),
      },
    };
  }

  private progressOf(
    activity: Activity | undefined,
    now: Date,
  ): StudentProgress {
    const exact: SkillScores = skillScores(activity?.teils ?? []);
    // The pass decision on the exact scores; everything shown, rounded.
    const result = readiness(exact, activity?.attempts ?? 0);
    const scores = roundScores(exact);
    const lastActivityAt = activity?.lastActivityAt ?? null;
    const skills = {} as Record<SkillId, number | null>;
    for (const skill of SKILLS) skills[SKILL_ID[skill]] = scores[skill];
    return {
      skills,
      readiness: result,
      attempts: activity?.attempts ?? 0,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
      alerts: alerts(scores, result, lastActivityAt, now).map(toWire),
    };
  }

  /**
   * Per student and Teil: the mean of the last 3 attempts, the attempt count,
   * the latest activity. One grouped query for the whole list, so a page of
   * students costs the same as one.
   */
  private async activityOf(
    studentIds: string[],
    asOf: Date,
  ): Promise<Map<string, Activity>> {
    const byStudent = new Map<string, Activity>();
    if (studentIds.length === 0) return byStudent;

    const rows = await this.prisma.$queryRaw<
      {
        student_id: string;
        skill: Skill;
        teil: number;
        score: number;
        attempts: number;
        last_at: Date;
      }[]
    >`
      WITH ranked AS (
        SELECT student_id, skill, teil, created_at,
               score::float8 * 100 / max_score AS percent,
               ROW_NUMBER() OVER (
                 PARTITION BY student_id, skill, teil
                 ORDER BY created_at DESC
               ) AS recent
        FROM student_activities
        WHERE student_id = ANY(${studentIds}::text[])
          AND created_at <= ${asOf}
      )
      SELECT student_id,
             skill::text AS skill,
             teil,
             AVG(percent) FILTER (WHERE recent <= ${RECENT_ATTEMPTS_PER_TEIL}) AS score,
             COUNT(*)::int AS attempts,
             MAX(created_at) AS last_at
      FROM ranked
      GROUP BY student_id, skill, teil`;

    for (const row of rows) {
      const entry = byStudent.get(row.student_id) ?? {
        teils: [],
        attempts: 0,
        lastActivityAt: null,
      };
      entry.teils.push({ skill: row.skill, teil: row.teil, score: row.score });
      entry.attempts += row.attempts;
      if (!entry.lastActivityAt || row.last_at > entry.lastActivityAt) {
        entry.lastActivityAt = row.last_at;
      }
      byStudent.set(row.student_id, entry);
    }
    return byStudent;
  }
}

function toWire(alert: ProgressAlert): WireAlert {
  switch (alert.type) {
    case 'inactive':
      return {
        type: 'inactive',
        lastActivityAt: alert.lastActivityAt?.toISOString() ?? null,
      };
    case 'low_progress':
      return alert;
    case 'weak_skill':
      return {
        type: 'weak_skill',
        skill: SKILL_ID[alert.skill],
        score: alert.score,
      };
  }
}
