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

const A_QUOTE = {
  lines: [
    { tier: 'START', seats: 5, unitPriceXaf: 4500, amountXaf: 22500 },
    { tier: 'PRO', seats: 5, unitPriceXaf: 10000, amountXaf: 50000 },
  ],
  totalSeats: 10,
  totalXaf: 72500,
};

describe('POST /api/centers/me/subscription/quote', () => {
  let app: INestApplication<App>;
  let subscriptions: { quote: jest.Mock };

  beforeEach(async () => {
    subscriptions = { quote: jest.fn().mockResolvedValue(A_QUOTE) };

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

  it('quotes a mix of tiers, itemised', async () => {
    const response = await quote({ start: 5, pro: 5 }).expect(201);

    expect(response.body).toEqual(A_QUOTE);
  });

  it('passes the mix on the tier keys the service expects', async () => {
    await quote({ start: 5, pro: 3, premium: 2 });

    expect(subscriptions.quote).toHaveBeenCalledWith(signedIdentity, {
      START: 5,
      PRO: 3,
      PREMIUM: 2,
    });
  });

  it('prices the caller own center, never one named in the body', async () => {
    await quote({ start: 10 });

    expect(subscriptions.quote).toHaveBeenCalledWith(
      signedIdentity,
      expect.anything(),
    );
  });

  it('accepts a single tier', async () => {
    await quote({ start: 10 }).expect(201);

    expect(subscriptions.quote).toHaveBeenCalledWith(signedIdentity, {
      START: 10,
      PRO: undefined,
      PREMIUM: undefined,
    });
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
      ['a unit price', { start: 10, unitPriceXaf: 1 }],
      ['a total', { start: 10, amountXaf: 1 }],
      ['an amount', { start: 10, amount: 1 }],
      ['a total under another name', { start: 10, total: 1 }],
      ['a currency', { start: 10, currency: 'EUR' }],
      ['another center', { start: 10, centerId: 'someone-else' }],
      ['a tier by its old name', { seats: 10 }],
    ])('refuses %s', async (_case, body) => {
      const response = await quote(body).expect(400);

      expect(response.body.error).toBe('VALIDATION_ERROR');
      expect(subscriptions.quote).not.toHaveBeenCalled();
    });
  });

  describe('each tier count must be a seat count', () => {
    it.each([
      ['a string', { start: '10' }],
      ['a fraction', { start: 10.5 }],
      ['a negative', { start: -10 }],
      ['an absurd number', { start: 20000 }],
    ])('refuses %s', async (_case, body) => {
      await quote(body).expect(400);
      expect(subscriptions.quote).not.toHaveBeenCalled();
    });

    it('accepts zero, meaning this tier is not wanted', async () => {
      // A client sending a full mix with some tiers at zero is normal. The
      // service treats zero as absent rather than as an error.
      await quote({ start: 10, pro: 0, premium: 0 }).expect(201);
    });
  });
});
