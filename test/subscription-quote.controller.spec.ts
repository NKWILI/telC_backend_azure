/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterSubscriptionController } from '../src/modules/centers/center-subscription.controller';
import { CenterSubscriptionService } from '../src/modules/centers/center-subscription.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

const signedIdentity = {
  type: 'access',
  actorType: 'CENTER_USER',
  centerUserId: 'owner-1',
  centerId: 'center-1',
  deviceId: 'browser-1',
  sessionId: 'center-session-1',
};

describe('POST /api/centers/me/subscription/quote', () => {
  let app: INestApplication<App>;
  let subscriptions: { quote: jest.Mock };

  beforeEach(async () => {
    subscriptions = {
      quote: jest
        .fn()
        .mockResolvedValue({ seats: 10, unitPriceXaf: 4800, amountXaf: 48000 }),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterSubscriptionController],
      providers: [
        { provide: CenterSubscriptionService, useValue: subscriptions },
      ],
    })
      .overrideGuard(CenterAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().centerUser = signedIdentity;
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  const http = () => request(app.getHttpServer());
  const quote = (body: unknown) =>
    http()
      .post('/api/centers/me/subscription/quote')
      .send(body as object);

  it('quotes the seats asked for', async () => {
    const response = await quote({ seats: 10 }).expect(201);

    expect(response.body).toEqual({
      seats: 10,
      unitPriceXaf: 4800,
      amountXaf: 48000,
    });
  });

  it('prices the caller own center, never one named in the body', async () => {
    await quote({ seats: 10 });

    expect(subscriptions.quote).toHaveBeenCalledWith(signedIdentity, 10);
  });

  /**
   * The security property of the whole phase.
   *
   * These are not ignored, they are refused. Silently dropping an unexpected
   * `amount` would leave a client believing it had set the price, and leave
   * anyone reading the code unsure whether it had.
   */
  describe('the client cannot influence the price', () => {
    it.each([
      ['a unit price', { seats: 10, unitPriceXaf: 1 }],
      ['a total', { seats: 10, amountXaf: 1 }],
      ['an amount', { seats: 10, amount: 1 }],
      ['a total under another name', { seats: 10, total: 1 }],
      ['a currency', { seats: 10, currency: 'EUR' }],
      ['another center', { seats: 10, centerId: 'someone-else' }],
    ])('refuses %s', async (_case, body) => {
      const response = await quote(body).expect(400);

      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(subscriptions.quote).not.toHaveBeenCalled();
    });
  });

  describe('seats must be a seat count', () => {
    it.each([
      ['a missing seat count', {}],
      ['a string', { seats: '10' }],
      ['a fraction', { seats: 10.5 }],
      ['zero', { seats: 0 }],
      ['a negative', { seats: -10 }],
    ])('refuses %s', async (_case, body) => {
      await quote(body).expect(400);
      expect(subscriptions.quote).not.toHaveBeenCalled();
    });
  });
});
