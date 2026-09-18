/**
 * What phase 11 promises is about the database: one summary per attempt, a
 * repeat stored once even when two copies race, and a backfill that can run
 * again without adding anything.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/services/prisma.service';
import { recordActivity } from '../src/modules/student-activity/student-activity.writer';
import { submitOnce } from '../src/modules/student-activity/submit-once';
import { teilStats } from '../src/modules/student-activity/student-history';

const prisma = new PrismaService();
const MODELLTEST = '00000000-0000-4000-8000-000000000011';

async function wipe() {
  const students = await prisma.student.findMany({
    where: { email: { endsWith: '@activity.integration.test' } },
    select: { id: true },
  });
  const ids = students.map((s) => s.id);
  await prisma.lesenAttempt.deleteMany({ where: { student_id: { in: ids } } });
  await prisma.writingAttempt.deleteMany({
    where: { student_id: { in: ids } },
  });
  // Activity rows go with the student (ON DELETE CASCADE).
  await prisma.student.deleteMany({ where: { id: { in: ids } } });
}

async function makeStudent() {
  return prisma.student.create({
    data: { email: `s-${randomUUID()}@activity.integration.test` },
  });
}

/** A Lesen submit, the way the service stores one. */
function storeLesen(
  studentId: string,
  attemptId: string | undefined,
  score: number,
) {
  return submitOnce(
    studentId,
    attemptId,
    (id) =>
      prisma.lesenAttempt.findUnique({
        where: { attempt_id: id },
        select: { student_id: true, score: true },
      }),
    (id) =>
      prisma.$transaction(async (tx) => {
        await tx.lesenAttempt.create({
          data: {
            attempt_id: id,
            student_id: studentId,
            teil_id: '2',
            modelltest_id: MODELLTEST,
            score,
            answers: {},
          },
        });
        await recordActivity(tx, {
          studentId,
          skill: 'LESEN',
          teil: 2,
          score,
          modelltestId: MODELLTEST,
          attemptId: id,
        });
      }),
  );
}

describe('student activity against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  it('writes the attempt and its summary together', async () => {
    const student = await makeStudent();

    const { attemptId } = await storeLesen(student.id, undefined, 60);

    const activity = await prisma.studentActivity.findMany({
      where: { student_id: student.id },
    });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      skill: 'LESEN',
      teil: 2,
      score: 60,
      max_score: 100,
      attempt_id: attemptId,
    });
  });

  it('stores an attempt once when two copies arrive at the same moment', async () => {
    const student = await makeStudent();
    const id = randomUUID();

    const results = await Promise.all([
      storeLesen(student.id, id, 60),
      storeLesen(student.id, id, 60),
      storeLesen(student.id, id, 60),
    ]);

    expect(results.every((r) => r.attemptId === id)).toBe(true);
    expect(await prisma.lesenAttempt.count({ where: { attempt_id: id } })).toBe(
      1,
    );
    expect(
      await prisma.studentActivity.count({ where: { attempt_id: id } }),
    ).toBe(1);
  });

  it('rolls the attempt back when its summary cannot be written', async () => {
    const student = await makeStudent();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.lesenAttempt.create({
          data: {
            attempt_id: 'rollback-check',
            student_id: student.id,
            teil_id: '2',
            modelltest_id: MODELLTEST,
            score: 50,
            answers: {},
          },
        });
        await recordActivity(tx, {
          studentId: student.id,
          skill: 'LESEN',
          teil: 2,
          score: 150,
          attemptId: 'rollback-check',
        });
      }),
    ).rejects.toThrow(/Invalid activity/);

    expect(
      await prisma.lesenAttempt.count({
        where: { attempt_id: 'rollback-check' },
      }),
    ).toBe(0);
  });

  it('records nothing for a guest, who has no student row', async () => {
    const guestId = randomUUID();

    const written = await prisma.$transaction((tx) =>
      recordActivity(tx, {
        studentId: guestId,
        skill: 'HOEREN',
        teil: 1,
        score: 80,
        attemptId: randomUUID(),
      }),
    );

    expect(written).toBe(false);
    expect(
      await prisma.studentActivity.count({ where: { student_id: guestId } }),
    ).toBe(0);
  });

  it('backfills a completed writing attempt once, however often it runs, and skips the stub', async () => {
    const student = await makeStudent();
    const real = randomUUID();
    const stub = randomUUID();
    await prisma.writingAttempt.createMany({
      data: [
        {
          attempt_id: real,
          student_id: student.id,
          exercise_id: 'x',
          content: 'Text',
          status: 'completed',
          score: 81,
          feedback: 'Gut.',
          completed_at: new Date(),
        },
        {
          attempt_id: stub,
          student_id: student.id,
          exercise_id: 'x',
          content: 'Text',
          status: 'completed',
          score: 75,
          feedback: 'Stub feedback. Echte Korrektur folgt.',
          completed_at: new Date(),
        },
      ],
    });

    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '../prisma/migrations/20260919120000_student_activity/migration.sql',
      ),
      'utf8',
    );
    const backfill = sql
      .slice(sql.indexOf('-- Backfill'))
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes('INSERT INTO'));
    expect(backfill).toHaveLength(3);

    for (let run = 0; run < 2; run++) {
      for (const statement of backfill)
        await prisma.$executeRawUnsafe(statement);
    }

    const rows = await prisma.studentActivity.findMany({
      where: { student_id: student.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skill: 'SCHREIBEN',
      attempt_id: real,
      score: 81,
    });
  });

  it('computes per-Teil numbers in SQL, scoped to one Modelltest when asked', async () => {
    const student = await makeStudent();
    const other = '00000000-0000-4000-8000-000000000022';
    const at = (day: number) => new Date(`2026-09-${day}T10:00:00Z`);
    const rows: [number, number, string, Date][] = [
      [1, 60, MODELLTEST, at(10)],
      [1, 90, MODELLTEST, at(11)],
      [1, 70, MODELLTEST, at(12)], // latest in this Modelltest
      [1, 100, other, at(13)], // another Modelltest, and latest overall
    ];
    for (const [teil, score, modelltestId, completedAt] of rows) {
      await prisma.$transaction((tx) =>
        recordActivity(tx, {
          studentId: student.id,
          skill: 'HOEREN',
          teil,
          score,
          modelltestId,
          attemptId: randomUUID(),
          completedAt,
        }),
      );
    }

    const scoped = await teilStats(
      prisma,
      student.id,
      'HOEREN',
      [1, 2],
      MODELLTEST,
    );
    expect(scoped[1]).toEqual({
      attempts: 3,
      bestScore: 90,
      lastScore: 70,
      lastAttemptAt: at(12).toISOString(),
      maxScore: 100,
    });
    expect(scoped[2].attempts).toBe(0);

    const all = await teilStats(prisma, student.id, 'HOEREN', [1]);
    expect(all[1]).toMatchObject({
      attempts: 4,
      bestScore: 100,
      lastScore: 100,
    });

    // Another skill's rows never count.
    const lesen = await teilStats(prisma, student.id, 'LESEN', [1]);
    expect(lesen[1].attempts).toBe(0);
  });
});
