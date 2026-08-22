/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
/**
 * The Checkpoint B walkthrough, over HTTP: register, verify, log in, refresh,
 * read and update the profile, log out, and confirm the session is dead.
 *
 * Prisma and the mailer are doubled so this runs without infrastructure; the
 * database-backed proofs live in `center-session-integration.spec.ts`. What
 * this suite is for is the wire contract — status codes, response shapes, and
 * that the pieces actually compose into one flow.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { CenterAuthController } from '../src/modules/centers/center-auth.controller';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';
import { CenterProfileController } from '../src/modules/centers/center-profile.controller';
import { CenterProfileService } from '../src/modules/centers/center-profile.service';
import { CentersService } from '../src/modules/centers/centers.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { EmailService } from '../src/modules/auth/email.service';
import { TokenCryptoService } from '../src/modules/auth/token-crypto.service';
import { TokenService } from '../src/modules/auth/token.service';
import { PrismaService } from '../src/shared/services/prisma.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { ValkeyService } from '../src/shared/services/valkey.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

process.env.JWT_ACCESS_SECRET ??= 'e2e-center-access-secret-'.padEnd(64, 'a');
process.env.JWT_REFRESH_SECRET ??= 'e2e-center-refresh-secret-'.padEnd(64, 'b');
process.env.TOKEN_HMAC_SECRET ??= 'e2e-center-hmac-secret-'.padEnd(64, 'c');

// bcryptjs is pure JS, and these flows do several cost-12 hashes each.
jest.setTimeout(60_000);

/** Minimal in-memory stand-in for the three center tables. */
class FakeDb {
  centers = new Map<string, any>();
  users = new Map<string, any>();
  sessions = new Map<string, any>();
  private seq = 0;

  id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
  usersList() {
    return [...this.users.values()];
  }
  sessionsList() {
    return [...this.sessions.values()];
  }
  withCenter(user: any) {
    return user && { ...user, center: this.centers.get(user.center_id) };
  }
}

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]) => {
    if (value === null) return row[key] === null;
    if (value && typeof value === 'object' && 'gt' in (value as any)) {
      return row[key] && row[key] > (value as any).gt;
    }
    return row[key] === value;
  });
}

