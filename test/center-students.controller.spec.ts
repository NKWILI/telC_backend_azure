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
import { ProgressService } from '../src/modules/progress/progress.service';
import { CenterAuthGuard } from '../src/modules/centers/guards/center-auth.guard';
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
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    lastSeenAt: new Date('2026-08-23T00:00:00.000Z'),
  };

  let app: INestApplication<App>;
  let students: Record<string, jest.Mock>;
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
    };

    const module = await Test.createTestingModule({
      controllers: [CenterStudentsController],
      providers: [
        { provide: CenterStudentsService, useValue: students },
        { provide: ProgressService, useValue: { forCenter: jest.fn() } },
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

  describe('moving a student between tiers over HTTP', () => {
    it('passes the tier through', async () => {
      await http()
        .patch('/api/centers/me/students/student-1')
        .send({ tier: 'PRO' })
        .expect(200);

      expect(students.update).toHaveBeenCalledWith(
        signedIdentity,
        'student-1',
        { tier: 'PRO' },
      );
    });

    it.each(['GOLD', 'pro', '', 3])('rejects %s as a tier', async (tier) => {
      await http()
        .patch('/api/centers/me/students/student-1')
        .send({ tier })
        .expect(400);

      expect(students.update).not.toHaveBeenCalled();
    });

    it('surfaces a full target tier as 403, naming the tier', async () => {
      students.update.mockRejectedValue(
        new ForbiddenException({ message: 'SEAT_LIMIT_REACHED', tier: 'PRO' }),
      );

      const response = await http()
        .patch('/api/centers/me/students/student-1')
        .send({ tier: 'PRO' })
        .expect(403);

      expect(response.body.error).toBe('SEAT_LIMIT_REACHED');
      // The detail that makes the refusal actionable has to survive the
      // exception filter, or a dashboard cannot say which tier to buy.
      expect(response.body.tier).toBe('PRO');
    });

    it('surfaces an unheld target tier as 403, naming the tier', async () => {
      students.update.mockRejectedValue(
        new ForbiddenException({ message: 'TIER_NOT_HELD', tier: 'PREMIUM' }),
      );

      const response = await http()
        .patch('/api/centers/me/students/student-1')
        .send({ tier: 'PREMIUM' })
        .expect(403);

      expect(response.body.error).toBe('TIER_NOT_HELD');
      expect(response.body.tier).toBe('PREMIUM');
    });
  });

  it('removes a student, freeing the seat', async () => {
    await http()
      .delete('/api/centers/me/students/student-1')
      .expect(200)
      .expect({ removed: true });

    expect(students.remove).toHaveBeenCalledWith(signedIdentity, 'student-1');
  });

  // Students now arrive by redeeming a code (D1, D17). The routes that created
  // them and minted per-student keys are removed, not merely unused (D20).
  it.each([
    ['post', '/api/centers/me/students'],
    ['post', '/api/centers/me/students/student-1/activation-key'],
    ['delete', '/api/centers/me/students/student-1/activation-key'],
  ] as const)('no longer serves %s %s', async (method, path) => {
    await http()[method](path).expect(404);
  });

  it('refuses every route without a center token', async () => {
    guardAllows = false;

    await http().get('/api/centers/me/students').expect(403);
    await http().delete('/api/centers/me/students/student-1').expect(403);
    expect(students.list).not.toHaveBeenCalled();
    expect(students.remove).not.toHaveBeenCalled();
  });
});
