/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  ConflictException,
  HttpException,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PaymentsController } from '../src/modules/centers/payments.controller';
import { PaymentsService } from '../src/modules/centers/payments.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
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
  lines: [
    { tier: 'START', seats: 5, unitPriceXaf: 4500, amountXaf: 22500 },
    { tier: 'PRO', seats: 5, unitPriceXaf: 10000, amountXaf: 50000 },
  ],
  totalSeats: 10,
  amountXaf: 72500,
  status: 'PENDING',
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
};

describe('PaymentsController', () => {
  let app: INestApplication<App>;
  let payments: Record<string, jest.Mock>;
  let rateLimit: Record<string, jest.Mock>;

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

    rateLimit = {
      checkPaymentCreateLimit: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: payments },
        { provide: RateLimitService, useValue: rateLimit },
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
  const pay = (body: unknown, key?: string) => {
    const req = http().post('/api/payments');
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body as object);
  };

  describe('creating a payment', () => {
    it('passes the mix on the tier keys the service expects', async () => {
      await pay({ start: 5, pro: 3, premium: 2 }, 'key-1').expect(201);

      expect(payments.create).toHaveBeenCalledWith(
        signedIdentity,
        { START: 5, PRO: 3, PREMIUM: 2 },
        'key-1',
      );
    });

    it('records the mix for the signed-in center, never one named in the body', async () => {
      await pay({ start: 10 }, 'key-1').expect(201);

      expect(payments.create).toHaveBeenCalledWith(
        signedIdentity,
        { START: 10, PRO: undefined, PREMIUM: undefined },
        'key-1',
      );
    });

    it('returns the record, itemised per tier', async () => {
      const response = await pay({ start: 5, pro: 5 }, 'key-1').expect(201);

      expect(response.body).toMatchObject({
        id: 'payment-1',
        lines: [
          { tier: 'START', seats: 5, unitPriceXaf: 4500, amountXaf: 22500 },
          { tier: 'PRO', seats: 5, unitPriceXaf: 10000, amountXaf: 50000 },
        ],
        totalSeats: 10,
        amountXaf: 72500,
        status: 'PENDING',
      });
    });

    it('requires an idempotency key', async () => {
      // Without one there is nothing to make a retry safe, and a dropped
      // response would leave the center unable to tell whether it had paid.
      await pay({ start: 10 }).expect(400);

      expect(payments.create).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty key', ''],
      ['a whitespace key', '   '],
      ['an absurdly long key', 'k'.repeat(256)],
    ])('refuses %s', async (_case, key) => {
      await pay({ start: 10 }, key).expect(400);
      expect(payments.create).not.toHaveBeenCalled();
    });

    it('is rate limited per center', async () => {
      // Every call creates a durable row, and a fresh key makes a fresh one.
      // The idempotency index stops duplicates of ONE intent; it does nothing
      // about a flood of distinct ones.
      await pay({ start: 10 }, 'key-1').expect(201);

      expect(rateLimit.checkPaymentCreateLimit).toHaveBeenCalledWith(
        signedIdentity.centerId,
      );
    });

    it('does not record a payment once the limit is reached', async () => {
      rateLimit.checkPaymentCreateLimit.mockRejectedValue(
        new HttpException('TOO_MANY_REQUESTS', HttpStatus.TOO_MANY_REQUESTS),
      );

      await pay({ start: 10 }, 'key-1').expect(429);

      expect(payments.create).not.toHaveBeenCalled();
    });

    it('surfaces a reused key as 409, not 500', async () => {
      payments.create.mockRejectedValue(
        new ConflictException('IDEMPOTENCY_KEY_REUSED'),
      );

      await pay({ start: 20 }, 'key-1').expect(409);
    });

    describe('the client cannot influence the price', () => {
      it.each([
        ['a unit price', { start: 10, unitPriceXaf: 1 }],
        ['a total', { start: 10, amountXaf: 1 }],
        ['a status', { start: 10, status: 'SUCCEEDED' }],
        ['another center', { start: 10, centerId: 'someone-else' }],
        ['a line breakdown of its own', { start: 10, lines: [] }],
        // The pre-tier shape. A body the old client sends must fail loudly
        // rather than be read as an empty mix and priced at zero.
        ['a seat count by its old name', { seats: 10 }],
      ])('refuses %s', async (_case, body) => {
        await pay(body, 'key-1').expect(400);
        expect(payments.create).not.toHaveBeenCalled();
      });
    });

    describe('each tier count must be a seat count', () => {
      it.each([
        ['a string', { start: '10' }],
        ['a fraction', { start: 10.5 }],
        ['a negative', { start: -10 }],
        ['an absurd number', { start: 20000 }],
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

    it('carries the tier breakdown into history', async () => {
      // An invoice read back months later has to still say what was bought,
      // at the price that applied then.
      const response = await http().get('/api/centers/me/payments').expect(200);

      expect(response.body.payments[0].lines).toEqual([
        { tier: 'START', seats: 5, unitPriceXaf: 4500, amountXaf: 22500 },
        { tier: 'PRO', seats: 5, unitPriceXaf: 10000, amountXaf: 50000 },
      ]);
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
