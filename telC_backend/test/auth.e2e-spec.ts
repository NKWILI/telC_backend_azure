import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  HttpException,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { TokenService } from '../src/modules/auth/token.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';
import { AccessTokenPayload } from '../src/shared/interfaces/token-payload.interface';

const student = {
  id: 'student-1',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john.doe@example.com',
  is_registered: true,
  created_at: '2026-02-09T00:00:00.000Z',
  updated_at: '2026-02-09T00:00:00.000Z',
};

const session = {
  id: 'session-1',
  student_id: 'student-1',
  device_id: 'device-1',
  refresh_token_hash: 'hash',
  device_name: null,
  last_used_at: '2026-02-09T00:00:00.000Z',
  created_at: '2026-02-09T00:00:00.000Z',
  revoked_at: null,
};

const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;
  const authService = {
    createStudent: jest.fn().mockResolvedValue(student),
    createDeviceSession: jest.fn().mockResolvedValue(session),
    validateRefreshToken: jest.fn().mockResolvedValue(session),
    updateDeviceSessionRefreshHash: jest.fn().mockResolvedValue(undefined),
    updateStudentProfile: jest.fn().mockResolvedValue({
      ...student,
      first_name: 'Jane',
    }),
    revokeDeviceSession: jest.fn().mockResolvedValue(undefined),
    getActivationCodeExpiry: jest.fn().mockResolvedValue(expiresAt),
    checkMembershipExpiry: jest.fn().mockResolvedValue(undefined),
    getActiveDeviceSession: jest.fn().mockResolvedValue(session),
  };

  const tokenService = {
    generateTokenPair: jest.fn().mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }),
    hashRefreshToken: jest.fn().mockResolvedValue('hash'),
    verifyRefreshToken: jest.fn().mockReturnValue({
      studentId: 'student-1',
      deviceId: 'device-1',
      sessionId: 'session-1',
    }),
    compareRefreshToken: jest.fn().mockResolvedValue(true),
  };

  const rateLimitService = {
    checkActivationLimit: jest.fn(),
  };

  const guard = {
    canActivate: (context: any) => {
      const request = context.switchToHttp().getRequest();
      const payload: AccessTokenPayload = {
        studentId: 'student-1',
        isRegistered: true,
        deviceId: 'device-1',
      };
      request.student = payload;
      return true;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore default mock implementations after clear
    authService.createStudent.mockResolvedValue(student);
    authService.createDeviceSession.mockResolvedValue(session);
    authService.validateRefreshToken.mockResolvedValue(session);
    authService.updateDeviceSessionRefreshHash.mockResolvedValue(undefined);
    authService.updateStudentProfile.mockResolvedValue({
      ...student,
      first_name: 'Jane',
    });
    authService.revokeDeviceSession.mockResolvedValue(undefined);
    authService.getActivationCodeExpiry.mockResolvedValue(expiresAt);
    authService.checkMembershipExpiry.mockResolvedValue(undefined);
    authService.getActiveDeviceSession.mockResolvedValue(session);
    tokenService.generateTokenPair.mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    tokenService.hashRefreshToken.mockResolvedValue('hash');
    tokenService.verifyRefreshToken.mockReturnValue({
      studentId: 'student-1',
      deviceId: 'device-1',
      sessionId: 'session-1',
    });
    tokenService.compareRefreshToken.mockResolvedValue(true);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokenService },
        { provide: RateLimitService, useValue: rateLimitService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
  });

  // ─── Activation Tests ─────────────────────────────────

  it('POST /api/auth/activate returns tokens and bootstrap', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/activate')
      .send({
        activationCode: 'CODE123',
        deviceId: 'device-1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
        expect(res.body.student.id).toBe('student-1');
        // Bootstrap assertions
        expect(res.body.bootstrap).toBeDefined();
        expect(res.body.bootstrap.availableModules).toEqual([
          'SPRECHEN',
          'LESEN',
          'HOEREN',
          'SCHREIBEN',
        ]);
        expect(res.body.bootstrap.enabledModules).toEqual([
          'SPRECHEN',
          'LESEN',
        ]);
        expect(res.body.bootstrap.progressSummary).toEqual({});
        expect(res.body.bootstrap.lastActivityAt).toBeNull();
        expect(res.body.bootstrap.expiresAt).toBe(expiresAt);
      });
  });

  it('POST /api/auth/activate requires deviceId', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/activate')
      .send({
        activationCode: 'CODE123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      })
      .expect(400);
  });

  it('POST /api/auth/activate respects rate limit', async () => {
    rateLimitService.checkActivationLimit.mockImplementationOnce(() => {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    await request(app.getHttpServer())
      .post('/api/auth/activate')
      .send({
        activationCode: 'CODE123',
        deviceId: 'device-1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      })
      .expect(429)
      .expect((res) => {
        expect(res.body.error).toBe('RATE_LIMIT_EXCEEDED');
      });
  });

  it('POST /api/auth/activate rejects when device limit reached', async () => {
    authService.createDeviceSession.mockRejectedValueOnce(
      new ForbiddenException('DEVICE_LIMIT_REACHED'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/activate')
      .send({
        activationCode: 'CODE123',
        deviceId: 'device-1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
      })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('DEVICE_LIMIT_REACHED');
      });
  });

  // ─── Refresh Tests ────────────────────────────────────

  it('POST /api/auth/refresh returns new tokens', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'refresh-token' })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
      });
  });

  it('POST /api/auth/refresh rejects expired membership', async () => {
    authService.checkMembershipExpiry.mockRejectedValueOnce(
      new ForbiddenException('MEMBERSHIP_EXPIRED'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'refresh-token' })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('MEMBERSHIP_EXPIRED');
      });
  });

  // ─── Profile Tests ────────────────────────────────────

  it('PATCH /api/auth/profile updates student and returns tokens', async () => {
    await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .send({ firstName: 'Jane' })
      .expect(200)
      .expect((res) => {
        expect(res.body.student.firstName).toBe('Jane');
        expect(res.body.student.id).toBe('student-1');
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
      });
  });

  // ─── Logout Tests ─────────────────────────────────────

  it('POST /api/auth/logout revokes session', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: 'refresh-token' })
      .expect(201)
      .expect((res) => {
        expect(res.body.success).toBe(true);
      });
  });
});
