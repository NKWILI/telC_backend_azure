/**
 * Seat limits under concurrency and the once-only trial trigger are claims
 * about Postgres, not about our code. The unit suites prove we call Prisma
 * correctly against a mock, and a mock agrees with whatever it is told.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import { PrismaService } from '../src/shared/services/prisma.service';
import { CenterStudentsService } from '../src/modules/centers/center-students.service';
import { StudentActivationService } from '../src/modules/centers/student-activation.service';
import { StudentProvisioningService } from '../src/modules/centers/student-provisioning.service';
import { TokenCryptoService } from '../src/modules/auth/token-crypto.service';
import { StudentEntitlementService } from '../src/shared/services/student-entitlement.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

const prisma = new PrismaService();
const tokenCrypto = new TokenCryptoService({
  getOrThrow: () => process.env.TOKEN_HMAC_SECRET as string,
} as never);

const emailService = {
  sendStudentWelcomeEmail: jest.fn().mockResolvedValue(undefined),
};
const authService = {
  issueSessionForStudent: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
};

const provisioning = new StudentProvisioningService(
  prisma,
  tokenCrypto,
  emailService as never,
);
// The real entitlement service, against the real database. Passing nothing
// here left it undefined, and because activation reports the subscription on a
// best-effort path, the failure was swallowed into a warning on every run —
// noise that would have hidden a genuine one.
const activation = new StudentActivationService(
  prisma,
  tokenCrypto,
  authService as never,
  new StudentEntitlementService(prisma, new SubscriptionPolicyService()),
);
const students = new CenterStudentsService(prisma, tokenCrypto);

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@activation.test' } },
  });
  await prisma.student.updateMany({ data: { center_id: null } });
  await prisma.centerDeviceSession.deleteMany({});
  await prisma.centerSeat.deleteMany({});
  await prisma.centerSubscription.deleteMany({});
  await prisma.centerUser.deleteMany({});
  await prisma.center.deleteMany({});
}

/**
 * A center holding `seats` Start seats.
 *
 * The seat row is what provisioning checks now, not `subscription.seats` — a
 * seat belongs to a tier, so the limit has to as well. Both are set here so
 * the fixture stays coherent until `subscription.seats` is dropped.
 */
async function makeCenter(
  name: string,
  seats = 3,
  tier: 'START' | 'PRO' = 'START',
) {
  return prisma.center.create({
    data: {
      name,
      country: 'Cameroon',
      city: 'Douala',
      subscription: { create: { plan: 'TRIAL' } },
      seats: { create: { tier, quantity: seats, unit_price_xaf: 0 } },
    },
  });
}

const identity = (centerId: string) => ({ centerId }) as never;

const input = (n: number, tier: 'START' | 'PRO' | 'PREMIUM' = 'START') => ({
  firstName: 'Awa',
  lastName: `Number${n}`,
  email: `student-${n}-${Date.now()}@activation.test`,
  phone: '+237690000000',
  tier,
});

