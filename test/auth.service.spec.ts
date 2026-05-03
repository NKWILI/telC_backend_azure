import { BadGatewayException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prismaMock: any;
  let txMock: any;
  let tokenServiceMock: any;
  let tokenCryptoMock: any;
  let emailServiceMock: any;

  const verificationWindowMs = 24 * 60 * 60 * 1000;
  const recentExpiry = new Date(Date.now() + verificationWindowMs - 60_000);
  const oldExpiry = new Date(Date.now() + verificationWindowMs - 3 * 60_000);

  beforeEach(() => {
    txMock = {
      student: {
        create: jest.fn(),
        update: jest.fn(),
      },
      deviceSession: {
        findFirst: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      oAuthAccount: {
        create: jest.fn(),
      },
    };

    prismaMock = {
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        callback(txMock),
      ),
      student: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      deviceSession: {
        findFirst: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      oAuthAccount: {
        findFirst: jest.fn(),
      },
    };

    tokenServiceMock = {
      generateTokenPair: jest.fn().mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      hashRefreshToken: jest.fn().mockResolvedValue('refresh-hash'),
      compareRefreshToken: jest.fn().mockResolvedValue(true),
      verifyRefreshToken: jest.fn(),
    };

    tokenCryptoMock = {
      generateToken: jest.fn().mockReturnValue('raw-verification-token'),
      hashToken: jest.fn().mockReturnValue('verification-token-hash'),
      isExpired: jest.fn().mockReturnValue(false),
    };

    emailServiceMock = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const googleServiceMock = {
      verifyIdToken: jest.fn(),
    };

    service = new AuthService(
      prismaMock,
      tokenServiceMock,
      tokenCryptoMock,
      emailServiceMock,
      googleServiceMock,
    );
  });

  describe('upsertDeviceSession', () => {
    it('creates a new session when count < 3', async () => {
      const session = { id: 'session-1' };

      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(2);
      txMock.deviceSession.upsert.mockResolvedValueOnce(session);

      const result = await service.upsertDeviceSession(
        'student-1',
        'device-1',
        'refresh-hash-1',
        'Pixel',
      );

      expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(txMock.deviceSession.deleteMany).not.toHaveBeenCalled();
      expect(txMock.deviceSession.upsert).toHaveBeenCalledWith({
        where: { device_id: 'device-1' },
        update: {
          student_id: 'student-1',
          device_name: 'Pixel',
          refresh_token_hash: 'refresh-hash-1',
          revoked_at: null,
          last_used_at: expect.any(Date),
        },
        create: {
          student_id: 'student-1',
          device_id: 'device-1',
          device_name: 'Pixel',
          refresh_token_hash: 'refresh-hash-1',
        },
      });
      expect(result).toEqual(session);
    });

    it('evicts the oldest session when count is 3', async () => {
      const session = { id: 'session-2' };

      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(3);
      txMock.deviceSession.findFirst.mockResolvedValueOnce({ id: 'oldest-session' });
      txMock.deviceSession.upsert.mockResolvedValueOnce(session);

      const result = await service.upsertDeviceSession(
        'student-1',
        'device-2',
        'refresh-hash-2',
      );

      expect(txMock.deviceSession.findFirst).toHaveBeenNthCalledWith(2, {
        where: { student_id: 'student-1', revoked_at: null },
        orderBy: { created_at: 'asc' },
        select: { id: true },
      });
      expect(txMock.deviceSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['oldest-session'] } },
      });
      expect(result).toEqual(session);
    });

    it('reuses an existing device_id without evicting', async () => {
      const session = { id: 'session-3' };

      txMock.deviceSession.findFirst.mockResolvedValueOnce({ id: 'existing-session' });
      txMock.deviceSession.count.mockResolvedValueOnce(3);
      txMock.deviceSession.upsert.mockResolvedValueOnce(session);

      const result = await service.upsertDeviceSession(
        'student-1',
        'device-1',
        'refresh-hash-3',
      );

      expect(txMock.deviceSession.deleteMany).not.toHaveBeenCalled();
      expect(txMock.deviceSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { device_id: 'device-1' } }),
      );
      expect(result).toEqual(session);
    });

    it('runs inside a transaction', async () => {
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-4' });

      await service.upsertDeviceSession('student-2', 'device-4', 'refresh-hash-4');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.deviceSession.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.deviceSession.upsert).not.toHaveBeenCalled();
      expect(txMock.deviceSession.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('register', () => {
    const dto = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      password: 'password123',
    };

    it('returns generic success for a new email', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce(null);
      txMock.student.create.mockResolvedValueOnce({ id: 'student-1' });

      await expect(service.register(dto)).resolves.toEqual({
        message: 'verification email sent',
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(tokenCryptoMock.generateToken).toHaveBeenCalledTimes(1);
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledWith(
        dto.email,
        'raw-verification-token',
      );
    });

    it('returns generic success and does nothing for an existing verified email', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        email_verified: true,
      });

      await expect(service.register(dto)).resolves.toEqual({
        message: 'verification email sent',
      });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('resends verification for existing unverified email past the cooldown', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        email_verified: false,
        email_verification_expires: oldExpiry,
      });
      txMock.student.update.mockResolvedValueOnce({ id: 'student-1' });

      await expect(service.register(dto)).resolves.toEqual({
        message: 'verification email sent',
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: {
          email_verification_token: 'verification-token-hash',
          email_verification_expires: expect.any(Date),
        },
      });
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('does not resend within the 2-minute cooldown', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        email_verified: false,
        email_verification_expires: recentExpiry,
      });

      await expect(service.register(dto)).resolves.toEqual({
        message: 'verification email sent',
      });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('throws 502 and rolls back if email sending fails', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce(null);
      txMock.student.create.mockResolvedValueOnce({ id: 'student-1' });
      emailServiceMock.sendVerificationEmail.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(service.register(dto)).rejects.toMatchObject({
        response: { message: 'EMAIL_DELIVERY_FAILED' },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyEmail', () => {
    const dto = {
      token: 'verification-token',
      deviceId: 'device-1',
      deviceName: 'Pixel',
    };

    const unverifiedStudent = {
      id: 'student-1',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      email_verified: false,
      email_verification_expires: new Date(Date.now() + 60_000),
    };

    const verifiedStudent = {
      id: 'student-1',
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      email_verified: true,
      email_verification_expires: null,
    };

    it('marks student verified (token kept in DB) and returns token pair', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce(unverifiedStudent);
      prismaMock.student.update.mockResolvedValueOnce({
        ...unverifiedStudent,
        email_verified: true,
      });
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-1' });
      prismaMock.deviceSession.update.mockResolvedValueOnce(undefined);

      await expect(service.verifyEmail(dto)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        student: {
          id: 'student-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          emailVerified: true,
        },
      });

      expect(prismaMock.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { email_verified: true },
      });
    });

    it('returns fresh token pair idempotently if already verified', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce(verifiedStudent);
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-2' });
      prismaMock.deviceSession.update.mockResolvedValueOnce(undefined);

      await expect(service.verifyEmail(dto)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        student: {
          id: 'student-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          emailVerified: true,
        },
      });

      expect(prismaMock.student.update).not.toHaveBeenCalled();
    });

    it('second click with valid token on already-verified student returns fresh tokens', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce({
        ...verifiedStudent,
        email_verification_expires: new Date(Date.now() + 60_000),
      });
      tokenCryptoMock.isExpired.mockReturnValueOnce(false);
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-2' });
      prismaMock.deviceSession.update.mockResolvedValueOnce(undefined);

      await expect(service.verifyEmail(dto)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        student: {
          id: 'student-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          emailVerified: true,
        },
      });

      expect(prismaMock.student.update).not.toHaveBeenCalled();
    });

    it('throws VERIFICATION_TOKEN_EXPIRED for expired token on already-verified student', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce({
        ...verifiedStudent,
        email_verification_expires: new Date(Date.now() - 1_000),
      });
      tokenCryptoMock.isExpired.mockReturnValueOnce(true);

      await expect(service.verifyEmail(dto)).rejects.toMatchObject({
        response: { message: 'VERIFICATION_TOKEN_EXPIRED' },
      });
      expect(prismaMock.student.update).not.toHaveBeenCalled();
    });

    it('throws VERIFICATION_TOKEN_INVALID for unknown token hash', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce(null);

      await expect(service.verifyEmail(dto)).rejects.toMatchObject({
        response: { message: 'VERIFICATION_TOKEN_INVALID' },
      });
    });

    it('throws VERIFICATION_TOKEN_EXPIRED for expired token', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce({
        ...unverifiedStudent,
        email_verification_expires: new Date(Date.now() - 1_000),
      });
      tokenCryptoMock.isExpired.mockReturnValueOnce(true);

      await expect(service.verifyEmail(dto)).rejects.toMatchObject({
        response: { message: 'VERIFICATION_TOKEN_EXPIRED' },
      });
      expect(prismaMock.student.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('returns generic success when email not found', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.forgotPassword({ email: 'noone@example.com' } as any),
      ).resolves.toEqual({ message: 'If that email exists, a reset link was sent.' });
    });

    it('updates reset token and sends email when email exists', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({ id: 'student-1' });
      prismaMock.student.update.mockResolvedValueOnce({ id: 'student-1' });

      await expect(
        service.forgotPassword({ email: 'john.doe@example.com' } as any),
      ).resolves.toEqual({ message: 'If that email exists, a reset link was sent.' });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(prismaMock.student.update).toHaveBeenCalledTimes(1);
      expect(emailServiceMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('returns generic success and does not throw when email send fails', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({ id: 'student-1' });
      prismaMock.student.update.mockResolvedValueOnce({ id: 'student-1' });
      emailServiceMock.sendPasswordResetEmail.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(
        service.forgotPassword({ email: 'john.doe@example.com' } as any),
      ).resolves.toEqual({ message: 'If that email exists, a reset link was sent.' });
    });

    it('creates a reset token that expires in approximately 1 hour', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({ id: 'student-1' });
      prismaMock.student.update.mockResolvedValueOnce({ id: 'student-1' });

      await service.forgotPassword({ email: 'john.doe@example.com' } as any);

      const updateCall = prismaMock.student.update.mock.calls[0][0];
      const expiresAt: Date = updateCall.data.password_reset_expires;
      const oneHourMs = 60 * 60 * 1000;
      const now = Date.now();

      expect(expiresAt.getTime()).toBeGreaterThan(now + oneHourMs - 5000);
      expect(expiresAt.getTime()).toBeLessThan(now + oneHourMs + 5000);
    });
  });

  describe('resetPassword', () => {
    const dto = {
      token: 'reset-token',
      newPassword: 'newpassword123',
      deviceId: 'device-1',
      deviceName: 'Pixel',
    };

    it('resets password, revokes sessions, and returns token pair', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce({
        id: 'student-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
        password_reset_expires: new Date(Date.now() + 60_000),
      });

      txMock.deviceSession.deleteMany.mockResolvedValueOnce(undefined);
      txMock.student.update.mockResolvedValueOnce({ id: 'student-1' });
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-1' });

      await expect(service.resetPassword(dto as any)).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        student: {
          id: 'student-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          emailVerified: true,
        },
      });
    });

    it('throws RESET_TOKEN_INVALID for unknown token', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce(null);
      await expect(service.resetPassword(dto as any)).rejects.toMatchObject({
        response: { message: 'RESET_TOKEN_INVALID' },
      });
    });

    it('throws RESET_TOKEN_EXPIRED for expired token', async () => {
      prismaMock.student.findFirst.mockResolvedValueOnce({
        id: 'student-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
        password_reset_expires: new Date(Date.now() - 1000),
      });
      tokenCryptoMock.isExpired.mockReturnValueOnce(true);

      await expect(service.resetPassword(dto as any)).rejects.toMatchObject({
        response: { message: 'RESET_TOKEN_EXPIRED' },
      });
    });
  });

  describe('login', () => {
    const dto = {
      email: 'john.doe@example.com',
      password: 'password123',
      deviceId: 'device-1',
      deviceName: 'Pixel',
    };

    it('returns tokens for valid credentials and verified email', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        password_hash: bcrypt.hashSync('password123', 10),
        email_verified: true,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com',
      });

      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-1' });

      const result = await service.login(dto as any);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('throws INVALID_CREDENTIALS for unknown user', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce(null);

      await expect(service.login(dto as any)).rejects.toMatchObject({
        response: { message: 'INVALID_CREDENTIALS' },
      });
    });

    it('throws INVALID_CREDENTIALS for wrong password', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        password_hash: bcrypt.hashSync('not-the-password', 10),
        email_verified: true,
        email: 'john.doe@example.com',
      });

      await expect(service.login(dto as any)).rejects.toMatchObject({
        response: { message: 'INVALID_CREDENTIALS' },
      });
    });

    it('throws EMAIL_NOT_VERIFIED if recently sent verification', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        password_hash: bcrypt.hashSync('password123', 10),
        email_verified: false,
        email_verification_expires: recentExpiry,
        email: 'john.doe@example.com',
      });

      await expect(service.login(dto as any)).rejects.toMatchObject({
        response: { message: 'EMAIL_NOT_VERIFIED' },
      });
    });

    it('resends verification for unverified email past cooldown and throws EMAIL_NOT_VERIFIED', async () => {
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        password_hash: bcrypt.hashSync('password123', 10),
        email_verified: false,
        email_verification_expires: oldExpiry,
        email: 'john.doe@example.com',
      });
      txMock.student.update.mockResolvedValueOnce({ id: 'student-1' });

      await expect(service.login(dto as any)).rejects.toMatchObject({
        response: { message: 'EMAIL_NOT_VERIFIED' },
      });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('googleLogin', () => {
    it('returns tokens for returning user (existing OAuthAccount)', async () => {
      const googleService = (service as any).googleService;
      googleService.verifyIdToken = jest
        .fn()
        .mockResolvedValueOnce({
          sub: 'google-user-123',
          email: 'john@example.com',
          email_verified: true,
        });

      const oauthAccount = {
        id: 'oauth-1',
        student: {
          id: 'student-1',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
        },
      };

      prismaMock.oAuthAccount.findFirst.mockResolvedValueOnce(oauthAccount);
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-1' });

      const result = await service.googleLogin({
        idToken: 'google-token',
        deviceId: 'device-1',
        deviceName: 'Chrome',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect((result as any).student.email).toBe('john@example.com');
    });

    it('returns LINKING_REQUIRED for existing unverified student email with no OAuth', async () => {
      const googleService = (service as any).googleService;
      googleService.verifyIdToken = jest
        .fn()
        .mockResolvedValueOnce({
          sub: 'google-user-123',
          email: 'john@example.com',
          email_verified: false,
        });

      prismaMock.oAuthAccount.findFirst.mockResolvedValueOnce(null);
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
        email_verified: false,
      });

      const tokenService = (service as any).tokenService;
      tokenService.generateLinkingToken = jest
        .fn()
        .mockReturnValueOnce('linking-token-jwt');

      const result = await service.googleLogin({
        idToken: 'google-token',
        deviceId: 'device-1',
      });

      expect(result).toEqual({
        status: 'LINKING_REQUIRED',
        linkingToken: 'linking-token-jwt',
      });
    });

    it('returns LINKING_REQUIRED for existing verified student email with no OAuth', async () => {
      const googleService = (service as any).googleService;
      googleService.verifyIdToken = jest
        .fn()
        .mockResolvedValueOnce({
          sub: 'google-user-456',
          email: 'verified@example.com',
          email_verified: true,
        });

      prismaMock.oAuthAccount.findFirst.mockResolvedValueOnce(null);
      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-2',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'verified@example.com',
        email_verified: true,
      });

      const tokenService = (service as any).tokenService;
      tokenService.generateLinkingToken = jest
        .fn()
        .mockReturnValueOnce('linking-token-for-verified');

      const result = await service.googleLogin({
        idToken: 'google-token',
        deviceId: 'device-1',
      });

      expect(result).toEqual({
        status: 'LINKING_REQUIRED',
        linkingToken: 'linking-token-for-verified',
      });
    });

    it('creates new student for brand new email', async () => {
      const googleService = (service as any).googleService;
      googleService.verifyIdToken = jest
        .fn()
        .mockResolvedValueOnce({
          sub: 'google-user-123',
          email: 'newuser@example.com',
          email_verified: true,
          given_name: 'John',
          family_name: 'Doe',
        });

      prismaMock.oAuthAccount.findFirst.mockResolvedValueOnce(null);
      prismaMock.student.findUnique.mockResolvedValueOnce(null);

      txMock.student.create.mockResolvedValueOnce({
        id: 'student-new',
        first_name: 'John',
        last_name: 'Doe',
        email: 'newuser@example.com',
      });
      txMock.oAuthAccount.create.mockResolvedValueOnce({});
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-1' });

      const result = await service.googleLogin({
        idToken: 'google-token',
        deviceId: 'device-1',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect((result as any).student.email).toBe('newuser@example.com');
    });

    it('throws INVALID_GOOGLE_TOKEN for invalid token', async () => {
      const googleService = (service as any).googleService;
      const error = new Error('INVALID_GOOGLE_TOKEN');
      googleService.verifyIdToken = jest
        .fn()
        .mockRejectedValueOnce(error);

      await expect(
        service.googleLogin({
          idToken: 'invalid-token',
          deviceId: 'device-1',
        }),
      ).rejects.toThrow();
    });
  });

  describe('googleLink', () => {
    it('links OAuth account and returns tokens', async () => {
      const tokenService = (service as any).tokenService;
      tokenService.verifyLinkingToken = jest
        .fn()
        .mockReturnValueOnce({
          email: 'john@example.com',
          provider: 'google',
          providerId: 'google-user-123',
        });

      prismaMock.student.findUnique.mockResolvedValueOnce({
        id: 'student-1',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      });

      txMock.oAuthAccount.create.mockResolvedValueOnce({});
      txMock.student.update.mockResolvedValueOnce({});
      txMock.deviceSession.findFirst.mockResolvedValueOnce(null);
      txMock.deviceSession.count.mockResolvedValueOnce(0);
      txMock.deviceSession.upsert.mockResolvedValueOnce({ id: 'session-1' });

      const result = await service.googleLink({
        linkingToken: 'linking-jwt',
        deviceId: 'device-1',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.student.email).toBe('john@example.com');
    });

    it('throws error for invalid linking token', async () => {
      const tokenService = (service as any).tokenService;
      const error = new Error('LINKING_TOKEN_INVALID');
      tokenService.verifyLinkingToken = jest
        .fn()
        .mockImplementationOnce(() => {
          throw error;
        });

      await expect(
        service.googleLink({
          linkingToken: 'invalid-linking-token',
          deviceId: 'device-1',
        }),
      ).rejects.toThrow();
    });

    it('throws STUDENT_NOT_FOUND if email not in system', async () => {
      const tokenService = (service as any).tokenService;
      tokenService.verifyLinkingToken = jest
        .fn()
        .mockReturnValueOnce({
          email: 'unknown@example.com',
          provider: 'google',
          providerId: 'google-user-123',
        });

      prismaMock.student.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.googleLink({
          linkingToken: 'linking-jwt',
          deviceId: 'device-1',
        }),
      ).rejects.toMatchObject({
        response: { message: 'STUDENT_NOT_FOUND' },
      });
    });
  });
});
