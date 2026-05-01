import { BadGatewayException, BadRequestException } from '@nestjs/common';
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

    service = new AuthService(
      prismaMock,
      tokenServiceMock,
      tokenCryptoMock,
      emailServiceMock,
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

    it('marks student verified, clears token, creates session, returns token pair', async () => {
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
        data: {
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
        },
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
});
