/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  INestApplication,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterAuthController } from '../src/modules/centers/center-auth.controller';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('CenterAuthController contract', () => {
  const authResponse = {
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
  };
  const validVerifyBody = {
    token: ' raw-verification-token ',
    deviceId: ' browser-installation-1 ',
    deviceName: ' Chrome on Windows ',
  };
  const validLoginBody = {
    email: ' Manager@Example.COM ',
    password: 'private-password',
    deviceId: ' browser-installation-1 ',
    deviceName: ' Chrome on Windows ',
  };

  let app: INestApplication<App>;
  let centerAuthService: {
    verifyEmail: jest.Mock;
    login: jest.Mock;
  };
  let rateLimitService: {
    checkCenterVerifyEmailLimit: jest.Mock;
    checkCenterLoginLimit: jest.Mock;
  };

  beforeEach(async () => {
    centerAuthService = {
      verifyEmail: jest.fn().mockResolvedValue(authResponse),
      login: jest.fn().mockResolvedValue(authResponse),
    };
    rateLimitService = {
      checkCenterVerifyEmailLimit: jest.fn().mockResolvedValue(undefined),
      checkCenterLoginLimit: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterAuthController],
      providers: [
        { provide: CenterAuthService, useValue: centerAuthService },
        { provide: RateLimitService, useValue: rateLimitService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('verifies email with normalized device input and returns 201', async () => {
    await request(app.getHttpServer())
      .post('/api/center-auth/verify-email')
      .send(validVerifyBody)
      .expect(201)
      .expect(authResponse);

    expect(rateLimitService.checkCenterVerifyEmailLimit).toHaveBeenCalledWith(
      expect.any(String),
    );
    expect(centerAuthService.verifyEmail).toHaveBeenCalledWith({
      token: 'raw-verification-token',
      deviceId: 'browser-installation-1',
      deviceName: 'Chrome on Windows',
    });
  });

  it('logs in with normalized email and device input', async () => {
    await request(app.getHttpServer())
      .post('/api/center-auth/login')
      .send(validLoginBody)
      .expect(201)
      .expect(authResponse);

    expect(rateLimitService.checkCenterLoginLimit).toHaveBeenCalledWith(
      expect.any(String),
      'manager@example.com',
    );
    expect(centerAuthService.login).toHaveBeenCalledWith({
      ...validLoginBody,
      email: 'manager@example.com',
      deviceId: 'browser-installation-1',
      deviceName: 'Chrome on Windows',
    });
  });

  it.each([
    [
      'tenant fields',
      '/api/center-auth/login',
      { ...validLoginBody, centerId: 'attacker-center', role: 'OWNER' },
    ],
    [
      'an oversized verification token',
      '/api/center-auth/verify-email',
      { ...validVerifyBody, token: 'x'.repeat(257) },
    ],
    [
      'an oversized device ID',
      '/api/center-auth/login',
      { ...validLoginBody, deviceId: 'x'.repeat(256) },
    ],
    [
      'an oversized device name',
      '/api/center-auth/login',
      { ...validLoginBody, deviceName: 'x'.repeat(256) },
    ],
    [
      'a password over 72 UTF-8 bytes',
      '/api/center-auth/login',
      { ...validLoginBody, password: 'é'.repeat(40) },
    ],
    [
      'an invalid email',
      '/api/center-auth/login',
      { ...validLoginBody, email: 'not-an-email' },
    ],
    [
      'a password shorter than 8 characters',
      '/api/center-auth/login',
      { ...validLoginBody, password: 'short' },
    ],
  ])('rejects %s before reaching the service', async (_case, path, body) => {
    const response = await request(app.getHttpServer())
      .post(path)
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centerAuthService.verifyEmail).not.toHaveBeenCalled();
    expect(centerAuthService.login).not.toHaveBeenCalled();
  });

  it('applies verification rate limiting before consuming a token', async () => {
    rateLimitService.checkCenterVerifyEmailLimit.mockRejectedValue(
      new HttpException('RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS),
    );

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/verify-email')
      .send(validVerifyBody)
      .expect(429);

    expect(response.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(centerAuthService.verifyEmail).not.toHaveBeenCalled();
  });

  it('applies login rate limiting before checking credentials', async () => {
    rateLimitService.checkCenterLoginLimit.mockRejectedValue(
      new HttpException('RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS),
    );

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/login')
      .send(validLoginBody)
      .expect(429);

    expect(response.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(centerAuthService.login).not.toHaveBeenCalled();
  });

  it('returns the stable 401 contract for invalid credentials', async () => {
    centerAuthService.login.mockRejectedValue(
      new UnauthorizedException('INVALID_CREDENTIALS'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/login')
      .send(validLoginBody)
      .expect(401);

    expect(response.body).toEqual({
      error: 'INVALID_CREDENTIALS',
      message: 'INVALID_CREDENTIALS',
    });
  });

  it('returns the stable 403 contract for an unverified valid account', async () => {
    centerAuthService.login.mockRejectedValue(
      new ForbiddenException('EMAIL_NOT_VERIFIED'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/login')
      .send(validLoginBody)
      .expect(403);

    expect(response.body).toEqual({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('returns a safe 500 contract for session creation failures', async () => {
    centerAuthService.login.mockRejectedValue(
      new InternalServerErrorException('CENTER_SESSION_CREATION_FAILED'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/login')
      .send(validLoginBody)
      .expect(500);

    expect(response.body).toEqual({
      error: 'CENTER_SESSION_CREATION_FAILED',
      message: 'Unable to start a session. Please try again.',
    });
  });

  it('publishes success and expected error responses in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').build(),
    );

    expect(
      Object.keys(
        document.paths['/api/center-auth/verify-email']?.post?.responses ?? {},
      ),
    ).toEqual(expect.arrayContaining(['201', '400', '429', '500', '503']));
    expect(
      Object.keys(
        document.paths['/api/center-auth/login']?.post?.responses ?? {},
      ),
    ).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '429', '500', '503']),
    );
  });
});
