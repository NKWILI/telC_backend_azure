/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';

jest.mock('bcryptjs', () => {
  const actual = jest.requireActual('bcryptjs');
  return {
    ...actual,
    compare: jest.fn((value: string, hash: string) =>
      actual.compare(value, hash),
    ),
  };
});

describe('CenterAuthService', () => {
  const center = {
    id: 'center-1',
    name: 'Goethe Language Center',
    country: 'Cameroon',
    city: 'Douala',
    logo_url: 'https://cdn.example.com/center.webp',
  };
  const verifiedOwner = {
    id: 'owner-1',
    center_id: center.id,
    role: 'OWNER',
    first_name: 'Alain',
    last_name: 'Ngeukeu',
    email: 'manager@example.com',
    phone: '+237690000000',
    password_hash: bcrypt.hashSync('correct-password', 4),
    email_verified: true,
    email_verification_expires: null,
    center,
  };

  let prisma: any;
  let tx: any;
  let tokenService: any;
  let tokenCrypto: any;
  let valkeyService: any;
  let service: CenterAuthService;

  beforeEach(() => {
    tx = {
      centerUser: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      centerDeviceSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockImplementation(({ data }) => data),
        update: jest.fn().mockImplementation(({ data }) => data),
      },
    };
    prisma = {
      centerUser: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      centerDeviceSession: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: (client: any) => unknown) =>
        callback(tx),
      ),
      get deviceSession(): never {
        throw new Error('Student DeviceSession must never be accessed');
      },
      get student(): never {
        throw new Error('Student must never be accessed');
      },
    };
    tokenService = {
      generateCenterTokenPair: jest.fn().mockReturnValue({
        accessToken: 'center-access-token',
        refreshToken: 'center-refresh-token',
      }),
      hashRefreshToken: jest.fn().mockResolvedValue('refresh-token-hash'),
      verifyCenterRefreshToken: jest.fn().mockReturnValue({
        type: 'refresh',
        actorType: 'CENTER_USER',
        centerUserId: 'owner-1',
        centerId: 'center-1',
        deviceId: 'browser-1',
        sessionId: 'center-session-1',
      }),
      compareRefreshToken: jest.fn().mockResolvedValue(true),
    };
    tokenCrypto = {
      hashToken: jest.fn().mockReturnValue('verification-token-hash'),
    };
    valkeyService = {
      revokeSession: jest.fn().mockResolvedValue(true),
    };
    service = new CenterAuthService(
      prisma,
      tokenService,
      tokenCrypto,
      valkeyService,
    );
  });

  describe('verifyEmail', () => {
    it('atomically consumes a valid token and returns a center session', async () => {
      prisma.centerUser.findFirst.mockResolvedValue({
        ...verifiedOwner,
        email_verified: false,
        email_verification_expires: new Date(Date.now() + 60_000),
      });

      const result = await service.verifyEmail({
        token: 'raw-verification-token',
        deviceId: 'browser-1',
        deviceName: 'Chrome',
      });

      expect(tokenCrypto.hashToken).toHaveBeenCalledWith(
        'raw-verification-token',
      );
      expect(prisma.centerUser.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'owner-1',
          email_verified: false,
          email_verification_token: 'verification-token-hash',
          email_verification_expires: { gt: expect.any(Date) },
        },
        data: {
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
        },
      });
      expect(tokenService.generateCenterTokenPair).toHaveBeenCalledWith({
        centerUserId: 'owner-1',
        centerId: 'center-1',
        deviceId: 'browser-1',
        sessionId: expect.any(String),
      });
      expect(prisma.centerUser.update).toHaveBeenCalledWith({
        where: { id: 'owner-1' },
        data: { last_seen_at: expect.any(Date) },
      });
      expect(result).toEqual({
        accessToken: 'center-access-token',
        refreshToken: 'center-refresh-token',
        centerUser: {
          id: 'owner-1',
          role: 'OWNER',
          firstName: 'Alain',
          lastName: 'Ngeukeu',
          email: 'manager@example.com',
          phone: '+237690000000',
          emailVerified: true,
        },
        center: {
          id: 'center-1',
          name: 'Goethe Language Center',
          country: 'Cameroon',
          city: 'Douala',
          logoUrl: 'https://cdn.example.com/center.webp',
        },
      });
    });

    it('rejects an expired verification token without creating a session', async () => {
      prisma.centerUser.findFirst.mockResolvedValue({
        ...verifiedOwner,
        email_verified: false,
        email_verification_expires: new Date(Date.now() - 1),
      });

      await expect(
        service.verifyEmail({
          token: 'expired-token',
          deviceId: 'browser-1',
        }),
      ).rejects.toThrow('VERIFICATION_TOKEN_EXPIRED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an empty device ID before consuming the token', async () => {
      await expect(
        service.verifyEmail({
          token: 'valid-token',
          deviceId: '   ',
        }),
      ).rejects.toThrow('DEVICE_ID_REQUIRED');
      expect(tokenCrypto.hashToken).not.toHaveBeenCalled();
      expect(prisma.centerUser.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a token lost to a concurrent verification request', async () => {
      prisma.centerUser.findFirst.mockResolvedValue({
        ...verifiedOwner,
        email_verified: false,
        email_verification_expires: new Date(Date.now() + 60_000),
      });
      prisma.centerUser.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyEmail({
          token: 'already-consumed-token',
          deviceId: 'browser-1',
        }),
      ).rejects.toThrow('VERIFICATION_TOKEN_INVALID');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('normalizes email and returns the same auth response', async () => {
      prisma.centerUser.findUnique.mockResolvedValue(verifiedOwner);

      const result = await service.login({
        email: ' Manager@Example.COM ',
        password: 'correct-password',
        deviceId: ' phone-1 ',
        deviceName: 'Android',
      });

      expect(prisma.centerUser.findUnique).toHaveBeenCalledWith({
        where: { email: 'manager@example.com' },
        include: { center: true },
      });
      expect(result.accessToken).toBe('center-access-token');
      expect(result.centerUser.email).toBe('manager@example.com');
      expect(result.center.id).toBe('center-1');
      expect(tokenService.generateCenterTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'phone-1' }),
      );
    });

    it('runs bcrypt comparison for an unknown email to resist timing enumeration', async () => {
      prisma.centerUser.findUnique.mockResolvedValue(null);
      const compareMock = bcrypt.compare as jest.MockedFunction<
        typeof bcrypt.compare
      >;
      compareMock.mockClear();

      await expect(
        service.login({
          email: 'unknown@example.com',
          password: 'any-password',
          deviceId: 'browser-1',
        }),
      ).rejects.toThrow('INVALID_CREDENTIALS');

      expect(compareMock).toHaveBeenCalledWith(
        'any-password',
        expect.stringMatching(/^\$2[aby]\$12\$/),
      );
    });

    it.each([
      ['unknown email', null, 'any-password'],
      ['wrong password', verifiedOwner, 'a-password-that-does-not-match'],
    ])('returns one generic error for %s', async (_case, user, password) => {
      prisma.centerUser.findUnique.mockResolvedValue(user);

      await expect(
        service.login({
          email: 'manager@example.com',
          password,
          deviceId: 'browser-1',
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<UnauthorizedException>>({
          message: 'INVALID_CREDENTIALS',
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks an owner whose email is not verified', async () => {
      prisma.centerUser.findUnique.mockResolvedValue({
        ...verifiedOwner,
        email_verified: false,
      });

      await expect(
        service.login({
          email: 'manager@example.com',
          password: 'correct-password',
          deviceId: 'browser-1',
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<ForbiddenException>>({
          message: 'EMAIL_NOT_VERIFIED',
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('center device sessions', () => {
    beforeEach(() => {
      prisma.centerUser.findUnique.mockResolvedValue(verifiedOwner);
    });

    it('rotates the stored refresh hash for the same active device', async () => {
      tx.centerDeviceSession.findUnique.mockResolvedValue({
        id: 'existing-center-session',
        center_user_id: 'owner-1',
        device_id: 'browser-1',
        revoked_at: null,
      });

      await service.login({
        email: 'manager@example.com',
        password: 'correct-password',
        deviceId: 'browser-1',
      });

      expect(tokenService.generateCenterTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'existing-center-session' }),
      );
      expect(tx.centerDeviceSession.update).toHaveBeenCalledWith({
        where: { id: 'existing-center-session' },
        data: {
          refresh_token_hash: 'refresh-token-hash',
          device_name: null,
          last_used_at: expect.any(Date),
          revoked_at: null,
        },
      });
      expect(tx.centerDeviceSession.count).not.toHaveBeenCalled();
    });

    it('updates last seen only after the Serializable transaction commits', async () => {
      const events: string[] = [];
      prisma.$transaction.mockImplementation(
        async (callback: (client: any) => unknown) => {
          events.push('transaction-start');
          const result = await callback(tx);
          events.push('transaction-committed');
          return result;
        },
      );
      tx.centerUser.update.mockImplementation(async () => {
        events.push('last-seen-in-transaction');
      });
      prisma.centerUser.update.mockImplementation(async () => {
        events.push('last-seen-after-commit');
      });

      await service.login({
        email: 'manager@example.com',
        password: 'correct-password',
        deviceId: 'browser-1',
      });

      expect(events).toEqual([
        'transaction-start',
        'transaction-committed',
        'last-seen-after-commit',
      ]);
      expect(tx.centerUser.update).not.toHaveBeenCalled();
    });

    it('retries one Serializable transaction conflict and then succeeds', async () => {
      const conflict = Object.assign(new Error('serialization conflict'), {
        code: 'P2034',
      });
      prisma.$transaction
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce(async (callback: (client: any) => unknown) =>
          callback(tx),
        );

      await expect(
        service.login({
          email: 'manager@example.com',
          password: 'correct-password',
          deviceId: 'browser-1',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          accessToken: 'center-access-token',
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('returns 503 and logs the cause when transaction retries are exhausted', async () => {
      const conflict = Object.assign(new Error('serialization conflict'), {
        code: 'P2034',
      });
      prisma.$transaction.mockRejectedValue(conflict);
      const logSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      const error = await service
        .login({
          email: 'manager@example.com',
          password: 'correct-password',
          deviceId: 'browser-1',
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as Error).message).toBe('CENTER_SESSION_RETRY_EXHAUSTED');
      expect((error as ServiceUnavailableException).cause).toBe(conflict);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('retry attempts exhausted'),
        expect.stringContaining('serialization conflict'),
      );
    });

    it('returns 500 and logs the stack for a non-retryable server failure', async () => {
      const databaseError = new Error('database unavailable');
      prisma.$transaction.mockRejectedValue(databaseError);
      const logSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      const error = await service
        .login({
          email: 'manager@example.com',
          password: 'correct-password',
          deviceId: 'browser-1',
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
      expect((error as Error).message).toBe('CENTER_SESSION_CREATION_FAILED');
      expect((error as InternalServerErrorException).cause).toBe(databaseError);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Center session creation failed'),
        expect.stringContaining('database unavailable'),
      );
    });

    it('evicts and revokes the least recently used session on device four', async () => {
      tx.centerDeviceSession.count.mockResolvedValue(3);
      tx.centerDeviceSession.findFirst.mockResolvedValue({
        id: 'least-recent-session',
      });

      await service.login({
        email: 'manager@example.com',
        password: 'correct-password',
        deviceId: 'device-4',
      });

      expect(tx.centerDeviceSession.findFirst).toHaveBeenCalledWith({
        where: { center_user_id: 'owner-1', revoked_at: null },
        orderBy: [{ last_used_at: 'asc' }, { created_at: 'asc' }],
        select: { id: true },
      });
      expect(tx.centerDeviceSession.delete).toHaveBeenCalledWith({
        where: { id: 'least-recent-session' },
      });
      expect(valkeyService.revokeSession).toHaveBeenCalledWith(
        'least-recent-session',
      );
    });

    it('creates a fresh session ID when a previously revoked device returns', async () => {
      tx.centerDeviceSession.findUnique.mockResolvedValue({
        id: 'revoked-center-session',
        center_user_id: 'owner-1',
        device_id: 'browser-1',
        revoked_at: new Date(),
      });

      await service.login({
        email: 'manager@example.com',
        password: 'correct-password',
        deviceId: 'browser-1',
      });

      expect(tx.centerDeviceSession.delete).toHaveBeenCalledWith({
        where: { id: 'revoked-center-session' },
      });
      expect(tokenService.generateCenterTokenPair).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.not.stringMatching(/^revoked-center-session$/),
        }),
      );
    });

    it('keeps a database revocation successful when Valkey is unavailable', async () => {
      valkeyService.revokeSession.mockRejectedValue(
        new Error('cache unavailable'),
      );

      await expect(
        service.revokeDeviceSession('owner-1', 'center-session-1'),
      ).resolves.toBeUndefined();
      expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalledTimes(1);
    });

    it('atomically rotates a hash only in the owning center session', async () => {
      await expect(
        service.rotateDeviceSessionRefreshHash(
          'owner-1',
          'center-session-1',
          'expected-hash',
          'replacement-hash',
        ),
      ).resolves.toBe(true);

      expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'center-session-1',
          center_user_id: 'owner-1',
          refresh_token_hash: 'expected-hash',
          revoked_at: null,
        },
        data: {
          refresh_token_hash: 'replacement-hash',
          last_used_at: expect.any(Date),
        },
      });

      prisma.centerDeviceSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.rotateDeviceSessionRefreshHash(
          'owner-1',
          'center-session-1',
          'stale-hash',
          'replacement-hash',
        ),
      ).resolves.toBe(false);
    });

    it('revokes only an active session owned by the center user', async () => {
      await service.revokeDeviceSession('owner-1', 'center-session-1');

      expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'center-session-1',
          center_user_id: 'owner-1',
          revoked_at: null,
        },
        data: { revoked_at: expect.any(Date) },
      });
      expect(valkeyService.revokeSession).toHaveBeenCalledWith(
        'center-session-1',
      );
    });

    it('does not disclose or revoke a session owned by another center user', async () => {
      prisma.centerDeviceSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.revokeDeviceSession('owner-2', 'center-session-1'),
      ).rejects.toThrow('INVALID_SESSION');
      expect(valkeyService.revokeSession).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const activeSession = {
      id: 'center-session-1',
      center_user_id: 'owner-1',
      device_id: 'browser-1',
      refresh_token_hash: 'current-refresh-hash',
      revoked_at: null,
    };

    beforeEach(() => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue(activeSession);
      tokenService.generateCenterTokenPair.mockReturnValue({
        accessToken: 'rotated-access-token',
        refreshToken: 'rotated-refresh-token',
      });
      tokenService.hashRefreshToken.mockResolvedValue('rotated-refresh-hash');
    });

    it('rotates the stored hash and returns a new pair for the same session', async () => {
      const result = await service.refresh({
        refreshToken: 'center-refresh-token',
      });

      expect(tokenService.verifyCenterRefreshToken).toHaveBeenCalledWith(
        'center-refresh-token',
      );
      expect(prisma.centerDeviceSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'center-session-1',
          center_user_id: 'owner-1',
          revoked_at: null,
        },
      });
      expect(tokenService.generateCenterTokenPair).toHaveBeenCalledWith({
        centerUserId: 'owner-1',
        centerId: 'center-1',
        deviceId: 'browser-1',
        sessionId: 'center-session-1',
      });
      expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'center-session-1',
          center_user_id: 'owner-1',
          refresh_token_hash: 'current-refresh-hash',
          revoked_at: null,
        },
        data: {
          refresh_token_hash: 'rotated-refresh-hash',
          last_used_at: expect.any(Date),
        },
      });
      expect(result).toEqual({
        accessToken: 'rotated-access-token',
        refreshToken: 'rotated-refresh-token',
      });
    });

    it('rejects a token that is not a valid center refresh token', async () => {
      tokenService.verifyCenterRefreshToken.mockImplementation(() => {
        throw new UnauthorizedException('INVALID_CENTER_REFRESH_TOKEN');
      });

      await expect(
        service.refresh({ refreshToken: 'student-refresh-token' }),
      ).rejects.toThrow('INVALID_CENTER_REFRESH_TOKEN');
      expect(prisma.centerDeviceSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a token whose device does not match the stored session', async () => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue({
        ...activeSession,
        device_id: 'another-device',
      });

      await expect(
        service.refresh({ refreshToken: 'center-refresh-token' }),
      ).rejects.toThrow('INVALID_CENTER_REFRESH_TOKEN');
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a replayed token that no longer matches the stored hash', async () => {
      tokenService.compareRefreshToken.mockResolvedValue(false);

      await expect(
        service.refresh({ refreshToken: 'stale-refresh-token' }),
      ).rejects.toThrow('INVALID_CENTER_REFRESH_TOKEN');
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a revoked or missing session without disclosing which', async () => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'center-refresh-token' }),
      ).rejects.toThrow('INVALID_CENTER_REFRESH_TOKEN');
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('lets exactly one of two concurrent refreshes win the rotation', async () => {
      prisma.centerDeviceSession.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const results = await Promise.allSettled([
        service.refresh({ refreshToken: 'center-refresh-token' }),
        service.refresh({ refreshToken: 'center-refresh-token' }),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('does not disguise an infrastructure failure as an authentication failure', async () => {
      prisma.centerDeviceSession.findFirst.mockRejectedValue(
        new Error('connection terminated'),
      );

      await expect(
        service.refresh({ refreshToken: 'center-refresh-token' }),
      ).rejects.not.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('logout', () => {
    const activeSession = {
      id: 'center-session-1',
      center_user_id: 'owner-1',
      device_id: 'browser-1',
      refresh_token_hash: 'current-refresh-hash',
      revoked_at: null,
    };

    beforeEach(() => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue(activeSession);
    });

    it('revokes only the session the presented token belongs to', async () => {
      const result = await service.logout({
        refreshToken: 'center-refresh-token',
      });

      expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'center-session-1',
          center_user_id: 'owner-1',
          revoked_at: null,
        },
        data: { revoked_at: expect.any(Date) },
      });
      expect(valkeyService.revokeSession).toHaveBeenCalledWith(
        'center-session-1',
      );
      expect(result).toEqual({ success: true });
    });

    it('is idempotent when the session was already revoked', async () => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue({
        ...activeSession,
        revoked_at: new Date(),
      });

      await expect(
        service.logout({ refreshToken: 'center-refresh-token' }),
      ).resolves.toEqual({ success: true });
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent when the session row is already gone', async () => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue(null);

      await expect(
        service.logout({ refreshToken: 'center-refresh-token' }),
      ).resolves.toEqual({ success: true });
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a stale token permission to revoke the session that replaced it', async () => {
      tokenService.compareRefreshToken.mockResolvedValue(false);

      await expect(
        service.logout({ refreshToken: 'pre-rotation-token' }),
      ).rejects.toThrow('INVALID_CENTER_REFRESH_TOKEN');
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
      expect(valkeyService.revokeSession).not.toHaveBeenCalled();
    });

    it('refuses a token whose device does not match the stored session', async () => {
      prisma.centerDeviceSession.findFirst.mockResolvedValue({
        ...activeSession,
        device_id: 'another-device',
      });

      await expect(
        service.logout({ refreshToken: 'center-refresh-token' }),
      ).rejects.toThrow('INVALID_CENTER_REFRESH_TOKEN');
      expect(prisma.centerDeviceSession.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the database revocation authoritative when Valkey fails', async () => {
      valkeyService.revokeSession.mockRejectedValue(new Error('cache down'));

      await expect(
        service.logout({ refreshToken: 'center-refresh-token' }),
      ).resolves.toEqual({ success: true });
      expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalled();
    });
  });
});
