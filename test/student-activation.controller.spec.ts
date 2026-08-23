/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { StudentActivationController } from '../src/modules/centers/student-activation.controller';
import { StudentActivationService } from '../src/modules/centers/student-activation.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('StudentActivationController contract', () => {
  const tokens = {
    accessToken: 'student-access-token',
    refreshToken: 'student-refresh-token',
  };
  const validBody = {
    key: ' raw-activation-key ',
    password: 'a-strong-password',
    deviceId: ' phone-1 ',
    deviceName: ' Android ',
  };

  let app: INestApplication<App>;
  let service: { activate: jest.Mock };
  let rateLimit: { checkStudentActivationLimit: jest.Mock };

  beforeEach(async () => {
    service = { activate: jest.fn().mockResolvedValue(tokens) };
    rateLimit = {
      checkStudentActivationLimit: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [StudentActivationController],
      providers: [
        { provide: StudentActivationService, useValue: service },
        { provide: RateLimitService, useValue: rateLimit },
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

  it('activates with normalized input and returns a student session', async () => {
    await http()
      .post('/api/student-activations')
      .send(validBody)
      .expect(201)
      .expect(tokens);

    expect(service.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'raw-activation-key',
        password: 'a-strong-password',
        deviceId: 'phone-1',
      }),
    );
  });

  it('passes the caller address through for the audit trail', async () => {
    await http().post('/api/student-activations').send(validBody).expect(201);

    // A center holds the key and can redeem it itself; this is the trace.
    expect(service.activate.mock.calls[0][0].ip).toEqual(expect.any(String));
  });

  it('is rate limited before the key is even looked at', async () => {
    rateLimit.checkStudentActivationLimit.mockRejectedValue(
      new HttpException('RATE_LIMIT_EXCEEDED', HttpStatus.TOO_MANY_REQUESTS),
    );

    await http().post('/api/student-activations').send(validBody).expect(429);
    expect(service.activate).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing key', { ...validBody, key: undefined }],
    ['an empty key', { ...validBody, key: '   ' }],
    ['an oversized key', { ...validBody, key: 'x'.repeat(257) }],
    ['a short password', { ...validBody, password: 'short' }],
    ['a password over 72 bytes', { ...validBody, password: 'é'.repeat(40) }],
    ['a missing device id', { ...validBody, deviceId: '  ' }],
    ['a client-supplied student id', { ...validBody, studentId: 'someone' }],
    ['a client-supplied center id', { ...validBody, centerId: 'a-center' }],
  ])('rejects %s before reaching the service', async (_case, body) => {
    const response = await http()
      .post('/api/student-activations')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(service.activate).not.toHaveBeenCalled();
  });

  it.each([
    ['a spent or unknown key', 'ACTIVATION_KEY_INVALID'],
    ['an expired key', 'ACTIVATION_KEY_EXPIRED'],
  ])('returns a stable 400 for %s', async (_case, code) => {
    service.activate.mockRejectedValue(new BadRequestException(code));

    const response = await http()
      .post('/api/student-activations')
      .send(validBody)
      .expect(400);

    expect(response.body.error).toBe(code);
  });

  it('needs no authentication, because the key is the credential', async () => {
    await http().post('/api/student-activations').send(validBody).expect(201);
  });
});
