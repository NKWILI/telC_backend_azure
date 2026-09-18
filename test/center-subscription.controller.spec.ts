/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterSubscriptionController } from '../src/modules/centers/center-subscription.controller';
import { CenterSubscriptionService } from '../src/modules/centers/center-subscription.service';
import { CenterTrialService } from '../src/modules/centers/center-trial.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('CenterSubscriptionController contract', () => {
  const signedIdentity = {
    type: 'access',
    actorType: 'CENTER_USER',
    centerUserId: 'owner-1',
    centerId: 'center-1',
    deviceId: 'browser-1',
    sessionId: 'center-session-1',
  };

  const subscription = {
    status: 'TRIAL_PENDING',
    plan: 'TRIAL',
    seats: 3,
    trialStartedAt: null,
    trialEndsAt: null,
    paidUntil: null,
    graceEndsAt: null,
    studentsMayLearn: false,
  };

  const usage = {
    seatsUsed: 0,
    seatsLimit: 3,
    seatsAvailable: 3,
    status: 'TRIAL_PENDING',
  };

  let app: INestApplication<App>;
  let service: { getSubscription: jest.Mock; getUsage: jest.Mock };
  let trials: { start: jest.Mock };
  let guardAllows: boolean;

  beforeEach(async () => {
    guardAllows = true;
    service = {
      getSubscription: jest.fn().mockResolvedValue(subscription),
      getUsage: jest.fn().mockResolvedValue(usage),
    };
    trials = {
      start: jest.fn().mockResolvedValue({
        trialEndsAt: '2027-01-15T00:00:00.000Z',
        code: { id: 'code-1', code: 'LQ-7K2P-94QX', status: 'activated' },
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterSubscriptionController],
      providers: [
        { provide: CenterSubscriptionService, useValue: service },
        { provide: CenterTrialService, useValue: trials },
      ],
    })
      .overrideGuard(CenterAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          if (!guardAllows) return false;
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
  });

  describe('GET /api/centers/me/subscription', () => {
    it('returns the subscription for the signed center only', async () => {
      await request(app.getHttpServer())
        .get('/api/centers/me/subscription')
        .expect(200)
        .expect(subscription);

      expect(service.getSubscription).toHaveBeenCalledWith(signedIdentity);
    });

    it('is refused without a center token', async () => {
      guardAllows = false;

      await request(app.getHttpServer())
        .get('/api/centers/me/subscription')
        .expect(403);
      expect(service.getSubscription).not.toHaveBeenCalled();
    });

    it('surfaces a missing subscription as 404 rather than an empty body', async () => {
      service.getSubscription.mockRejectedValue(
        new NotFoundException('CENTER_SUBSCRIPTION_NOT_FOUND'),
      );

      const response = await request(app.getHttpServer())
        .get('/api/centers/me/subscription')
        .expect(404);

      expect(response.body.error).toBe('CENTER_SUBSCRIPTION_NOT_FOUND');
    });

    it('stays reachable while the center is blocked', async () => {
      // A blocked center must still be able to see what it owes and pay. The
      // dashboard keeps billing reachable; only learning is cut off.
      service.getSubscription.mockResolvedValue({
        ...subscription,
        status: 'BLOCKED',
        studentsMayLearn: false,
      });

      const response = await request(app.getHttpServer())
        .get('/api/centers/me/subscription')
        .expect(200);

      expect(response.body.status).toBe('BLOCKED');
    });
  });

  describe('POST /api/centers/me/trial', () => {
    it('starts the trial for the signed center only', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/centers/me/trial')
        .expect(201);

      expect(trials.start).toHaveBeenCalledWith(signedIdentity);
      expect(response.body.code.code).toBe('LQ-7K2P-94QX');
    });

    it('ignores a body: which center is asking comes from the token alone', async () => {
      // The route declares no body, so nothing a client sends can reach the
      // service. What matters is that another center's id is never used.
      await request(app.getHttpServer())
        .post('/api/centers/me/trial')
        .send({ centerId: 'attacker-center' })
        .expect(201);

      expect(trials.start).toHaveBeenCalledWith(signedIdentity);
    });

    it('is refused without a center token', async () => {
      guardAllows = false;

      await request(app.getHttpServer())
        .post('/api/centers/me/trial')
        .expect(403);

      expect(trials.start).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/centers/me/usage', () => {
    it('returns seat usage for the signed center only', async () => {
      await request(app.getHttpServer())
        .get('/api/centers/me/usage')
        .expect(200)
        .expect(usage);

      expect(service.getUsage).toHaveBeenCalledWith(signedIdentity);
    });

    it('is refused without a center token', async () => {
      guardAllows = false;

      await request(app.getHttpServer())
        .get('/api/centers/me/usage')
        .expect(403);
      expect(service.getUsage).not.toHaveBeenCalled();
    });

    it('reports an over-limit center without a negative remainder', async () => {
      service.getUsage.mockResolvedValue({
        seatsUsed: 10,
        seatsLimit: 5,
        seatsAvailable: 0,
        status: 'ACTIVE',
      });

      const response = await request(app.getHttpServer())
        .get('/api/centers/me/usage')
        .expect(200);

      expect(response.body.seatsAvailable).toBe(0);
    });
  });

  it('publishes both endpoints and their error responses in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').build(),
    );

    expect(
      Object.keys(
        document.paths['/api/centers/me/subscription']?.get?.responses ?? {},
      ),
    ).toEqual(expect.arrayContaining(['200', '401', '404']));
    expect(
      Object.keys(
        document.paths['/api/centers/me/usage']?.get?.responses ?? {},
      ),
    ).toEqual(expect.arrayContaining(['200', '401']));
  });
});