describe('student provisioning and activation against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    // Ends the pg pool too, so the process can exit. See PrismaService.
    await prisma.onModuleDestroy();
  });

  it('never lets two concurrent provisions exceed the last seat', async () => {
    const center = await makeCenter('Race Center', 3);
    await provisioning.provision(identity(center.id), input(1));
    await provisioning.provision(identity(center.id), input(2));

    // Two administrators reach for the third and final seat at once.
    const results = await Promise.allSettled([
      provisioning.provision(identity(center.id), input(3)),
      provisioning.provision(identity(center.id), input(4)),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const seatsUsed = await prisma.student.count({
      where: { center_id: center.id },
    });
    expect(seatsUsed).toBe(3);
  });

  it('refuses the next provision once every seat is taken', async () => {
    const center = await makeCenter('Full Center', 2);
    await provisioning.provision(identity(center.id), input(1));
    await provisioning.provision(identity(center.id), input(2));

    await expect(
      provisioning.provision(identity(center.id), input(3)),
    ).rejects.toThrow('SEAT_LIMIT_REACHED');
  });

  /**
   * A seat belongs to a tier, and only the database can prove the counting is
   * really scoped: a mock returns whatever count it was told to.
   */
  describe('the seat limit is per tier', () => {
    it('refuses a full tier while another tier sits empty', async () => {
      const center = await prisma.center.create({
        data: {
          name: 'Mixed Center',
          country: 'Cameroon',
          city: 'Douala',
          subscription: { create: { plan: 'TRIAL' } },
          seats: {
            create: [
              { tier: 'START', quantity: 1, unit_price_xaf: 4500 },
              { tier: 'PRO', quantity: 5, unit_price_xaf: 10000 },
            ],
          },
        },
      });

      await provisioning.provision(identity(center.id), input(1, 'START'));

      // Start is full at one. Five free Pro seats do not help a Start student.
      await expect(
        provisioning.provision(identity(center.id), input(2, 'START')),
      ).rejects.toThrow('SEAT_LIMIT_REACHED');

      // And the same center takes a Pro student without complaint.
      await expect(
        provisioning.provision(identity(center.id), input(3, 'PRO')),
      ).resolves.toBeDefined();
    });

    it('refuses a tier the center holds no seats in', async () => {
      const center = await makeCenter('Start Only Center', 2);

      await expect(
        provisioning.provision(identity(center.id), input(1, 'PREMIUM')),
      ).rejects.toThrow('TIER_NOT_HELD');

      expect(
        await prisma.student.count({ where: { center_id: center.id } }),
      ).toBe(0);
    });

    it('stamps the tier on the student row', async () => {
      const center = await makeCenter('Tier Stamp Center', 2);

      const student = await provisioning.provision(
        identity(center.id),
        input(1, 'START'),
      );

      const row = await prisma.student.findUniqueOrThrow({
        where: { id: student.id },
        select: { tier: true, center_id: true },
      });
      expect(row.tier).toBe('START');
      expect(row.center_id).toBe(center.id);
    });

    it('never lets two concurrent provisions exceed one tier last seat', async () => {
      // The Serializable transaction, re-proven per tier. Both read the same
      // free seat; exactly one may win.
      const center = await makeCenter('Tier Race Center', 1);

      const results = await Promise.allSettled([
        provisioning.provision(identity(center.id), input(1, 'START')),
        provisioning.provision(identity(center.id), input(2, 'START')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.student.count({
          where: { center_id: center.id, tier: 'START' },
        }),
      ).toBe(1);
    });
  });

  /**
   * Moving a student between tiers, against the rows.
   *
   * The seat limit and the concurrency guarantee are both claims about the
   * database: a mock returns whatever count it was told to, and cannot race.
   */
  describe('moving a student between tiers', () => {
    const mixedCenter = (name: string, start: number, pro: number) =>
      prisma.center.create({
        data: {
          name,
          country: 'Cameroon',
          city: 'Douala',
          subscription: { create: { plan: 'TRIAL' } },
          seats: {
            create: [
              { tier: 'START', quantity: start, unit_price_xaf: 4500 },
              { tier: 'PRO', quantity: pro, unit_price_xaf: 10000 },
            ],
          },
        },
      });

    it('moves a Start student into a free Pro seat', async () => {
      const center = await mixedCenter('Move Center', 2, 1);
      const student = await provisioning.provision(
        identity(center.id),
        input(1, 'START'),
      );

      const view = await students.update(identity(center.id), student.id, {
        tier: 'PRO',
      });

      expect(view.tier).toBe('PRO');
      // The Start seat is released by the same write, so the tier the student
      // left has room again.
      expect(
        await prisma.student.count({
          where: { center_id: center.id, tier: 'START' },
        }),
      ).toBe(0);
    });

    it('refuses a move into a full tier and leaves the student where they are', async () => {
      const center = await mixedCenter('Full Pro Center', 2, 1);
      const staying = await provisioning.provision(
        identity(center.id),
        input(1, 'PRO'),
      );
      const moving = await provisioning.provision(
        identity(center.id),
        input(2, 'START'),
      );

      await expect(
        students.update(identity(center.id), moving.id, { tier: 'PRO' }),
      ).rejects.toThrow('SEAT_LIMIT_REACHED');

      const row = await prisma.student.findUniqueOrThrow({
        where: { id: moving.id },
        select: { tier: true },
      });
      expect(row.tier).toBe('START');
      expect(staying.id).toBeDefined();
    });

    it('refuses a move into a tier the center holds no seats in', async () => {
      const center = await mixedCenter('No Premium Center', 2, 1);
      const student = await provisioning.provision(
        identity(center.id),
        input(1, 'START'),
      );

      await expect(
        students.update(identity(center.id), student.id, { tier: 'PREMIUM' }),
      ).rejects.toThrow('TIER_NOT_HELD');
    });

    it('lets a student be sent to the tier they already hold', async () => {
      // A client re-sending the value it already has must not be refused just
      // because the tier is exactly full.
      const center = await mixedCenter('Idempotent Move Center', 2, 1);
      const student = await provisioning.provision(
        identity(center.id),
        input(1, 'PRO'),
      );

      const view = await students.update(identity(center.id), student.id, {
        tier: 'PRO',
      });

      expect(view.tier).toBe('PRO');
    });

    it('never lets two concurrent moves share one free seat', async () => {
      const center = await mixedCenter('Race Move Center', 2, 1);
      const a = await provisioning.provision(
        identity(center.id),
        input(1, 'START'),
      );
      const b = await provisioning.provision(
        identity(center.id),
        input(2, 'START'),
      );

      const results = await Promise.allSettled([
        students.update(identity(center.id), a.id, { tier: 'PRO' }),
        students.update(identity(center.id), b.id, { tier: 'PRO' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.student.count({
          where: { center_id: center.id, tier: 'PRO' },
        }),
      ).toBe(1);
    });

    it('refuses to move another center student', async () => {
      const mine = await mixedCenter('Mine Center', 2, 1);
      const theirs = await mixedCenter('Theirs Center', 2, 1);
      const student = await provisioning.provision(
        identity(theirs.id),
        input(1, 'START'),
      );

      // 404, and before any seat is inspected: a seat answer would confirm
      // the id exists.
      await expect(
        students.update(identity(mine.id), student.id, { tier: 'PRO' }),
      ).rejects.toThrow('STUDENT_NOT_FOUND');
    });
  });

  it('starts the trial exactly once, on the first activation', async () => {
    const center = await makeCenter('Trial Center', 3);
    const first = await provisioning.provision(identity(center.id), input(1));
    const second = await provisioning.provision(identity(center.id), input(2));

    await activation.activate({
      key: first.activationKey,
      password: 'a-strong-password',
      deviceId: 'device-1',
      ip: '1.1.1.1',
    });

    const afterFirst = await prisma.centerSubscription.findUniqueOrThrow({
      where: { center_id: center.id },
    });
    expect(afterFirst.trial_started_at).not.toBeNull();
    expect(afterFirst.trial_ends_at).not.toBeNull();

    await activation.activate({
      key: second.activationKey,
      password: 'a-strong-password',
      deviceId: 'device-2',
      ip: '2.2.2.2',
    });

    const afterSecond = await prisma.centerSubscription.findUniqueOrThrow({
      where: { center_id: center.id },
    });
    // The second student must not buy the center another thirty days.
    expect(afterSecond.trial_started_at).toEqual(afterFirst.trial_started_at);
    expect(afterSecond.trial_ends_at).toEqual(afterFirst.trial_ends_at);
  });

  it('lets only one of two concurrent redemptions of one key win', async () => {
    const center = await makeCenter('Replay Center', 3);
    const student = await provisioning.provision(identity(center.id), input(1));

    const results = await Promise.allSettled([
      activation.activate({
        key: student.activationKey,
        password: 'a-strong-password',
        deviceId: 'device-a',
        ip: '1.1.1.1',
      }),
      activation.activate({
        key: student.activationKey,
        password: 'a-different-password',
        deviceId: 'device-b',
        ip: '2.2.2.2',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('spends the key, so a later replay fails', async () => {
    const center = await makeCenter('Spent Center', 3);
    const student = await provisioning.provision(identity(center.id), input(1));

    await activation.activate({
      key: student.activationKey,
      password: 'a-strong-password',
      deviceId: 'device-1',
      ip: '1.1.1.1',
    });

    await expect(
      activation.activate({
        key: student.activationKey,
        password: 'another-password',
        deviceId: 'device-2',
        ip: '1.1.1.1',
      }),
    ).rejects.toThrow('ACTIVATION_KEY_INVALID');
  });

  it('gives the student a password the center never chose', async () => {
    const center = await makeCenter('Password Center', 3);
    const student = await provisioning.provision(identity(center.id), input(1));

    const before = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
    });
    expect(before.password_hash).toBeNull();

    await activation.activate({
      key: student.activationKey,
      password: 'a-strong-password',
      deviceId: 'device-1',
      ip: '9.9.9.9',
    });

    const after = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
    });
    expect(after.password_hash).not.toBeNull();
    expect(after.activation_key_hash).toBeNull();
    expect(after.activated_ip).toBe('9.9.9.9');
  });

  it('frees a seat on removal without destroying the account', async () => {
    const center = await makeCenter('Removal Center', 2);
    const student = await provisioning.provision(identity(center.id), input(1));
    await activation.activate({
      key: student.activationKey,
      password: 'a-strong-password',
      deviceId: 'device-1',
      ip: '1.1.1.1',
    });

    await students.remove(identity(center.id), student.id);

    expect(
      await prisma.student.count({ where: { center_id: center.id } }),
    ).toBe(0);

    // The person keeps their account, their password and their history.
    const survivor = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
    });
    expect(survivor.center_id).toBeNull();
    expect(survivor.password_hash).not.toBeNull();
    expect(survivor.activated_at).not.toBeNull();

    // And the seat is immediately usable again.
    await expect(
      provisioning.provision(identity(center.id), input(2)),
    ).resolves.toBeDefined();
  });

  it('cannot re-key a student who has already activated', async () => {
    const center = await makeCenter('Rekey Center', 3);
    const student = await provisioning.provision(identity(center.id), input(1));
    await activation.activate({
      key: student.activationKey,
      password: 'a-strong-password',
      deviceId: 'device-1',
      ip: '1.1.1.1',
    });

    // Re-keying a live account would let the center redeem it and take it.
    await expect(
      students.issueActivationKey(identity(center.id), student.id),
    ).rejects.toThrow('STUDENT_NOT_FOUND_OR_ALREADY_ACTIVE');
  });

  it('keeps one center students invisible to another', async () => {
    const a = await makeCenter('Center A', 3);
    const b = await makeCenter('Center B', 3);
    const theirs = await provisioning.provision(identity(a.id), input(1));

    await expect(students.get(identity(b.id), theirs.id)).rejects.toThrow(
      'STUDENT_NOT_FOUND',
    );

    const listB = await students.list(identity(b.id), {
      page: 1,
      pageSize: 20,
    });
    expect(listB.total).toBe(0);
  });
});
