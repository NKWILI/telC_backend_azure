/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterActivationCodesController } from '../src/modules/centers/center-activation-codes.controller';
import { CenterActivationCodesService } from '../src/modules/centers/center-activation-codes.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { CenterSubscriptionGuard } from '../src/modules/centers/guards/center-subscription.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

/**
 * The wire contract of the Users page routes: who may call them, what they
 * accept, and which lock stands in front of which action.
 */
describe('CenterActivationCodesController contract', () => {
  const signedIdentity = {
    centerUserId: 'owner-1',
    centerId: 'center-1',
    sessionId: 'session-1',
  };
  const codeId = '2f1c7a9e-4b3d-4c8a-9f1e-0a1b2c3d4e5f';

  let app: INestApplication<App>;
  let codes: Record<string, jest.Mock>;
  let blocked: boolean;

  beforeEach(async () => {
    blocked = false;
    codes = {
      list: jest.fn().mockResolvedValue([]),
      seats: jest.fn().mockResolvedValue({}),
      deactivate: jest.fn().mockResolvedValue({ id: codeId }),
      reset: jest.fn().mockResolvedValue({ id: codeId }),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterActivationCodesController],
      providers: [{ provide: CenterActivationCodesService, useValue: codes }],
    })
      .overrideGuard(CenterAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().centerUser = signedIdentity;
          return true;
        },
      })
      .overrideGuard(CenterSubscriptionGuard)
      .useValue({
        canActivate: () => {
          if (blocked) {
            throw new ForbiddenException({ message: 'SUBSCRIPTION_INACTIVE' });
          }
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

  it('lists with the filters the page sends', async () => {
    await request(app.getHttpServer())
      .get('/api/centers/me/activation-codes?status=connected&planId=pro')
      .expect(200);

    expect(codes.list).toHaveBeenCalledWith(signedIdentity, {
      status: 'connected',
      planId: 'pro',
    });
  });

  it('refuses a filter value it does not know, and a type filter that no longer exists', async () => {
    await request(app.getHttpServer())
      .get('/api/centers/me/activation-codes?status=expired')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/centers/me/activation-codes?type=public')
      .expect(400);

    expect(codes.list).not.toHaveBeenCalled();
  });

  it('lets a blocked center still read its codes and seats', async () => {
    blocked = true;

    await request(app.getHttpServer())
      .get('/api/centers/me/activation-codes')
      .expect(200);
    await request(app.getHttpServer()).get('/api/centers/me/seats').expect(200);
  });

  it('stops a blocked center from acting on a code', async () => {
    blocked = true;

    await request(app.getHttpServer())
      .post(`/api/centers/me/activation-codes/${codeId}/deactivate`)
      .expect(403);
    expect(codes.deactivate).not.toHaveBeenCalled();
  });

  // Reset replaced it (D39): activate put the same value back in the pool,
  // and the previous student still knew it.
  it('no longer offers activate', async () => {
    await request(app.getHttpServer())
      .post(`/api/centers/me/activation-codes/${codeId}/activate`)
      .expect(404);
  });

  it('resets a code for the signed center only', async () => {
    await request(app.getHttpServer())
      .post(`/api/centers/me/activation-codes/${codeId}/reset`)
      .expect(200);

    expect(codes.reset).toHaveBeenCalledWith(signedIdentity, codeId);
  });

  it('stops a blocked center from resetting a code', async () => {
    blocked = true;

    await request(app.getHttpServer())
      .post(`/api/centers/me/activation-codes/${codeId}/reset`)
      .expect(403);

    expect(codes.reset).not.toHaveBeenCalled();
  });

  it('acts on a code for the signed center only', async () => {
    await request(app.getHttpServer())
      .post(`/api/centers/me/activation-codes/${codeId}/deactivate`)
      .expect(200);

    expect(codes.deactivate).toHaveBeenCalledWith(signedIdentity, codeId);
  });

  it('refuses an id that is not a code id before touching the database', async () => {
    await request(app.getHttpServer())
      .post('/api/centers/me/activation-codes/LQ-7K2P-94QX/deactivate')
      .expect(400);

    expect(codes.deactivate).not.toHaveBeenCalled();
  });

  it('offers no route to create or delete a code', async () => {
    await request(app.getHttpServer())
      .post('/api/centers/me/activation-codes')
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/centers/me/activation-codes/${codeId}`)
      .expect(404);
  });
});
