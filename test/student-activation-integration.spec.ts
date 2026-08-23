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
const activation = new StudentActivationService(
  prisma,
  tokenCrypto,
  authService as never,
);
const students = new CenterStudentsService(prisma, tokenCrypto);

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@activation.test' } },
  });
  await prisma.student.updateMany({ data: { center_id: null } });
  await prisma.centerDeviceSession.deleteMany({});
  await prisma.centerSubscription.deleteMany({});
  await prisma.centerUser.deleteMany({});
  await prisma.center.deleteMany({});
}

async function makeCenter(name: string, seats = 3) {
  return prisma.center.create({
    data: {
      name,
      country: 'Cameroon',
      city: 'Douala',
      subscription: { create: { plan: 'TRIAL', seats } },
    },
  });
}

const identity = (centerId: string) => ({ centerId }) as never;

const input = (n: number) => ({
  firstName: 'Awa',
  lastName: `Number${n}`,
  email: `student-${n}-${Date.now()}@activation.test`,
  phone: '+237690000000',
});

describe('student provisioning and activation against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
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