function buildPrisma(db: FakeDb) {
  return {
    center: {
      create: ({ data }: any) => {
        const row = { id: db.id('center'), logo_url: null, ...data };
        db.centers.set(row.id, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: any) => {
        const row = { ...db.centers.get(where.id), ...data };
        db.centers.set(where.id, row);
        return Promise.resolve(row);
      },
    },
    centerUser: {
      create: ({ data }: any) => {
        const row = {
          id: db.id('owner'),
          password_reset_token: null,
          password_reset_expires: null,
          last_seen_at: new Date(),
          ...data,
        };
        db.users.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: any) =>
        Promise.resolve(
          db.withCenter(db.usersList().find((u) => matches(u, where))) ?? null,
        ),
      findFirst: ({ where }: any) =>
        Promise.resolve(
          db.withCenter(db.usersList().find((u) => matches(u, where))) ?? null,
        ),
      update: ({ where, data }: any) => {
        const row = { ...db.users.get(where.id), ...data };
        db.users.set(where.id, row);
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: any) => {
        const hits = db.usersList().filter((u) => matches(u, where));
        hits.forEach((u) => db.users.set(u.id, { ...u, ...data }));
        return Promise.resolve({ count: hits.length });
      },
    },
    centerDeviceSession: {
      create: ({ data }: any) => {
        const row = { revoked_at: null, device_name: null, ...data };
        db.sessions.set(row.id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: any) => {
        const key = where.center_user_id_device_id ?? where;
        return Promise.resolve(
          db.sessionsList().find((s) => matches(s, key)) ?? null,
        );
      },
      findFirst: ({ where }: any) =>
        Promise.resolve(
          db.sessionsList().find((s) => matches(s, where)) ?? null,
        ),
      findMany: ({ where }: any) =>
        Promise.resolve(db.sessionsList().filter((s) => matches(s, where))),
      count: ({ where }: any) =>
        Promise.resolve(
          db.sessionsList().filter((s) => matches(s, where)).length,
        ),
      delete: ({ where }: any) => {
        db.sessions.delete(where.id);
        return Promise.resolve({});
      },
      update: ({ where, data }: any) => {
        const row = { ...db.sessions.get(where.id), ...data };
        db.sessions.set(where.id, row);
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }: any) => {
        const hits = db.sessionsList().filter((s) => matches(s, where));
        hits.forEach((s) => db.sessions.set(s.id, { ...s, ...data }));
        return Promise.resolve({ count: hits.length });
      },
    },
    $transaction: (arg: any) =>
      typeof arg === 'function'
        ? arg(buildPrisma(db))
        : Promise.all(arg as unknown[]),
  };
}

describe('center identity end to end', () => {
  let app: INestApplication<App>;
  let db: FakeDb;
  let mailer: { [k: string]: jest.Mock };

  const registration = {
    centerName: 'Goethe Language Center',
    country: 'Cameroon',
    city: 'Douala',
    managerFirstName: 'Alain',
    managerLastName: 'Ngeukeu',
    email: 'owner@example.com',
    phone: '+237690000000',
    password: 'a-strong-password',
  };
  const DEVICE = 'browser-installation-1';

  beforeEach(async () => {
    db = new FakeDb();
    mailer = {
      sendCenterVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendExistingCenterVerificationEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendCenterPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterAuthController, CenterProfileController],
      providers: [
        CentersService,
        CenterAuthService,
        CenterProfileService,
        CenterAuthGuard,
        TokenService,
        TokenCryptoService,
        { provide: PrismaService, useValue: buildPrisma(db) },
        { provide: EmailService, useValue: mailer },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (k: string) => process.env[k] as string },
        },
        {
          provide: ValkeyService,
          useValue: {
            isSessionRevoked: async () => null,
            revokeSession: async () => true,
          },
        },
        {
          // Explicit stub, not a Proxy: a Proxy that answers every property
          // with a function also answers `then`, which makes it a thenable
          // that Nest awaits forever during provider instantiation.
          provide: RateLimitService,
          useValue: {
            checkCenterRegisterLimit: () => undefined,
            checkCenterVerifyEmailLimit: () => undefined,
            checkCenterLoginLimit: () => undefined,
            checkCenterForgotPasswordLimit: () => undefined,
            checkCenterResetPasswordLimit: () => undefined,
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('carries one center from registration through to a dead session', async () => {
    // 1. Register — generic response, nothing leaked.
    await http()
      .post('/api/center-auth/register')
      .send(registration)
      .expect(201)
      .expect({ message: 'verification email sent' });

    const rawVerificationToken =
      mailer.sendCenterVerificationEmail.mock.calls[0][1];
    expect(db.usersList()[0].email_verified).toBe(false);

    // 2. Login is refused until the address is verified.
    await http()
      .post('/api/center-auth/login')
      .send({
        email: registration.email,
        password: registration.password,
        deviceId: DEVICE,
      })
      .expect(403);

    // 3. Verify — returns a usable session immediately.
    const verified = await http()
      .post('/api/center-auth/verify-email')
      .send({ token: rawVerificationToken, deviceId: DEVICE })
      .expect(201);
    expect(verified.body.centerUser.emailVerified).toBe(true);
    expect(verified.body.center.name).toBe(registration.centerName);

    // 4. The verification token is single use.
    await http()
      .post('/api/center-auth/verify-email')
      .send({ token: rawVerificationToken, deviceId: DEVICE })
      .expect(400);

    // 5. Log in normally.
    const login = await http()
      .post('/api/center-auth/login')
      .send({
        email: registration.email,
        password: registration.password,
        deviceId: DEVICE,
      })
      .expect(201);
    const { accessToken, refreshToken } = login.body;

    // 6. The protected profile is reachable with that access token.
    const profile = await http()
      .get('/api/centers/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(profile.body.centerUser.email).toBe(registration.email);
    expect(JSON.stringify(profile.body)).not.toContain('password');

    // 7. ...and not without one.
    await http().get('/api/centers/me').expect(401);

    // 8. Update allowlisted fields; reject an escalation attempt.
    const patched = await http()
      .patch('/api/centers/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ city: 'Yaounde', centerName: 'Goethe Douala' })
      .expect(200);
    expect(patched.body.center.city).toBe('Yaounde');
    expect(patched.body.center.name).toBe('Goethe Douala');

    await http()
      .patch('/api/centers/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'OWNER' })
      .expect(400);

    // 9. Refresh rotates the pair, and the old refresh token is spent.
    const refreshed = await http()
      .post('/api/center-auth/refresh')
      .send({ refreshToken })
      .expect(201);
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    // Regression guard. Refresh tokens are ~400-byte JWTs whose first 72 bytes
    // are identical for one session; hashing them with bcrypt (which truncates
    // at 72) made a spent token compare equal to its replacement, so rotation
    // silently stopped being single-use. This assertion is what caught it.
    await http()
      .post('/api/center-auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // 10. Logout kills the session, and the access token dies with it.
    await http()
      .post('/api/center-auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(201)
      .expect({ success: true });

    await http()
      .get('/api/centers/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('keeps only three devices and evicts the least recently used', async () => {
    await http()
      .post('/api/center-auth/register')
      .send(registration)
      .expect(201);
    const token = mailer.sendCenterVerificationEmail.mock.calls[0][1];
    await http()
      .post('/api/center-auth/verify-email')
      .send({ token, deviceId: 'device-1' })
      .expect(201);

    for (const deviceId of ['device-2', 'device-3', 'device-4']) {
      await http()
        .post('/api/center-auth/login')
        .send({
          email: registration.email,
          password: registration.password,
          deviceId,
        })
        .expect(201);
    }

    const active = db.sessionsList().filter((s) => s.revoked_at === null);
    expect(active).toHaveLength(3);
    expect(active.map((s) => s.device_id)).not.toContain('device-1');
  });

  it('resets a forgotten password and locks the other device out', async () => {
    await http()
      .post('/api/center-auth/register')
      .send(registration)
      .expect(201);
    const token = mailer.sendCenterVerificationEmail.mock.calls[0][1];
    const first = await http()
      .post('/api/center-auth/verify-email')
      .send({ token, deviceId: 'device-old' })
      .expect(201);

    await http()
      .post('/api/center-auth/forgot-password')
      .send({ email: registration.email })
      .expect(201);
    const code = mailer.sendCenterPasswordResetEmail.mock.calls[0][1];

    const reset = await http()
      .post('/api/center-auth/reset-password')
      .send({
        email: registration.email,
        code,
        newPassword: 'a-different-password',
        deviceId: 'device-new',
      })
      .expect(201);

    // The old device is locked out; the resetting device works.
    await http()
      .get('/api/centers/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(401);
    await http()
      .get('/api/centers/me')
      .set('Authorization', `Bearer ${reset.body.accessToken}`)
      .expect(200);

    // The new password works and the old one does not.
    await http()
      .post('/api/center-auth/login')
      .send({
        email: registration.email,
        password: registration.password,
        deviceId: 'device-new',
      })
      .expect(401);
    await http()
      .post('/api/center-auth/login')
      .send({
        email: registration.email,
        password: 'a-different-password',
        deviceId: 'device-new',
      })
      .expect(201);
  });

  it('answers identically for a known and an unknown forgot-password address', async () => {
    await http()
      .post('/api/center-auth/register')
      .send(registration)
      .expect(201);

    const known = await http()
      .post('/api/center-auth/forgot-password')
      .send({ email: registration.email })
      .expect(201);
    const unknown = await http()
      .post('/api/center-auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(201);

    expect(known.body).toEqual(unknown.body);
  });

  it('refuses a second registration for the same address without disclosing it', async () => {
    await http()
      .post('/api/center-auth/register')
      .send(registration)
      .expect(201);
    const before = db.usersList().length;

    await http()
      .post('/api/center-auth/register')
      .send({ ...registration, centerName: 'Impostor Center' })
      .expect(201)
      .expect({ message: 'verification email sent' });

    expect(db.usersList()).toHaveLength(before);
    expect(
      await bcrypt.compare(
        registration.password,
        db.usersList()[0].password_hash,
      ),
    ).toBe(true);
  });
});
