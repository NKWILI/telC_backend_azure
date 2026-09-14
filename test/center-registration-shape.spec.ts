/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterAuthController } from '../src/modules/centers/center-auth.controller';
import { CentersService } from '../src/modules/centers/centers.service';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';
import { TokenService } from '../src/modules/auth/token.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

/**
 * Registration collects five fields and nothing else.
 *
 * Country, city, the manager's phone and the logo move to onboarding, so a
 * client still sending them is out of date. The global pipe runs with
 * `forbidNonWhitelisted`, which means those fields are REFUSED rather than
 * quietly dropped — a client that thinks it set a country should be told it
 * did not.
 */
const VALID = {
  centerName: 'Institut Goethe Douala',
  managerFirstName: 'Alain',
  managerLastName: 'Ngeukeu',
  email: 'manager@example.com',
  password: 'a-strong-password',
};

describe('POST /api/center-auth/register accepts five fields', () => {
  let app: INestApplication<App>;
  let centers: { register: jest.Mock };

  beforeEach(async () => {
    centers = {
      register: jest
        .fn()
        .mockResolvedValue({ message: 'verification email sent' }),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterAuthController],
      providers: [
        { provide: CentersService, useValue: centers },
        { provide: CenterAuthService, useValue: {} },
        { provide: TokenService, useValue: {} },
        {
          provide: RateLimitService,
          useValue: {
            checkCenterRegisterLimit: jest.fn(),
            checkCenterVerifyEmailLimit: jest.fn(),
            checkCenterLoginLimit: jest.fn(),
            checkCenterForgotPasswordLimit: jest.fn(),
            checkCenterResetPasswordLimit: jest.fn(),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  const register = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/center-auth/register')
      .send(body as object);

  it('accepts the five fields', async () => {
    await register(VALID).expect(201);

    expect(centers.register).toHaveBeenCalledWith(
      expect.objectContaining({ centerName: 'Institut Goethe Douala' }),
    );
  });

  /**
   * The point of the task. Each of these used to be required; a client sending
   * one now is running against an older contract and should hear about it.
   */
  describe('the four onboarding fields are refused, not ignored', () => {
    it.each([
      ['country', { ...VALID, country: 'Cameroon' }],
      ['city', { ...VALID, city: 'Douala' }],
      ['phone', { ...VALID, phone: '+237690000000' }],
      ['logoUrl', { ...VALID, logoUrl: 'https://example.com/logo.webp' }],
    ])('refuses %s', async (_field, body) => {
      const response = await register(body).expect(400);

      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(centers.register).not.toHaveBeenCalled();
    });
  });

  describe('the five it does collect are still validated', () => {
    it.each([
      ['a missing center name', { ...VALID, centerName: undefined }],
      ['a blank center name', { ...VALID, centerName: '   ' }],
      ['a missing manager first name', { ...VALID, managerFirstName: '' }],
      ['an invalid email', { ...VALID, email: 'not-an-email' }],
      ['a short password', { ...VALID, password: 'short' }],
    ])('refuses %s', async (_case, body) => {
      await register(body).expect(400);
      expect(centers.register).not.toHaveBeenCalled();
    });

    it('trims the center name rather than storing the padding', async () => {
      await register({ ...VALID, centerName: '  Institut Goethe  ' }).expect(
        201,
      );

      expect(centers.register).toHaveBeenCalledWith(
        expect.objectContaining({ centerName: 'Institut Goethe' }),
      );
    });
  });
});
