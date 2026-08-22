/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CentersController } from '../src/modules/centers/centers.controller';
import { CentersService } from '../src/modules/centers/centers.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('CentersController registration contract', () => {
  let app: INestApplication<App>;
  let centersService: { register: jest.Mock };
  let rateLimitService: { checkCenterRegisterLimit: jest.Mock };

  const validBody = {
    centerName: '  Goethe Language Center  ',
    country: ' Cameroon ',
    city: ' Douala ',
    logoUrl: 'https://cdn.example.com/center.webp',
    managerFirstName: ' Alain ',
    managerLastName: ' Ngeukeu ',
    email: ' Manager@Example.COM ',
    phone: ' +237690000000 ',
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
      controllers: [CentersController],
      providers: [
        { provide: CentersService, useValue: centersService },
        { provide: RateLimitService, useValue: rateLimitService },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers a center with normalized input and a generic 201 response', async () => {
    await request(app.getHttpServer())
      .post('/api/centers/register')
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
      country: 'Cameroon',
      city: 'Douala',
      managerFirstName: 'Alain',
      managerLastName: 'Ngeukeu',
      email: 'manager@example.com',
      phone: '+237690000000',
    });
  });

  it('allows registration without an optional logo', async () => {
    const body = { ...validBody };
    Reflect.deleteProperty(body, 'logoUrl');

    await request(app.getHttpServer())
      .post('/api/centers/register')
      .send(body)
      .expect(201);

    expect(centersService.register).toHaveBeenCalledWith(
      expect.not.objectContaining({ logoUrl: expect.anything() }),
    );
  });

  it('rejects a non-HTTPS center logo before reaching the service', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/centers/register')
      .send({ ...validBody, logoUrl: 'http://cdn.example.com/center.webp' })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('rejects unknown fields such as client-supplied partnership state', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/centers/register')
      .send({ ...validBody, isSpecialPartner: true })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('rejects passwords longer than 72 UTF-8 bytes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/centers/register')
      .send({ ...validBody, password: 'é'.repeat(40) })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(centersService.register).not.toHaveBeenCalled();
  });

  it('rejects missing required fields with the center error contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/centers/register')
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
      .post('/api/centers/register')
      .send(validBody)
      .expect(429);

    expect(response.body.error).toBe('RATE_LIMIT_EXCEEDED');
    expect(centersService.register).not.toHaveBeenCalled();
  });
});
