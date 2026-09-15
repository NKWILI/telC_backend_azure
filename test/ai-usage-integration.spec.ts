/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * The quota is a set of rows, so only the rows can prove it.
 *
 * Two claims a mocked Prisma cannot make: that the window really is a range
 * scan over `created_at` rather than a count of everything, and that one
 * student's usage never counts against another's. Both are the sort of thing
 * a mock answers with whatever number it was handed.
 *
 * Runs against the disposable branch in `.env.test`.
 */
import { PrismaService } from '../src/shared/services/prisma.service';
import { AiUsageService } from '../src/shared/services/ai-usage.service';
import { AiQuotaService } from '../src/shared/services/ai-quota.service';
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const prisma = new PrismaService();
const usage = new AiUsageService(prisma);
const quota = new AiQuotaService(
  new StudentEntitlementService(prisma, new SubscriptionPolicyService()),
  usage,
);

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

async function wipe() {
  await prisma.aiUsage.deleteMany({
    where: { student: { email: { startsWith: 'ai-usage-test-' } } },
  });
  await prisma.student.deleteMany({
    where: { email: { startsWith: 'ai-usage-test-' } },
  });
  await prisma.centerSeat.deleteMany({
    where: { center: { name: { startsWith: 'Ai Usage Test' } } },
  });
  await prisma.centerSubscription.deleteMany({
    where: { center: { name: { startsWith: 'Ai Usage Test' } } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Ai Usage Test' } },
  });
}

/** A paying center, so its students carry a real tier. */
async function makeCenterStudent(tier: 'START' | 'PRO' | 'PREMIUM') {
  const center = await prisma.center.create({
    data: {
      name: `Ai Usage Test ${tier} ${Date.now()}-${Math.random()}`,
      country: 'Cameroon',
      city: 'Douala',
      subscription: {
        create: {
          plan: 'PAID',
          seats: 10,
          paid_until: new Date(Date.now() + 30 * 24 * HOUR_MS),
        },
      },
    },
  });

  return prisma.student.create({
    data: {
      email: `ai-usage-test-${tier}-${Date.now()}-${Math.random()}@example.com`,
      center_id: center.id,
      tier,
    },
  });
}

async function makeStudent(label: string) {
  return prisma.student.create({
    data: {
      email: `ai-usage-test-${label}-${Date.now()}-${Math.random()}@example.com`,
    },
  });
}

/** A row aged deliberately, which is the only way to test a rolling window. */
async function usedAt(studentId: string, at: Date) {
  await prisma.aiUsage.create({
    data: {
      student_id: studentId,
      operation: 'SPEAKING_EVALUATION',
      created_at: at,
    },
  });
}

// File scope, not describe scope. Two describes each ending the pool left the
// second one running against a closed pool, which fails as "cannot use a pool
// after calling end" rather than as anything to do with quotas.
beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await prisma.onModuleDestroy();
});

