/**
 * The D38 numbers come from one SQL query over `student_activities`. What it
 * must get right — the last 3 attempts per Teil, nothing after the date asked
 * for, one student never leaking into another — is only provable on Postgres.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import { randomUUID } from 'node:crypto';
import type { Skill } from '@prisma/client';
import { PrismaService } from '../src/shared/services/prisma.service';
import { ProgressService } from '../src/modules/progress/progress.service';

const prisma = new PrismaService();
const progress = new ProgressService(prisma);
const NOW = new Date('2026-09-19T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@progress.integration.test' } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Progress Test' } },
  });
}

async function makeStudent(centerId?: string) {
  return prisma.student.create({
    data: {
      email: `s-${randomUUID()}@progress.integration.test`,
      center_id: centerId,
    },
  });
}

async function attempt(
  studentId: string,
  skill: Skill,
  teil: number,
  score: number,
  at: Date,
  maxScore = 100,
) {
  await prisma.studentActivity.create({
    data: {
      student_id: studentId,
      skill,
      teil,
      score,
      max_score: maxScore,
      attempt_id: randomUUID(),
      created_at: at,
    },
  });
}

describe('progress against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  it('scores a Teil from its last 3 attempts only, on any scale', async () => {
    const s = await makeStudent();
    // Oldest first; the 10 must drop out.
    await attempt(s.id, 'SCHREIBEN', 1, 10, daysAgo(5));
    await attempt(s.id, 'SCHREIBEN', 1, 60, daysAgo(4));
    await attempt(s.id, 'SCHREIBEN', 1, 70, daysAgo(3));
    await attempt(s.id, 'SCHREIBEN', 1, 40, daysAgo(2), 50); // 80 %

    const result = (await progress.forStudents([s.id], NOW)).get(s.id)!;

    expect(result.skills.schreiben).toBe(70); // (60 + 70 + 80) / 3
    expect(result.attempts).toBe(4);
    expect(result.lastActivityAt).toBe(daysAgo(2).toISOString());
    expect(result.skills.sprechen).toBeNull();
    // Four attempts: not enough for a readiness yet.
    expect(result.readiness.score).toBeNull();
  });

  it('computes readiness and keeps students apart', async () => {
    const a = await makeStudent();
    const b = await makeStudent();
    for (const teil of [1, 2, 3]) {
      await attempt(a.id, 'HOEREN', teil, 80, daysAgo(1));
      await attempt(a.id, 'LESEN', teil, 80, daysAgo(1));
      await attempt(a.id, 'SPRECHEN', teil, 80, daysAgo(1));
    }
    await attempt(a.id, 'SPRACHBAUSTEINE', 1, 80, daysAgo(1));
    await attempt(a.id, 'SPRACHBAUSTEINE', 2, 80, daysAgo(1));
    await attempt(a.id, 'SCHREIBEN', 1, 80, daysAgo(1));
    await attempt(b.id, 'LESEN', 1, 20, daysAgo(1));

    const all = await progress.forStudents([a.id, b.id], NOW);

    expect(all.get(a.id)!.readiness).toEqual({
      score: 80,
      written: 80,
      oral: 80,
      ready: true,
    });
    expect(all.get(a.id)!.alerts).toEqual([]);
    expect(all.get(b.id)!.skills.lesen).toBe(7); // (20 + 0 + 0) / 3
    expect(all.get(b.id)!.attempts).toBe(1);
  });

  it('measures the weekly change on the activity up to 7 days ago', async () => {
    const s = await makeStudent();
    // Two weeks ago: 5 weak attempts. This week: strong ones on the same Teils.
    const teils: [Skill, number][] = [
      ['HOEREN', 1],
      ['LESEN', 1],
      ['SPRACHBAUSTEINE', 1],
      ['SCHREIBEN', 1],
      ['SPRECHEN', 1],
    ];
    for (const [skill, teil] of teils)
      await attempt(s.id, skill, teil, 30, daysAgo(14));
    for (const [skill, teil] of teils) {
      await attempt(s.id, skill, teil, 90, daysAgo(2));
      await attempt(s.id, skill, teil, 90, daysAgo(1));
    }

    const result = await progress.forStudent(s.id, NOW);
    const weekAgo = (await progress.forStudents([s.id], daysAgo(7))).get(s.id)!;

    expect(weekAgo.readiness.score).not.toBeNull();
    expect(result.weeklyChange).toBe(
      result.readiness.score! - weekAgo.readiness.score!,
    );
    expect(result.weeklyChange).toBeGreaterThan(0);
  });

  it('summarises a center over its own students only', async () => {
    const center = await prisma.center.create({
      data: { name: `Progress Test ${randomUUID()}` },
    });
    const active = await makeStudent(center.id);
    await makeStudent(center.id); // never practised: inactive
    const outsider = await makeStudent();
    for (let i = 0; i < 5; i++) {
      await attempt(active.id, 'LESEN', 1, 30, daysAgo(1));
    }
    await attempt(outsider.id, 'LESEN', 1, 100, daysAgo(1));

    const summary = await progress.forCenter(center.id, NOW);

    expect(summary).toMatchObject({
      students: 2,
      ready: 0,
      alerts: { inactive: 1, lowProgress: 1, weakSkill: 1 },
    });
    expect(summary.skillAverages.lesen).toBe(10); // (30 + 0 + 0) / 3
    expect(summary.skillAverages.hoeren).toBeNull();
    // Only the active student has a readiness: written 10 / 4 = 2.5, oral 0,
    // 0.75 × 2.5 = 1.875 → 2. The one who never practised does not pull it.
    expect(summary.averageReadiness).toBe(2);
  });
});
