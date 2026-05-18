import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { LesenController } from '../src/modules/lesen/lesen.controller';
import { LesenService } from '../src/modules/lesen/lesen.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';
import { AccessTokenPayload } from '../src/shared/interfaces/token-payload.interface';

const defaultPayload: AccessTokenPayload = {
  studentId: 'student-1',
  isRegistered: true,
  deviceId: 'device-1',
};

const exerciseResponse = {
  contentRevision: 'lesen-v1',
  issuedAt: '2026-05-18T12:00:00.000Z',
  teil1: { label: 'Teil 1' },
  teil2: { label: 'Teil 2' },
  teil3: { label: 'Teil 3' },
};

const submitResponse = { score: 80 };

describe('LesenController (e2e)', () => {
  let app: INestApplication<App>;

  const lesenService = {
    getTeil1Exercise: jest.fn().mockResolvedValue(exerciseResponse.teil1),
    getTeil2Exercise: jest.fn().mockResolvedValue({
      contentRevision: exerciseResponse.contentRevision,
      issuedAt: exerciseResponse.issuedAt,
      teil2: exerciseResponse.teil2,
    }),
    getTeil3Exercise: jest.fn().mockResolvedValue(exerciseResponse.teil3),
    submitTeil2: jest.fn().mockResolvedValue(submitResponse),
  };

  const guardThatRequiresAuth = {
    canActivate: (context: any) => {
      const request = context.switchToHttp().getRequest();
      const authHeader = request.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
      }
      request.student = defaultPayload;
      return true;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LesenController],
      providers: [{ provide: LesenService, useValue: lesenService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardThatRequiresAuth)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/reading/exercise returns 200 with auth', async () => {
    await request(app.getHttpServer())
      .get('/api/reading/exercise')
      .set('Authorization', 'Bearer fake-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('contentRevision', 'lesen-v1');
        expect(res.body).toHaveProperty('issuedAt');
        expect(res.body).toHaveProperty('teil1');
        expect(res.body).toHaveProperty('teil2');
        expect(res.body).toHaveProperty('teil3');
      });
  });

  it('GET /api/reading/exercise without token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/reading/exercise').expect(401);
  });

  it('POST /api/reading/submit returns 201 with auth', async () => {
    await request(app.getHttpServer())
      .post('/api/reading/submit')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'application/json')
      .send({
        id: 'attempt-1',
        exercise_type_id: 'reading',
        teil_id: '2',
        score_percent: 80,
        tested_at: '2026-05-18T12:00:00.000Z',
        answers: { q1: 'a' },
      })
      .expect(201)
      .expect((res) => {
        expect(res.body).toEqual(submitResponse);
      });
  });

  it('POST /api/reading/submit without token returns 401', async () => {
    await request(app.getHttpServer())
      .post('/api/reading/submit')
      .set('Content-Type', 'application/json')
      .send({
        id: 'attempt-1',
        exercise_type_id: 'reading',
        teil_id: '2',
        score_percent: 80,
        tested_at: '2026-05-18T12:00:00.000Z',
        answers: { q1: 'a' },
      })
      .expect(401);
  });
});
