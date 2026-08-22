/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterProfileController } from '../src/modules/centers/center-profile.controller';
import { CenterProfileService } from '../src/modules/centers/center-profile.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('CenterProfileController contract', () => {
  const signedIdentity = {
    type: 'access',
    actorType: 'CENTER_USER',
    centerUserId: 'owner-1',
    centerId: 'center-1',
    deviceId: 'browser-1',
    sessionId: 'center-session-1',
  };
  const profile = {
    centerUser: {
      id: 'owner-1',
      role: 'OWNER',
      firstName: 'Alain',
      lastName: 'Ngeukeu',
      email: 'manager@example.com',
      phone: '+237690000000',
      emailVerified: true,
    },
    center: {
      id: 'center-1',
      name: 'Goethe Language Center',
      country: 'Cameroon',
      city: 'Douala',
      logoUrl: 'https://cdn.example.com/center.webp',
    },
  };

  let app: INestApplication<App>;
  let profileService: { getProfile: jest.Mock; updateProfile: jest.Mock };

  beforeEach(async () => {
    profileService = {
      getProfile: jest.fn().mockResolvedValue(profile),
      updateProfile: jest.fn().mockResolvedValue(profile),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterProfileController],
      providers: [{ provide: CenterProfileService, useValue: profileService }],
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
  });

  it('returns the profile for the signed-in center only', async () => {
    await request(app.getHttpServer())
      .get('/api/centers/me')
      .expect(200)
      .expect(profile);

    expect(profileService.getProfile).toHaveBeenCalledWith(signedIdentity);
  });

  it('updates allowlisted fields, scoped by the signed identity', async () => {
    await request(app.getHttpServer())
      .patch('/api/centers/me')
      .send({ city: ' Yaounde ', phone: ' +237690000001 ' })
      .expect(200);

    expect(profileService.updateProfile).toHaveBeenCalledWith(signedIdentity, {
      city: 'Yaounde',
      phone: '+237690000001',
    });
  });

  // An empty body is a business rule, not a shape rule: every field is
  // legitimately optional, so `@IsOptional()` short-circuits any DTO-level
  // check. The service owns it (see center-profile.service.spec) and this
  // asserts the resulting contract on the wire.
  it('surfaces the service rejection of an empty patch as a 400', async () => {
    profileService.updateProfile.mockRejectedValue(
      new BadRequestException('NO_PROFILE_FIELDS_SUPPLIED'),
    );

    const response = await request(app.getHttpServer())
      .patch('/api/centers/me')
      .send({})
      .expect(400);

    expect(response.body.error).toBe('NO_PROFILE_FIELDS_SUPPLIED');
  });

  it.each([
    ['a client-supplied center id', { centerId: 'attacker-center' }],
    ['a client-supplied center user id', { id: 'owner-2' }],
    ['a role escalation', { role: 'OWNER' }],
    ['a verification flag', { emailVerified: true }],
    ['an email change', { email: 'attacker@example.com' }],
    ['a password change', { password: 'new-password' }],
  ])('rejects %s in the patch body', async (_case, body) => {
    const response = await request(app.getHttpServer())
      .patch('/api/centers/me')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(profileService.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects a non-HTTPS logo url', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/centers/me')
      .send({ logoUrl: 'http://cdn.example.com/logo.webp' })
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(profileService.updateProfile).not.toHaveBeenCalled();
  });
});
