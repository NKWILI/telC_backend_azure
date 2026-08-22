/**
 * Everything the center session design rests on is a claim about Postgres:
 * that Serializable raises a retryable conflict, that `updateMany` with an
 * expected-hash predicate is an atomic compare-and-swap, and that a unique
 * violation rolls its whole transaction back. The unit suites prove we call
 * Prisma correctly against a mock; only this suite proves Postgres agrees.
 *
 * Runs against the disposable branch in `.env.test`, over the direct
 * (non-pooled) endpoint. See `jest-integration-setup.ts`.
 */
import { PrismaService } from '../src/shared/services/prisma.service';
import * as bcrypt from 'bcryptjs';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';
import { CentersService } from '../src/modules/centers/centers.service';
import { TokenService } from '../src/modules/auth/token.service';
import { TokenCryptoService } from '../src/modules/auth/token-crypto.service';

const prisma = new PrismaService();
const tokenService = new TokenService();
const tokenCrypto = new TokenCryptoService({
  getOrThrow: () => process.env.TOKEN_HMAC_SECRET as string,
} as never);

const emailService = {
  sendCenterVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExistingCenterVerificationEmail: jest.fn().mockResolvedValue(undefined),
};

const centerAuth = new CenterAuthService(prisma, tokenService, tokenCrypto);
const centers = new CentersService(prisma, tokenCrypto, emailService as never);

const PASSWORD = 'integration-password';

async function createVerifiedOwner(suffix: string) {
  const center = await prisma.center.create({
    data: { name: `Center ${suffix}`, country: 'Cameroon', city: 'Douala' },
  });
  return prisma.centerUser.create({
    data: {
      center_id: center.id,
      role: 'OWNER',
      first_name: 'Alain',
      last_name: 'Ngeukeu',
      email: `owner-${suffix}@integration.test`,
      phone: '+237690000000',
      password_hash: await bcrypt.hash(PASSWORD, 4),
      email_verified: true,
    },
    include: { center: true },
  });
}

async function wipeCenterData() {
  await prisma.centerDeviceSession.deleteMany({});
  await prisma.centerUser.deleteMany({});
  await prisma.center.deleteMany({});
}

describe('center sessions against real Postgres', () => {
  beforeEach(wipeCenterData);

  afterAll(async () => {
    await wipeCenterData();
    await prisma.$disconnect();
  });

  it('lets exactly one of two concurrent refresh-hash rotations win', async () => {
    const owner = await createVerifiedOwner('cas');
    const session = await prisma.centerDeviceSession.create({
      data: {
        center_user_id: owner.id,
        device_id: 'device-cas',
        refresh_token_hash: 'shared-current-hash',
      },
    });

    const [first, second] = await Promise.all([
      centerAuth.rotateDeviceSessionRefreshHash(
        owner.id,
        session.id,
        'shared-current-hash',
        'winner-hash',
      ),
      centerAuth.rotateDeviceSessionRefreshHash(
        owner.id,
        session.id,
        'shared-current-hash',
        'loser-hash',
      ),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);

    const stored = await prisma.centerDeviceSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(stored.refresh_token_hash).not.toBe('shared-current-hash');
  });

  it('keeps at most three sessions and evicts the least recently used', async () => {
    const owner = await createVerifiedOwner('evict');

    for (const deviceId of ['device-1', 'device-2', 'device-3']) {
      await centerAuth.login({
        email: owner.email,
        password: PASSWORD,
        deviceId,
      });
    }

    // Make device-1 unambiguously the least recently used.
    await prisma.centerDeviceSession.updateMany({
      where: { center_user_id: owner.id, device_id: 'device-1' },
      data: { last_used_at: new Date(Date.now() - 60 * 60 * 1000) },
    });

    await centerAuth.login({
      email: owner.email,
      password: PASSWORD,
      deviceId: 'device-4',
    });

    const remaining = await prisma.centerDeviceSession.findMany({
      where: { center_user_id: owner.id, revoked_at: null },
      select: { device_id: true },
    });

    expect(remaining).toHaveLength(3);
    expect(remaining.map((s) => s.device_id).sort()).toEqual([
      'device-2',
      'device-3',
      'device-4',
    ]);
  });

  it('survives concurrent logins for one owner under Serializable', async () => {
    const owner = await createVerifiedOwner('concurrent');

    const results = await Promise.allSettled([
      centerAuth.login({
        email: owner.email,
        password: PASSWORD,
        deviceId: 'c-1',
      }),
      centerAuth.login({
        email: owner.email,
        password: PASSWORD,
        deviceId: 'c-2',
      }),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    if (rejected.length > 0) {
      throw new Error(
        `concurrent logins failed: ${rejected
          .map((r) => String(r.reason))
          .join(' | ')}`,
      );
    }

    const sessions = await prisma.centerDeviceSession.findMany({
      where: { center_user_id: owner.id, revoked_at: null },
    });
    expect(sessions).toHaveLength(2);
  });

  it('rolls the center back when a concurrent registration loses the unique race', async () => {
    const registration = {
      centerName: 'Race Center',
      country: 'Cameroon',
      city: 'Douala',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'race@integration.test',
      phone: '+237690000000',
      password: PASSWORD,
    };

    const results = await Promise.allSettled([
      centers.register({ ...registration }),
      centers.register({ ...registration }),
    ]);

    expect(
      results.every(
        (r) => r.status === 'fulfilled' || String(r.reason).includes('EMAIL'),
      ),
    ).toBe(true);

    const users = await prisma.centerUser.findMany({
      where: { email: registration.email },
    });
    expect(users).toHaveLength(1);

    // The loser's Center must not survive as an orphan.
    const centerRows = await prisma.center.findMany({
      where: { name: 'Race Center' },
    });
    expect(centerRows).toHaveLength(1);
  });

  it('makes a revoked session invisible to the active-session predicate', async () => {
    const owner = await createVerifiedOwner('revoke');
    await centerAuth.login({
      email: owner.email,
      password: PASSWORD,
      deviceId: 'device-revoke',
    });
    const session = await prisma.centerDeviceSession.findFirstOrThrow({
      where: { center_user_id: owner.id },
    });

    await centerAuth.revokeDeviceSession(owner.id, session.id);

    const active = await prisma.centerDeviceSession.findFirst({
      where: { id: session.id, revoked_at: null },
    });
    expect(active).toBeNull();

    await expect(
      centerAuth.revokeDeviceSession(owner.id, session.id),
    ).rejects.toThrow('INVALID_SESSION');
  });
});
