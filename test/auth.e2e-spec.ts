import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { TokenService } from '../src/modules/auth/token.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';
import { AccessTokenPayload } from '../src/shared/interfaces/token-payload.interface';

const student = {
  id: 'student-1',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john.doe@example.com',
  email_verified: true,
  created_at: '2026-02-09T00:00:00.000Z',
  updated_at: '2026-02-09T00:00:00.000Z',
};

const verifiedAuthStudent = {
  id: 'student-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  emailVerified: true,
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

describe('AuthController (e2e)', () => {
  let app: INestApplication<App>;

  const deviceSessions = [
    { id: 'session-1', device_id: 'dev-1', device_name: 'Pixel', last_used_at: '2026-05-03T00:00:00.000Z', created_at: '2026-05-01T00:00:00.000Z' },
  ];

  const authService = {
    register: jest.fn().mockResolvedValue({ message: 'verification email sent' }),
    verifyEmail: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      student: verifiedAuthStudent,
    }),
    createDeviceSession: jest.fn().mockResolvedValue(session),
    validateRefreshToken: jest.fn().mockResolvedValue(session),
    updateDeviceSessionRefreshHash: jest.fn().mockResolvedValue(undefined),
    updateStudentProfile: jest.fn().mockResolvedValue({
      ...student,
      first_name: 'Jane',
    }),
    revokeDeviceSession: jest.fn().mockResolvedValue(undefined),
    getActiveDeviceSession: jest.fn().mockResolvedValue(session),
    googleLogin: jest.fn(),
    googleLink: jest.fn(),
    getDeviceSessions: jest.fn().mockResolvedValue(deviceSessions),
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

    authService.register.mockResolvedValue({ message: 'verification email sent' });
    authService.verifyEmail.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      student: verifiedAuthStudent,
    });
    authService.createDeviceSession.mockResolvedValue(session);
    authService.validateRefreshToken.mockResolvedValue(session);
    authService.updateDeviceSessionRefreshHash.mockResolvedValue(undefined);
    authService.updateStudentProfile.mockResolvedValue({
      ...student,
      first_name: 'Jane',
    });
    authService.revokeDeviceSession.mockResolvedValue(undefined);
    authService.getActiveDeviceSession.mockResolvedValue(session);
    authService.getDeviceSessions.mockResolvedValue(deviceSessions);
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

  it('POST /api/auth/register returns generic success for a new email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: 'John.Doe@Example.com',
        password: 'password123',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.message).toBe('verification email sent');
        expect(authService.register).toHaveBeenCalledWith(
          expect.objectContaining({ email: 'john.doe@example.com' }),
        );
      });
  });

  it('POST /api/auth/register returns generic success for an existing verified email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'password123',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.message).toBe('verification email sent');
      });
  });

  it('POST /api/auth/register returns generic success for an existing unverified email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'password123',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.message).toBe('verification email sent');
      });
  });

  it('POST /api/auth/verify-email returns tokens and verified student', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: 'verification-token', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
        expect(res.body.student).toEqual({
          id: 'student-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          emailVerified: true,
        });
      });
  });

  it('POST /api/auth/verify-email is idempotent on a second click', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: 'verification-token', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.student.emailVerified).toBe(true);
      });
  });

  it('POST /api/auth/verify-email returns 400 for expired token', async () => {
    authService.verifyEmail.mockRejectedValueOnce(
      new BadRequestException('VERIFICATION_TOKEN_EXPIRED'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: 'expired-token', deviceId: 'device-1' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe('VERIFICATION_TOKEN_EXPIRED');
        expect(res.body.message).toBe(
          'Verification link has expired. Please request a new one.',
        );
      });
  });

  it('POST /api/auth/verify-email returns 400 for invalid token', async () => {
    authService.verifyEmail.mockRejectedValueOnce(
      new BadRequestException('VERIFICATION_TOKEN_INVALID'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: 'invalid-token', deviceId: 'device-1' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error).toBe('VERIFICATION_TOKEN_INVALID');
        expect(res.body.message).toBe('Invalid verification token.');
      });
  });

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
    authService.validateRefreshToken.mockRejectedValueOnce(
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

  it('PATCH /api/auth/profile updates student and returns tokens', async () => {
    await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .send({ firstName: 'Jane' })
      .expect(200)
      .expect((res) => {
        expect(res.body.student.firstName).toBe('Jane');
        expect(res.body.student.id).toBe('student-1');
        expect(res.body.student.emailVerified).toBe(true);
        expect(res.body.student.createdAt).toBeUndefined();
        expect(res.body.student.updatedAt).toBeUndefined();
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
      });
  });

  it('POST /api/auth/logout revokes session', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: 'refresh-token' })
      .expect(201)
      .expect((res) => {
        expect(res.body.success).toBe(true);
      });
  });

  it('POST /api/auth/login returns tokens for valid credentials', async () => {
    authService.login = jest.fn().mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      student: verifiedAuthStudent,
    });
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'john.doe@example.com', password: 'password123', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
      });
  });

  it('POST /api/auth/login returns 403 for unverified email', async () => {
    authService.login = jest.fn().mockRejectedValueOnce(
      new ForbiddenException('EMAIL_NOT_VERIFIED'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'john.doe@example.com', password: 'password123', deviceId: 'device-1' })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('EMAIL_NOT_VERIFIED');
        expect(res.body.message).toBe('Please verify your email to continue.');
      });
  });

  it('POST /api/auth/login returns 401 for invalid credentials', async () => {
    authService.login = jest.fn().mockRejectedValueOnce(
      new UnauthorizedException('INVALID_CREDENTIALS'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'john.doe@example.com', password: 'wrongpass', deviceId: 'device-1' })
      .expect(401)
      .expect((res) => {
        expect(res.body.error).toBe('INVALID_CREDENTIALS');
      });
  });

  it('POST /api/auth/forgot-password always returns success', async () => {
    authService.forgotPassword = jest.fn().mockResolvedValueOnce({ message: 'password reset sent' });

    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'john.doe@example.com' })
      .expect(201)
      .expect((res) => {
        expect(res.body.message).toBe('password reset sent');
      });
  });

  it('POST /api/auth/reset-password returns tokens for valid reset', async () => {
    authService.resetPassword = jest.fn().mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      student: verifiedAuthStudent,
    });

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: 'reset-token', newPassword: 'newpassword123', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
      });
  });

  it('POST /api/auth/google returns tokens for returning user', async () => {
    authService.googleLogin = jest.fn().mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      student: verifiedAuthStudent,
    });

    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'google-token', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
        expect(res.body.refreshToken).toBe('refresh-token');
      });
  });

  it('POST /api/auth/google returns LINKING_REQUIRED for existing student', async () => {
    authService.googleLogin = jest.fn().mockResolvedValueOnce({
      status: 'LINKING_REQUIRED',
      linkingToken: 'linking-jwt',
    });

    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'google-token', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('LINKING_REQUIRED');
        expect(res.body.linkingToken).toBe('linking-jwt');
      });
  });

  it('POST /api/auth/google returns 401 for invalid token', async () => {
    authService.googleLogin = jest.fn().mockRejectedValueOnce(
      new UnauthorizedException('INVALID_GOOGLE_TOKEN'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'invalid-token', deviceId: 'device-1' })
      .expect(401)
      .expect((res) => {
        expect(res.body.error).toBe('INVALID_GOOGLE_TOKEN');
      });
  });

  it('POST /api/auth/google/link returns tokens for valid linking token', async () => {
    authService.googleLink = jest.fn().mockResolvedValueOnce({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      student: verifiedAuthStudent,
    });

    await request(app.getHttpServer())
      .post('/api/auth/google/link')
      .send({ linkingToken: 'linking-jwt', deviceId: 'device-1' })
      .expect(201)
      .expect((res) => {
        expect(res.body.accessToken).toBe('access-token');
      });
  });

  it('POST /api/auth/google/link returns 401 for invalid linking token', async () => {
    authService.googleLink = jest.fn().mockRejectedValueOnce(
      new UnauthorizedException('LINKING_TOKEN_INVALID'),
    );

    await request(app.getHttpServer())
      .post('/api/auth/google/link')
      .send({ linkingToken: 'invalid-linking-token', deviceId: 'device-1' })
      .expect(401)
      .expect((res) => {
        expect(res.body.error).toBe('LINKING_TOKEN_INVALID');
      });
  });

  it('GET /api/auth/device-sessions returns 200 array with valid JWT', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/device-sessions')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].id).toBe('session-1');
        expect(authService.getDeviceSessions).toHaveBeenCalledWith('student-1');
      });
  });

  it('GET /api/auth/device-sessions returns 401 without token', async () => {
    const noAuthGuard = { canActivate: () => false };

    const moduleFixture = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokenService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(noAuthGuard)
      .compile();

    const unauthApp = moduleFixture.createNestApplication();
    unauthApp.useGlobalFilters(new AuthExceptionFilter());
    await unauthApp.init();

    await request(unauthApp.getHttpServer())
      .get('/api/auth/device-sessions')
      .expect(403);

    await unauthApp.close();
  });
});
