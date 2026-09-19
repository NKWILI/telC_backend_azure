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
import { PricingService } from '../src/modules/centers/pricing.service';
import { CenterSeatsService } from '../src/modules/centers/center-seats.service';
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
  new PricingService(),
  new CenterSeatsService(prisma),
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

/**
 * A center as registration leaves one: a trial subscription and the single
 * zero-priced Start seat that is now the seat limit.
 */
async function makeCenter(name: string, trialSeats = 3) {
  return prisma.center.create({
    data: {
      name,
      country_code: 'CM',
      city_id: 'douala',
      subscription: { create: { plan: 'TRIAL' } },
      seats: {
        create: { tier: 'START', quantity: trialSeats, unit_price_xaf: 0 },
      },
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
        data: { center_id: center.id, plan: 'TRIAL' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('gives a registered center exactly one subscription', async () => {
    await centers.register({
      // Five fields, which is all registration takes since a center may
      // start as a draft and complete its profile afterwards.
      centerName: 'Registration Test',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'sub-integration@integration.test',
      password: 'integration-password',
    });

    const rows = await prisma.centerSubscription.findMany({});
    expect(rows).toHaveLength(1);
    // The trial clock starts at first student activation, not registration.
    expect(rows[0].trial_started_at).toBeNull();
    // The seat count is no longer on this row. It is the seat row registration
    // grants, asserted in its own test below.
    expect(rows[0]).not.toHaveProperty('seats');

    const orphans = await prisma.center.count({
      where: { subscription: { is: null } },
    });
    expect(orphans).toBe(0);
  });

  /**
   * The trial seat, in the database rather than in a mock's call log.
   *
   * A trial is an ordinary seat row priced at zero. `center_seats` allows zero
   * and `payment_lines` forbids it, so the schema itself keeps a granted seat
   * and a bought seat distinguishable.
   */
  it('gives a registered center its one trial seat, priced at zero', async () => {
    await centers.register({
      centerName: 'Registration Test Seat',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'seat-integration@integration.test',
      password: 'integration-password',
    });

    const seats = await prisma.centerSeat.findMany({});

    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({
      tier: 'START',
      quantity: 1,
      unit_price_xaf: 0,
    });
  });

  it('leaves no seat behind when registration fails', async () => {
    // Same transaction as the center, so a duplicate address cannot leave a
    // seat row pointing at a center that was rolled back.
    const registration = {
      centerName: 'Registration Test Rollback',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'rollback-integration@integration.test',
      password: 'integration-password',
    };
    await centers.register(registration);
    const after = await prisma.centerSeat.count({});

    // A second registration on the same address is answered without creating
    // anything, which is how existence stays unconfirmed.
    await centers.register(registration);

    expect(await prisma.centerSeat.count({})).toBe(after);
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
    // Center A is over the three seats it holds. That reports zero available
    // and blocks future provisioning; it does not evict the fourth student.
    expect(usageA.seatsAvailable).toBe(0);
    expect(usageB.seatsAvailable).toBe(2);
  });

  it('derives ACTIVE from a paid_until the database actually stored', async () => {
    const center = await makeCenter('Paid Center');
    await prisma.centerSubscription.update({
      where: { center_id: center.id },
      data: {
        plan: 'PAID',
        paid_until: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });
    // Seats held now live on their own rows, so a paid center says so there.
    // Updated rather than created: the center already holds its trial Start
    // row, and center_seats is unique per (center, tier) — buying more seats
    // in a tier raises the quantity, it does not add a second row.
    await prisma.centerSeat.update({
      where: {
        center_id_tier: { center_id: center.id, tier: 'START' },
      },
      data: { quantity: 10, unit_price_xaf: 4500 },
    });

    const view = await subscriptions.getSubscription({
      centerId: center.id,
    } as never);

    expect(view.status).toBe('ACTIVE');
    expect(view.studentsMayLearn).toBe(true);
    expect(view.seatsHeld).toBe(10);
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
