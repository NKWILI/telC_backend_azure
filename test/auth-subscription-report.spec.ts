/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import type { StudentEntitlement } from '../src/shared/services/student-entitlement.service';

const TRIAL: StudentEntitlement = {
  status: 'TRIAL',
  studentsMayLearn: true,
  graceEndsAt: null,
};

const BLOCKED: StudentEntitlement = {
  status: 'BLOCKED',
  studentsMayLearn: false,
  graceEndsAt: null,
};

describe('login and refresh report the subscription', () => {
  let prismaMock: any;
  let txMock: any;
  let tokenServiceMock: any;
  let entitlement: any;
  let service: AuthService;

  beforeEach(() => {
    txMock = {
      deviceSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn().mockResolvedValue({ id: 'session-1' }),
        deleteMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    prismaMock = {
      student: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      deviceSession: { update: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn((cb: any) => cb(txMock)),
    };

    tokenServiceMock = {
      generateTokenPair: jest.fn().mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
      hashRefreshToken: jest.fn().mockResolvedValue('hash'),
      compareRefreshToken: jest.fn().mockResolvedValue(true),
      verifyRefreshToken: jest.fn().mockReturnValue({
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
    };

    entitlement = { forStudent: jest.fn().mockResolvedValue(TRIAL) };

    service = new AuthService(
      prismaMock,
      tokenServiceMock,
      { generateToken: () => 'raw', hashToken: () => 'hashed' } as any,
      { sendVerificationEmail: jest.fn() } as any,
      { verifyIdToken: jest.fn() } as any,
      undefined,
      entitlement,
    );
  });

  const givenStudent = () =>
    prismaMock.student.findUnique.mockResolvedValueOnce({
      id: 'student-1',
      password_hash: bcrypt.hashSync('password123', 10),
      email_verified: true,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
    });

  const login = () =>
    service.login({
      email: 'john.doe@example.com',
      password: 'password123',
      deviceId: 'device-1',
      deviceName: 'Pixel',
    } as any);

  describe('login', () => {
    it('carries the status, so a client knows before its first learning call', async () => {
      givenStudent();

      const result: any = await login();

      expect(result.subscription).toMatchObject({
        status: 'TRIAL',
        studentsMayLearn: true,
      });
    });

    it('still signs a blocked student in, and tells them why they are stuck', async () => {
      givenStudent();
      entitlement.forStudent.mockResolvedValue(BLOCKED);

      const result: any = await login();

      // Refusing the sign-in would strand an account their center may yet pay
      // for. They get a session; the learning routes are what refuse them.
      expect(result.accessToken).toBe('access-token');
      expect(result.subscription).toMatchObject({
        status: 'BLOCKED',
        studentsMayLearn: false,
      });
    });

    it('signs in normally when the entitlement lookup fails', async () => {
      givenStudent();
      entitlement.forStudent.mockRejectedValue(new Error('connection lost'));

      const result: any = await login();

      // The field is a convenience for the client, not the enforcement point.
      // Failing a valid sign-in because a subscription could not be read would
      // trade a working login for a cosmetic detail.
      expect(result.accessToken).toBe('access-token');
      expect(result.subscription).toBeUndefined();
    });
  });

  describe('refresh', () => {
    let controller: AuthController;

    beforeEach(() => {
      const authServiceMock = {
        validateRefreshToken: jest.fn().mockResolvedValue({
          id: 'session-1',
          device_id: 'device-1',
          refresh_token_hash: 'old-hash',
        }),
        rotateDeviceSessionRefreshHash: jest.fn().mockResolvedValue(true),
        updateStudentLastSeen: jest.fn().mockResolvedValue(undefined),
      };

      controller = new AuthController(
        authServiceMock as any,
        tokenServiceMock,
        { consume: jest.fn() } as any,
        entitlement,
      );
    });

    it('reports the status alongside the rotated pair', async () => {
      const result: any = await controller.refresh({
        refreshToken: 'refresh-token',
      } as any);

      expect(result.accessToken).toBe('access-token');
      expect(result.subscription).toMatchObject({ status: 'TRIAL' });
    });

    it('keeps working for a blocked student rather than stranding them', async () => {
      entitlement.forStudent.mockResolvedValue(BLOCKED);

      const result: any = await controller.refresh({
        refreshToken: 'refresh-token',
      } as any);

      // A blocked student must be able to hold a working session, so that the
      // moment their center pays they are already signed in.
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.subscription).toMatchObject({
        status: 'BLOCKED',
        studentsMayLearn: false,
      });
    });

    it('rotates normally when the entitlement lookup fails', async () => {
      entitlement.forStudent.mockRejectedValue(new Error('connection lost'));

      const result: any = await controller.refresh({
        refreshToken: 'refresh-token',
      } as any);

      expect(result.accessToken).toBe('access-token');
      expect(result.subscription).toBeUndefined();
    });
  });
});
