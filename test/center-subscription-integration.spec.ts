/**
 * Seat counting and the one-subscription-per-center rule are claims about
 * Postgres. The unit suites prove we call Prisma correctly against a mock;
 * only this proves the database agrees.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/shared/services/prisma.service';
import { CenterSubscriptionService } from '../src/modules/centers/center-subscription.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { CentersService } from '../src/modules/centers/centers.service';
import { TokenCryptoService } from '../src/modules/auth/token-crypto.service';

const prisma = new PrismaService();
const tokenCrypto = new TokenCryptoService({
  getOrThrow: () => process.env.TOKEN_HMAC_SECRET as string,
} as never);
const emailService = {
  sendCenterVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExistingCenterVerificationEmail: jest.fn().mockResolvedValue(undefined),
};
const centers = new CentersService(prisma, tokenCrypto, emailService as never);
const subscriptions = new CenterSubscriptionService(
  prisma,
  new SubscriptionPolicyService(),
);

/**
 * Deletes only what these tests create. Students are matched by the
 * `@integration.test` domain rather than truncated, so a run cannot remove
 * anything that happens to be sitting in the scratch database.
 */
async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@integration.test' } },
  });
  await prisma.student.updateMany({ data: { center_id: null } });
  await prisma.centerDeviceSession.deleteMany({});
  await prisma.centerSubscription.deleteMany({});
  await prisma.centerUser.deleteMany({});
  await prisma.center.deleteMany({});
}

async function makeCenter(name: string) {
  return prisma.center.create({
    data: {
      name,
      country: 'Cameroon',
      city: 'Douala',
      subscription: { create: { plan: 'TRIAL', seats: 3 } },
    },
    include: { subscription: true },
  });
}

describe('center subscriptions against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    // Ends the pg pool too, so the process can exit. See PrismaService.
    await prisma.onModuleDestroy();
  });

  it('refuses a second subscription for the same center', async () => {
    const center = await makeCenter('Duplicate Test');

    await expect(
      prisma.centerSubscription.create({
        data: { center_id: center.id, plan: 'TRIAL', seats: 3 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('gives a registered center exactly one subscription', async () => {
    await centers.register({
      centerName: 'Registration Test',
      country: 'Cameroon',
      city: 'Douala',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'sub-integration@integration.test',
      phone: '+237690000000',
      password: 'integration-password',
    });

    const rows = await prisma.centerSubscription.findMany({});
    expect(rows).toHaveLength(1);
    // The trial clock starts at first student activation, not registration.
    expect(rows[0].trial_started_at).toBeNull();
    expect(rows[0].seats).toBe(3);

    const orphans = await prisma.center.count({
      where: { subscription: { is: null } },
    });
    expect(orphans).toBe(0);
  });

  it('counts seats per center, never across them', async () => {
    const a = await makeCenter('Center A');
    const b = await makeCenter('Center B');

    for (let i = 0; i < 4; i++) {
      await prisma.student.create({
        data: {
          email: `a${i}@integration.test`,
          password_hash: await bcrypt.hash('x', 4),
          center_id: a.id,
        },
      });
    }
    await prisma.student.create({
      data: {
        email: 'b0@integration.test',
        password_hash: await bcrypt.hash('x', 4),
        center_id: b.id,
      },
    });

    const usageA = await subscriptions.getUsage({ centerId: a.id } as never);
    const usageB = await subscriptions.getUsage({ centerId: b.id } as never);

    expect(usageA.seatsUsed).toBe(4);
    expect(usageB.seatsUsed).toBe(1);
    // Center A is over its 3-seat trial limit. That reports zero available and
    // blocks future provisioning; it does not evict the fourth student.
    expect(usageA.seatsAvailable).toBe(0);
    expect(usageB.seatsAvailable).toBe(2);
  });

  it('derives ACTIVE from a paid_until the database actually stored', async () => {
    const center = await makeCenter('Paid Center');
    await prisma.centerSubscription.update({
      where: { center_id: center.id },
      data: {
        plan: 'PAID',
        seats: 10,
        paid_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });

    const view = await subscriptions.getSubscription({
      centerId: center.id,
    } as never);

    expect(view.status).toBe('ACTIVE');
    expect(view.studentsMayLearn).toBe(true);
    expect(view.seats).toBe(10);
    expect(view.graceEndsAt).not.toBeNull();
  });

  it('removes the subscription with its center, but never the students', async () => {
    const center = await makeCenter('Doomed Center');
    const student = await prisma.student.create({
      data: {
        email: 'survivor@integration.test',
        password_hash: await bcrypt.hash('x', 4),
        center_id: center.id,
      },
    });

    await prisma.center.delete({ where: { id: center.id } });

    expect(
      await prisma.centerSubscription.count({
        where: { center_id: center.id },
      }),
    ).toBe(0);

    // ON DELETE SET NULL: a person keeps their account and their history even
    // when the school that provisioned them is gone.
    const survivor = await prisma.student.findUnique({
      where: { id: student.id },
    });
    expect(survivor).not.toBeNull();
    expect(survivor?.center_id).toBeNull();
  });
});
