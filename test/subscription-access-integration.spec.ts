/**
 * Whether a blocked student is actually refused is a claim about Postgres, not
 * about our mocks. The unit suites prove the guard calls Prisma correctly; only
 * this proves the row shape, the relation and the timestamps agree.
 *
 * The point being tested is that status is derived on read. No job runs here,
 * nothing is recalculated between the two halves of each test — a date moves,
 * and the very next request answers differently.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as bcrypt from 'bcryptjs';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../src/shared/services/prisma.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { StudentSubscriptionGuard } from '../src/shared/guards/student-subscription.guard';
import { CenterSubscriptionGuard } from '../src/modules/centers/guards/center-subscription.guard';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

const prisma = new PrismaService();
const policy = new SubscriptionPolicyService();
const entitlement = new StudentEntitlementService(prisma, policy);
const studentGuard = new StudentSubscriptionGuard(entitlement);
const centerGuard = new CenterSubscriptionGuard(prisma, policy);

/** Mirrors what JwtAuthGuard leaves on the request. */
const asStudent = (studentId: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ student: { studentId } }) }),
  }) as never;

const asCenter = (centerId: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ centerUser: { centerId } }) }),
  }) as never;

/** Deletes only what these tests create, like the sibling integration suites. */
async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@access.integration.test' } },
  });
  await prisma.centerSubscription.deleteMany({
    where: { center: { name: { startsWith: 'Access Test' } } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Access Test' } },
  });
}

async function makeCenter(subscription: Record<string, unknown>) {
  return prisma.center.create({
    data: {
      name: `Access Test ${Date.now()}-${Math.random()}`,
      country: 'Cameroon',
      city: 'Douala',
      subscription: { create: { plan: 'TRIAL', seats: 3, ...subscription } },
    },
  });
}

async function makeStudent(centerId: string | null) {
  return prisma.student.create({
    data: {
      email: `s-${Date.now()}-${Math.random()}@access.integration.test`,
      password_hash: await bcrypt.hash('x', 4),
      email_verified: true,
      center_id: centerId,
    },
  });
}

interface Guard {
  canActivate(context: never): Promise<boolean>;
}

/** Resolves true when admitted, or the thrown error when refused. */
const attempt = (context: never, guard: Guard): Promise<unknown> =>
  guard.canActivate(context).catch((e: unknown) => e);

