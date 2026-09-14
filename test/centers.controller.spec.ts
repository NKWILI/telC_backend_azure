/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  HttpException,
  HttpStatus,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterAuthController } from '../src/modules/centers/center-auth.controller';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';
import { CentersService } from '../src/modules/centers/centers.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('Center registration contract', () => {
  let app: INestApplication<App>;
  let centersService: { register: jest.Mock };
  let rateLimitService: { checkCenterRegisterLimit: jest.Mock };

  const validBody = {
    centerName: '  Goethe Language Center  ',
    managerFirstName: ' Alain ',
    managerLastName: ' Ngeukeu ',
    email: ' Manager@Example.COM ',
    password: 'private-password',
  };

  beforeEach(async () => {
    centersService = {
      register: jest
        .fn()
        .mockResolvedValue({ message: 'verification email sent' }),
    };
    rateLimitService = {
      checkCenterRegisterLimit: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterAuthController],
      providers: [
        { provide: CentersService, useValue: centersService },
        { provide: CenterAuthService, useValue: {} },
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

  it('registers a center with normalized input and a generic 201 response', async () => {
    await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send(validBody)
      .expect(201)
      .expect({ message: 'verification email sent' });

    expect(rateLimitService.checkCenterRegisterLimit).toHaveBeenCalledWith(
      expect.any(String),
      'manager@example.com',
    );
    expect(centersService.register).toHaveBeenCalledWith({
      ...validBody,
      centerName: 'Goethe Language Center',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'manager@example.com',
    });
  });

  it('refuses a logo, which now belongs to onboarding', async () => {
    // Registration used to accept an optional HTTPS logo URL. It no longer
    // does, along with country, city and the manager phone — all four moved
    // to onboarding. The HTTPS rule still applies where the logo is now set;
    // `center-registration-shape.spec.ts` owns the full four-field contract.
    const response = await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send({ ...validBody, logoUrl: 'https://cdn.example.com/center.webp' })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('rejects unknown fields such as client-supplied partnership state', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send({ ...validBody, isSpecialPartner: true })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('rejects passwords longer than 72 UTF-8 bytes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send({ ...validBody, password: 'é'.repeat(40) })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('rejects missing required fields with the center error contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send({ email: 'manager@example.com' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
        message: expect.any(Array),
      }),
    );
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('applies rate limiting before calling the registration service', async () => {
    rateLimitService.checkCenterRegisterLimit.mockRejectedValue(
      new HttpException('RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS),
    );

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send(validBody)
      .expect(429);

    expect(response.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('logs unexpected failures without exposing request data', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    centersService.register.mockRejectedValue(new Error('database offline'));

    const response = await request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send(validBody)
      .expect(500);

    expect(response.body).toEqual({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected error',
    });
    expect(errorLog).toHaveBeenCalledWith(
      'Unexpected error while handling a center request (Error)',
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'manager@example.com',
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'private-password',
    );
  });
});
