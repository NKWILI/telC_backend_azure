/**
 * D39 on real Postgres: a reset hides what the student did on the seat — and
 * only that — then erases it after 7 days, and support can restore it before.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/shared/services/prisma.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { CodeRedemptionService } from '../src/modules/centers/code-redemption.service';
import { CenterActivationCodesService } from '../src/modules/centers/center-activation-codes.service';
import { generateActivationCode } from '../src/modules/centers/activation-code-format';
import { ProgressService } from '../src/modules/progress/progress.service';
import { SeatErasureService } from '../src/modules/student-activity/seat-erasure';
import { recordActivity } from '../src/modules/student-activity/student-activity.writer';

const DAY_MS = 86_400_000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);
const MODELLTEST = '00000000-0000-4000-8000-000000000033';

const prisma = new PrismaService();
const redemption = new CodeRedemptionService(
  prisma,
  new SubscriptionPolicyService(),
);
const codes = new CenterActivationCodesService(prisma);
const progress = new ProgressService(prisma);
const erasure = new SeatErasureService(prisma);

async function wipe() {
  const students = await prisma.student.findMany({
    where: { email: { endsWith: '@erasure.integration.test' } },
    select: { id: true },
  });
  const ids = students.map((s) => s.id);
  await prisma.lesenAttempt.deleteMany({ where: { student_id: { in: ids } } });
  await prisma.dataErasure.deleteMany({ where: { student_id: { in: ids } } });
  await prisma.student.deleteMany({ where: { id: { in: ids } } });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Erasure Test' } },
  });
}

/** A Lesen attempt with its summary, completed at `at`. */
async function lesen(studentId: string, at: Date) {
  const attemptId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.lesenAttempt.create({
      data: {
        attempt_id: attemptId,
        student_id: studentId,
        teil_id: '1',
        modelltest_id: MODELLTEST,
        score: 80,
        answers: {},
        created_at: at,
      },
    });
    await recordActivity(tx, {
      studentId,
      skill: 'LESEN',
      teil: 1,
      score: 80,
      attemptId,
      completedAt: at,
    });
  });
  return attemptId;
}

/** A student who practised alone, then joined a school and practised there. */
async function studentOnSeat() {
  const center = await prisma.center.create({
    data: {
      name: `Erasure Test ${randomUUID()}`,
      subscription: {
        create: {
          plan: 'TRIAL',
          trial_started_at: daysFromNow(-1),
          trial_ends_at: daysFromNow(13),
        },
      },
    },
  });
  const code = await prisma.activationCode.create({
    data: {
      center_id: center.id,
      code: generateActivationCode(),
      tier: 'START',
      expires_at: daysFromNow(13),
    },
  });
  const student = await prisma.student.create({
    data: { email: `s-${randomUUID()}@erasure.integration.test` },
  });

  const before = await lesen(student.id, daysFromNow(-3));
  await redemption.redeem({ studentId: student.id }, code.code, 'ip');
  const onSeat = [await lesen(student.id, new Date())];
  onSeat.push(await lesen(student.id, new Date()));

  const manager = { centerId: center.id, centerUserId: 'owner-1' } as never;
  return { student, code, manager, before, onSeat };
}

const visible = (studentId: string) =>
  prisma.studentActivity.count({
    where: { student_id: studentId, erasure_id: null },
  });

describe('seat data erasure against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  it('hides the seat work at the reset, and keeps what came before', async () => {
    const { student, code, manager, before, onSeat } = await studentOnSeat();
    expect((await progress.forStudent(student.id)).attempts).toBe(3);

    await codes.reset(manager, code.id);

    // Only the work from before the school is left in every read.
    expect((await progress.forStudent(student.id)).attempts).toBe(1);
    expect(await visible(student.id)).toBe(1);
    const shown = await prisma.lesenAttempt.findMany({
      where: { student_id: student.id, erasure_id: null },
      select: { attempt_id: true },
    });
    expect(shown.map((r) => r.attempt_id)).toEqual([before]);

    // Hidden, not gone: the erasure waits 7 days.
    const record = await prisma.dataErasure.findFirstOrThrow({
      where: { student_id: student.id },
    });
    expect(record.code_id).toBe(code.id);
    expect(
      await prisma.lesenAttempt.count({
        where: { attempt_id: { in: onSeat }, erasure_id: record.id },
      }),
    ).toBe(2);
  });

  it('erases the hidden work only after 7 days, and nothing else', async () => {
    const { student, code, manager, before } = await studentOnSeat();
    await codes.reset(manager, code.id);

    expect(await erasure.purgeDue(daysFromNow(6))).toBe(0);
    expect(
      await prisma.studentActivity.count({ where: { student_id: student.id } }),
    ).toBe(3);

    expect(await erasure.purgeDue(daysFromNow(8))).toBe(1);
    const left = await prisma.lesenAttempt.findMany({
      where: { student_id: student.id },
      select: { attempt_id: true },
    });
    expect(left.map((r) => r.attempt_id)).toEqual([before]);
    expect(
      await prisma.studentActivity.count({ where: { student_id: student.id } }),
    ).toBe(1);
    // The account stays.
    expect(await prisma.student.count({ where: { id: student.id } })).toBe(1);

    // Running again changes nothing.
    expect(await erasure.purgeDue(daysFromNow(9))).toBe(0);
  });

  it('lets support restore a mistaken reset before the erasure, not after', async () => {
    const { student, code, manager } = await studentOnSeat();
    await codes.reset(manager, code.id);
    const record = await prisma.dataErasure.findFirstOrThrow({
      where: { student_id: student.id },
    });

    await erasure.restore(record.id);

    expect(await visible(student.id)).toBe(3);
    // A restored erasure is never purged.
    expect(await erasure.purgeDue(daysFromNow(8))).toBe(0);
    expect(await visible(student.id)).toBe(3);

    // And one already erased cannot be restored.
    const other = await studentOnSeat();
    await codes.reset(other.manager, other.code.id);
    await erasure.purgeDue(daysFromNow(8));
    const erased = await prisma.dataErasure.findFirstOrThrow({
      where: { student_id: other.student.id },
    });
    await expect(erasure.restore(erased.id)).rejects.toThrow('ALREADY_ERASED');
  });

  it('erases nothing when a seat nobody used is reset', async () => {
    const { code, manager } = await studentOnSeat();
    // First reset takes the seat from the student; the second finds it empty.
    await codes.reset(manager, code.id);
    const count = await prisma.dataErasure.count();

    await codes.reset(manager, code.id);

    expect(await prisma.dataErasure.count()).toBe(count);
  });
});