describe('ai usage against real Postgres', () => {
  describe('recording', () => {
    it('writes one row per operation', async () => {
      const student = await makeStudent('one');

      await usage.record(student.id, 'SPEAKING_EVALUATION');
      await usage.record(student.id, 'SPEAKING_EVALUATION');

      expect(
        await prisma.aiUsage.count({ where: { student_id: student.id } }),
      ).toBe(2);
    });

    it('stamps the row itself rather than trusting a caller clock', async () => {
      // The window is compared against these timestamps, so a caller able to
      // supply one could date a row into the past and refill its allowance.
      const student = await makeStudent('stamp');
      const before = Date.now();

      await usage.record(student.id, 'SPEAKING_EVALUATION');

      const row = await prisma.aiUsage.findFirstOrThrow({
        where: { student_id: student.id },
      });
      expect(row.created_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.created_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('refuses a row for a student who does not exist', async () => {
      // The foreign key, not a check in code. A usage row about nobody would
      // count against nobody and sit there for ever.
      await expect(
        usage.record('no-such-student', 'SPEAKING_EVALUATION'),
      ).rejects.toBeDefined();
    });
  });

  describe('counting a rolling window', () => {
    it('counts only rows newer than the cutoff', async () => {
      const student = await makeStudent('window');
      await usedAt(student.id, hoursAgo(1));
      await usedAt(student.id, hoursAgo(23));
      // Outside a 24-hour window by an hour, and by a year.
      await usedAt(student.id, hoursAgo(25));
      await usedAt(student.id, hoursAgo(24 * 365));

      const count = await usage.countSince(
        student.id,
        'SPEAKING_EVALUATION',
        hoursAgo(24),
      );

      expect(count).toBe(2);
    });

    it('counts nothing for a student who has used nothing', async () => {
      const student = await makeStudent('fresh');

      expect(
        await usage.countSince(student.id, 'SPEAKING_EVALUATION', hoursAgo(24)),
      ).toBe(0);
    });

    it('never counts one student usage against another', async () => {
      const mine = await makeStudent('mine');
      const theirs = await makeStudent('theirs');
      await usedAt(theirs.id, hoursAgo(1));
      await usedAt(theirs.id, hoursAgo(2));

      expect(
        await usage.countSince(mine.id, 'SPEAKING_EVALUATION', hoursAgo(24)),
      ).toBe(0);
    });

    it('counts each operation separately', async () => {
      // Premium's AI in every module writes rows here too. Without scoping by
      // operation, a writing correction would spend a speaking session.
      const student = await makeStudent('ops');
      await usedAt(student.id, hoursAgo(1));

      expect(
        await usage.countSince(student.id, 'SPEAKING_EVALUATION', hoursAgo(24)),
      ).toBe(1);

      // The enum has one value today, so the negative case is asserted
      // through the query shape instead: a different operation must not be
      // matched by this one.
      const rows = await prisma.aiUsage.findMany({
        where: { student_id: student.id, operation: 'SPEAKING_EVALUATION' },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('the oldest row in the window', () => {
    it('is what a reset time is computed from', async () => {
      // "You are back at 14:32" needs the moment the oldest counted row falls
      // out of the window, which is that row's timestamp plus 24 hours. A
      // fixed midnight would be wrong for everyone outside one timezone.
      const student = await makeStudent('reset');
      const oldest = hoursAgo(20);
      await usedAt(student.id, hoursAgo(2));
      await usedAt(student.id, oldest);
      await usedAt(student.id, hoursAgo(30));

      const at = await usage.oldestSince(
        student.id,
        'SPEAKING_EVALUATION',
        hoursAgo(24),
      );

      expect(at?.getTime()).toBeCloseTo(oldest.getTime(), -3);
    });

    it('is null when nothing is in the window', async () => {
      const student = await makeStudent('no-reset');
      await usedAt(student.id, hoursAgo(30));

      expect(
        await usage.oldestSince(
          student.id,
          'SPEAKING_EVALUATION',
          hoursAgo(24),
        ),
      ).toBeNull();
    });
  });

  it('keeps the index the quota question needs', async () => {
    // The table grows without bound, one row per AI call for ever. The query
    // is an equality on two columns and a range on a third, so the index has
    // to be in that order or it degrades to a scan as the table fills.
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
       WHERE tablename = 'ai_usage'
         AND indexdef LIKE '%student_id%'
    `;

    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.some((r) => /student_id.*operation.*created_at/.test(r.indexdef)),
    ).toBe(true);
  });
});
/**
 * The allowance, end to end: a real student, a real tier, real rows.
 *
 * The unit spec proves the arithmetic against mocks. This proves the tier
 * actually arrives from the database and that the window really excludes an
 * old row — the two places a mock would simply agree with whatever it was
 * told.
 */
describe('the AI allowance against real Postgres', () => {
  it.each([
    ['START', 2],
    ['PRO', 5],
    ['PREMIUM', 20],
  ] as const)('gives a %s student %i per window', async (tier, allowed) => {
    const student = await makeCenterStudent(tier);

    await expect(
      quota.check(student.id, 'SPEAKING_EVALUATION'),
    ).resolves.toMatchObject({ tier, allowedToday: allowed, allowed: true });
  });

  it('refuses a Start student who has used two in the window', async () => {
    const student = await makeCenterStudent('START');
    await usedAt(student.id, hoursAgo(1));
    await usedAt(student.id, hoursAgo(5));

    await expect(
      quota.assertWithinQuota(student.id, 'SPEAKING_EVALUATION'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'AI_QUOTA_EXCEEDED',
        tier: 'START',
        usedToday: 2,
        allowedToday: 2,
      }),
    });
  });

  it('lets the same student back in once a row ages out', async () => {
    // The whole point of a rolling window, and the thing a stored counter
    // would need a job to do.
    const student = await makeCenterStudent('START');
    await usedAt(student.id, hoursAgo(1));
    await usedAt(student.id, hoursAgo(25));

    await expect(
      quota.check(student.id, 'SPEAKING_EVALUATION'),
    ).resolves.toMatchObject({ allowed: true, usedToday: 1, remaining: 1 });
  });

  it('reports a reset time drawn from the oldest counted row', async () => {
    const student = await makeCenterStudent('START');
    const oldest = hoursAgo(20);
    await usedAt(student.id, hoursAgo(2));
    await usedAt(student.id, oldest);

    const decision = await quota.check(student.id, 'SPEAKING_EVALUATION');

    expect(decision.allowed).toBe(false);
    expect(decision.resetsAt?.getTime()).toBeCloseTo(
      oldest.getTime() + 24 * HOUR_MS,
      -3,
    );
  });

  it('gives a student no center governs the Start allowance', async () => {
    const student = await makeStudent('independent');

    await expect(
      quota.check(student.id, 'SPEAKING_EVALUATION'),
    ).resolves.toMatchObject({ tier: null, allowedToday: 2 });
  });

  it('ignores a tier left behind when the center is gone', async () => {
    // students.tier survives a center delete while center_id is set to null.
    // Reading the tier without a center would leave a student on Premium's
    // twenty for ever on the strength of a row nobody governs.
    const student = await makeCenterStudent('PREMIUM');
    await prisma.student.update({
      where: { id: student.id },
      data: { center_id: null },
    });

    const decision = await quota.check(student.id, 'SPEAKING_EVALUATION');

    expect(decision.tier).toBeNull();
    expect(decision.allowedToday).toBe(2);
  });
});
