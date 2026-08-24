/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { CenterStudentsController } from '../src/modules/centers/center-students.controller';
import { CenterStudentsService } from '../src/modules/centers/center-students.service';
import { StudentProvisioningService } from '../src/modules/centers/student-provisioning.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
import { CenterSubscriptionGuard } from '../src/modules/centers/guards/center-subscription.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

describe('CenterStudentsController contract', () => {
  const signedIdentity = {
    type: 'access',
    actorType: 'CENTER_USER',
    centerUserId: 'owner-1',
    centerId: 'center-1',
    deviceId: 'browser-1',
    sessionId: 'center-session-1',
  };

  const student = {
    id: 'student-1',
    firstName: 'Awa',
    lastName: 'Mbarga',
    email: 'awa@example.com',
    phone: '+237690000000',
    activated: false,
    activatedAt: null,
    activationKeyExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    lastSeenAt: new Date('2026-08-23T00:00:00.000Z'),
  };

  const validBody = {
    firstName: '  Awa  ',
    lastName: ' Mbarga ',
    email: ' Awa@Example.COM ',
    phone: ' +237690000000 ',
  };

  let app: INestApplication<App>;
  let students: Record<string, jest.Mock>;
  let provisioning: { provision: jest.Mock };
  let guardAllows: boolean;

  beforeEach(async () => {
    guardAllows = true;
    students = {
      list: jest.fn().mockResolvedValue({
        students: [student],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      get: jest.fn().mockResolvedValue(student),
      update: jest.fn().mockResolvedValue(student),
      remove: jest.fn().mockResolvedValue({ removed: true }),
      issueActivationKey: jest.fn().mockResolvedValue({
        activationKey: 'raw-key',
        activationKeyExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
      revokeActivationKey: jest.fn().mockResolvedValue({ revoked: true }),
    };
    provisioning = {
      provision: jest.fn().mockResolvedValue({
        ...student,
        activationKey: 'raw-key',
        activationKeyExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    };

    const module = await Test.createTestingModule({
      controllers: [CenterStudentsController],
      providers: [
        { provide: CenterStudentsService, useValue: students },
        { provide: StudentProvisioningService, useValue: provisioning },
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
      // This spec is about the controller contract. Whether the center is
      // entitled to provision is center-subscription.guard.spec's subject,
      // and which routes it protects is center-blocked-surface.spec's.
      .overrideGuard(CenterSubscriptionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('lists students for the signed center', async () => {
    await http().get('/api/centers/me/students').expect(200);

    expect(students.list).toHaveBeenCalledWith(
      signedIdentity,
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it('accepts pagination from the query string', async () => {
    await http().get('/api/centers/me/students?page=3&pageSize=50').expect(200);

    expect(students.list).toHaveBeenCalledWith(
      signedIdentity,
      expect.objectContaining({ page: 3, pageSize: 50 }),
    );
  });

  it('caps pageSize so one request cannot pull an entire roster', async () => {
    const response = await http()
      .get('/api/centers/me/students?pageSize=5000')
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('provisions a student with normalized input', async () => {
    await http().post('/api/centers/me/students').send(validBody).expect(201);

    expect(provisioning.provision).toHaveBeenCalledWith(signedIdentity, {
      firstName: 'Awa',
      lastName: 'Mbarga',
      email: 'awa@example.com',
      phone: '+237690000000',
    });
  });

  it('returns the activation key once, on provisioning', async () => {
    const response = await http()
      .post('/api/centers/me/students')
      .send(validBody)
      .expect(201);

    expect(response.body.activationKey).toBe('raw-key');
  });

  it.each([
    ['a missing email', { ...validBody, email: undefined }],
    ['an invalid email', { ...validBody, email: 'not-an-email' }],
    ['a missing first name', { ...validBody, firstName: '  ' }],
    ['a client-supplied center id', { ...validBody, centerId: 'other-center' }],
    ['a client-supplied password', { ...validBody, password: 'hunter2' }],
    ['a client-supplied activation key', { ...validBody, activationKey: 'x' }],
    [
      'a client-supplied activated flag',
      { ...validBody, activatedAt: '2026-01-01' },
    ],
  ])('rejects %s before reaching the service', async (_case, body) => {
    const response = await http()
      .post('/api/centers/me/students')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(provisioning.provision).not.toHaveBeenCalled();
  });

  it('surfaces a full center as 403 with a distinct code', async () => {
    provisioning.provision.mockRejectedValue(
      new ForbiddenException('SEAT_LIMIT_REACHED'),
    );

    const response = await http()
      .post('/api/centers/me/students')
      .send(validBody)
      .expect(403);

    expect(response.body.error).toBe('SEAT_LIMIT_REACHED');
  });

  it('answers 404 for another center student', async () => {
    students.get.mockRejectedValue(new NotFoundException('STUDENT_NOT_FOUND'));

    const response = await http()
      .get('/api/centers/me/students/other-1')
      .expect(404);

    expect(response.body.error).toBe('STUDENT_NOT_FOUND');
  });

  it('updates only allowlisted fields', async () => {
    await http()
      .patch('/api/centers/me/students/student-1')
      .send({ firstName: ' Awa-Marie ' })
      .expect(200);

    expect(students.update).toHaveBeenCalledWith(signedIdentity, 'student-1', {
      firstName: 'Awa-Marie',
    });
  });

  it.each([
    ['an email change', { email: 'attacker@example.com' }],
    ['a password', { password: 'hunter2' }],
    ['a center reassignment', { centerId: 'other-center' }],
    ['an activation flag', { activatedAt: '2026-01-01' }],
  ])('rejects %s in a patch', async (_case, body) => {
    const response = await http()
      .patch('/api/centers/me/students/student-1')
      .send(body)
      .expect(400);

    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(students.update).not.toHaveBeenCalled();
  });

  it('removes a student, freeing the seat', async () => {
    await http()
      .delete('/api/centers/me/students/student-1')
      .expect(200)
      .expect({ removed: true });

    expect(students.remove).toHaveBeenCalledWith(signedIdentity, 'student-1');
  });

  it('mints a replacement activation key', async () => {
    const response = await http()
      .post('/api/centers/me/students/student-1/activation-key')
      .expect(201);

    expect(response.body.activationKey).toBe('raw-key');
    expect(students.issueActivationKey).toHaveBeenCalledWith(
      signedIdentity,
      'student-1',
    );
  });

  it('revokes an outstanding activation key', async () => {
    await http()
      .delete('/api/centers/me/students/student-1/activation-key')
      .expect(200)
      .expect({ revoked: true });
  });

  it('refuses every route without a center token', async () => {
    guardAllows = false;

    await http().get('/api/centers/me/students').expect(403);
    await http().post('/api/centers/me/students').send(validBody).expect(403);
    await http().delete('/api/centers/me/students/student-1').expect(403);
    expect(students.list).not.toHaveBeenCalled();
    expect(provisioning.provision).not.toHaveBeenCalled();
  });
});
