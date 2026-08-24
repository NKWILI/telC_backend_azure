/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PaymentsController } from '../src/modules/centers/payments.controller';
import { PaymentsService } from '../src/modules/centers/payments.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { CenterSubscriptionGuard } from '../src/modules/centers/guards/center-subscription.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

const signedIdentity = {
  type: 'access',
  actorType: 'CENTER_USER',
  centerUserId: 'owner-1',
  centerId: 'center-1',
  deviceId: 'browser-1',
  sessionId: 'center-session-1',
};

const aPayment = {
  id: 'payment-1',
  seats: 10,
  unitPriceXaf: 4800,
  amountXaf: 48000,
  status: 'PENDING',
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
};

describe('PaymentsController', () => {
  let app: INestApplication<App>;
  let payments: Record<string, jest.Mock>;

  beforeEach(async () => {
    payments = {
      create: jest.fn().mockResolvedValue(aPayment),
      get: jest.fn().mockResolvedValue(aPayment),
      list: jest.fn().mockResolvedValue({
        payments: [aPayment],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: payments }],
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
  const pay = (body: unknown, key?: string) => {
    const req = http().post('/api/payments');
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body as object);
  };

  describe('creating a payment', () => {
    it('records the seats for the signed-in center', async () => {
      await pay({ seats: 10 }, 'key-1').expect(201);

      expect(payments.create).toHaveBeenCalledWith(signedIdentity, 10, 'key-1');
    });

    it('returns the record', async () => {
      const response = await pay({ seats: 10 }, 'key-1').expect(201);

      expect(response.body).toMatchObject({
        id: 'payment-1',
        amountXaf: 48000,
        status: 'PENDING',
      });
    });

    it('requires an idempotency key', async () => {
      // Without one there is nothing to make a retry safe, and a dropped
      // response would leave the center unable to tell whether it had paid.
      await pay({ seats: 10 }).expect(400);

      expect(payments.create).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty key', ''],
      ['a whitespace key', '   '],
      ['an absurdly long key', 'k'.repeat(256)],
    ])('refuses %s', async (_case, key) => {
      await pay({ seats: 10 }, key).expect(400);
      expect(payments.create).not.toHaveBeenCalled();
    });

    it('surfaces a reused key as 409, not 500', async () => {
      payments.create.mockRejectedValue(
        new ConflictException('IDEMPOTENCY_KEY_REUSED'),
      );

      await pay({ seats: 20 }, 'key-1').expect(409);
    });

    describe('the client cannot influence the price', () => {
      it.each([
        ['a unit price', { seats: 10, unitPriceXaf: 1 }],
        ['a total', { seats: 10, amountXaf: 1 }],
        ['a status', { seats: 10, status: 'SUCCEEDED' }],
        ['another center', { seats: 10, centerId: 'someone-else' }],
      ])('refuses %s', async (_case, body) => {
        await pay(body, 'key-1').expect(400);
        expect(payments.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('reading payments', () => {
    it('reads one, scoped to the signed-in center', async () => {
      await http().get('/api/payments/payment-1').expect(200);

      expect(payments.get).toHaveBeenCalledWith(signedIdentity, 'payment-1');
    });

    it('lists history for the signed-in center', async () => {
      await http().get('/api/centers/me/payments').expect(200);

      expect(payments.list).toHaveBeenCalledWith(
        signedIdentity,
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
    });

    it('accepts pagination from the query string', async () => {
      await http()
        .get('/api/centers/me/payments?page=2&pageSize=50')
        .expect(200);

      expect(payments.list).toHaveBeenCalledWith(
        signedIdentity,
        expect.objectContaining({ page: 2, pageSize: 50 }),
      );
    });

    it('caps pageSize so one request cannot pull the whole history', async () => {
      await http().get('/api/centers/me/payments?pageSize=5000').expect(400);

      expect(payments.list).not.toHaveBeenCalled();
    });
  });

  /**
   * The risk the plan ranks highest. A blocked center that cannot pay can
   * never come back, so these routes must not acquire the subscription guard —
   * and the way that would happen is someone adding it to the class later.
   */
  describe('a blocked center can still pay', () => {
    const guardsOn = (target: object): unknown[] =>
      (Reflect.getMetadata('__guards__', target) ?? []) as unknown[];

    it('carries no subscription guard on the class', () => {
      expect(guardsOn(PaymentsController)).not.toContain(
        CenterSubscriptionGuard,
      );
    });

    it.each(['create', 'get', 'list'])(
      'carries no subscription guard on %s',
      (method) => {
        const handler = (PaymentsController.prototype as Record<string, any>)[
          method
        ] as object;

        expect(guardsOn(handler)).not.toContain(CenterSubscriptionGuard);
      },
    );

    it('still requires the center to be signed in', () => {
      // Open to a blocked center is not open to everyone.
      expect(guardsOn(PaymentsController)).toContain(CenterAuthGuard);
    });
  });
});