describe('subscription access against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    // onModuleDestroy, not $disconnect: the latter releases Prisma's side of
    // the driver adapter but leaves the pg pool open, which keeps the process
    // alive and would hang a CI step rather than merely printing a warning.
    await prisma.onModuleDestroy();
  });

  it('lets a student learn during the trial, and refuses the moment it lapses', async () => {
    const center = await makeCenter({
      trial_started_at: daysFromNow(-10),
      trial_ends_at: daysFromNow(1),
    });
    const student = await makeStudent(center.id);

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );

    // The only thing that changes is a date. No job runs, no cache is cleared,
    // nothing recomputes a stored status — because there is no stored status.
    await prisma.centerSubscription.update({
      where: { center_id: center.id },
      data: { trial_ends_at: daysFromNow(-1) },
    });

    const refused = await attempt(asStudent(student.id), studentGuard);
    expect(refused).toBeInstanceOf(ForbiddenException);
    expect((refused as ForbiddenException).getResponse()).toMatchObject({
      message: 'SUBSCRIPTION_INACTIVE',
      subscriptionStatus: 'BLOCKED',
    });
  });

  it('keeps a student learning through the grace period', async () => {
    const center = await makeCenter({
      plan: 'PAID',
      paid_until: daysFromNow(-2),
    });
    const student = await makeStudent(center.id);

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );

    await expect(entitlement.forStudent(student.id)).resolves.toMatchObject({
      status: 'GRACE_PERIOD',
      studentsMayLearn: true,
    });
  });

  it('blocks on the very next request when paid_until moves backwards', async () => {
    const center = await makeCenter({
      plan: 'PAID',
      paid_until: daysFromNow(30),
    });
    const student = await makeStudent(center.id);

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );

    // Past the seven-day grace, so this is a block rather than a reprieve.
    await prisma.centerSubscription.update({
      where: { center_id: center.id },
      data: { paid_until: daysFromNow(-8) },
    });

    await expect(
      attempt(asStudent(student.id), studentGuard),
    ).resolves.toBeInstanceOf(ForbiddenException);
  });

  it('restores access the moment a center pays, with no reset in between', async () => {
    const center = await makeCenter({
      plan: 'PAID',
      paid_until: daysFromNow(-8),
    });
    const student = await makeStudent(center.id);

    expect(await attempt(asStudent(student.id), studentGuard)).toBeInstanceOf(
      ForbiddenException,
    );

    await prisma.centerSubscription.update({
      where: { center_id: center.id },
      data: { paid_until: daysFromNow(30) },
    });

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );
  });

  it('leaves a student with no center entirely alone', async () => {
    const student = await makeStudent(null);

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );

    await expect(entitlement.forStudent(student.id)).resolves.toMatchObject({
      status: 'NONE',
      studentsMayLearn: true,
    });
  });

  it('leaves a removed student learning, rather than stranding them', async () => {
    const center = await makeCenter({
      plan: 'PAID',
      paid_until: daysFromNow(-8),
    });
    const student = await makeStudent(center.id);

    expect(await attempt(asStudent(student.id), studentGuard)).toBeInstanceOf(
      ForbiddenException,
    );

    // What CenterStudentsService.remove does: unlink, never delete.
    await prisma.student.update({
      where: { id: student.id },
      data: { center_id: null },
    });

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );
  });

  describe('the center side', () => {
    it('lets a brand-new center provision before any trial has started', async () => {
      // TRIAL_PENDING against real rows: both timestamp columns null, exactly
      // as a freshly registered center is written.
      const center = await makeCenter({});

      const subscription = await prisma.centerSubscription.findUnique({
        where: { center_id: center.id },
      });
      expect(subscription!.trial_started_at).toBeNull();
      expect(subscription!.trial_ends_at).toBeNull();

      await expect(centerGuard.canActivate(asCenter(center.id))).resolves.toBe(
        true,
      );
    });

    it('stops a lapsed center provisioning', async () => {
      const center = await makeCenter({
        plan: 'PAID',
        paid_until: daysFromNow(-8),
      });

      const refused = await attempt(asCenter(center.id), centerGuard);

      expect(refused).toBeInstanceOf(ForbiddenException);
      // The status is asserted, not just the exception type. This guard also
      // throws ForbiddenException for a missing center and a missing
      // subscription row, so type alone would go green for the wrong reason.
      expect((refused as ForbiddenException).getResponse()).toMatchObject({
        message: 'SUBSCRIPTION_INACTIVE',
        subscriptionStatus: 'BLOCKED',
      });
    });

    it('agrees with the student side about the same center', async () => {
      // One row, two guards. If the relation or the select ever drift apart,
      // a center could be blocked from provisioning while its students still
      // learn, or the reverse.
      const center = await makeCenter({
        plan: 'PAID',
        paid_until: daysFromNow(-8),
      });
      const student = await makeStudent(center.id);

      const centerRefusal = await attempt(asCenter(center.id), centerGuard);
      const studentRefusal = await attempt(asStudent(student.id), studentGuard);

      // Same status from both sides, not merely a refusal from both. Matching
      // exception types would hide the two reading the same row differently.
      expect((centerRefusal as ForbiddenException).getResponse()).toMatchObject(
        { subscriptionStatus: 'BLOCKED' },
      );
      expect(
        (studentRefusal as ForbiddenException).getResponse(),
      ).toMatchObject({ subscriptionStatus: 'BLOCKED' });
    });
  });

  it('frees a student when their center row is deleted, per ON DELETE SET NULL', async () => {
    const center = await makeCenter({
      plan: 'PAID',
      paid_until: daysFromNow(30),
    });
    const student = await makeStudent(center.id);

    // The schema sets center_id to null on delete, so this is the removed-
    // student path rather than a dangling reference. Asserted because the
    // guard's fail-closed branch depends on which of the two Postgres does.
    await prisma.center.delete({ where: { id: center.id } });

    const reread = await prisma.student.findUnique({
      where: { id: student.id },
    });
    expect(reread!.center_id).toBeNull();

    await expect(studentGuard.canActivate(asStudent(student.id))).resolves.toBe(
      true,
    );
  });

  it('fails closed when a center exists but its subscription row does not', async () => {
    // The one branch the mocks assert but no integration case reached: the
    // student still belongs to a center, so something must govern them, and a
    // missing row is a data fault rather than permission. Postgres allows this
    // state — the relation is optional — so it is reachable in principle and
    // must not read as "no subscription, therefore no restriction".
    const center = await makeCenter({
      plan: 'PAID',
      paid_until: daysFromNow(30),
    });
    const student = await makeStudent(center.id);

    await prisma.centerSubscription.delete({
      where: { center_id: center.id },
    });

    const reread = await prisma.student.findUnique({
      where: { id: student.id },
    });
    expect(reread!.center_id).toBe(center.id);

    await expect(entitlement.forStudent(student.id)).resolves.toMatchObject({
      status: 'BLOCKED',
      studentsMayLearn: false,
    });

    const refused = await attempt(asStudent(student.id), studentGuard);
    expect(refused).toBeInstanceOf(ForbiddenException);
    expect((refused as ForbiddenException).getResponse()).toMatchObject({
      subscriptionStatus: 'BLOCKED',
    });
  });
});
