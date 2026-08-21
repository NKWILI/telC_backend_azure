import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { WritingController } from '../src/modules/writing/writing.controller';
import { WritingService } from '../src/modules/writing/writing.service';
import { RateLimitService } from '../src/shared/services/rate-limit.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';
import { AccessTokenPayload } from '../src/shared/interfaces/token-payload.interface';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

const defaultPayload: AccessTokenPayload = {
  type: 'access',
  studentId: 'student-1',
  isRegistered: true,
  deviceId: 'device-1',
};

const exerciseResponse = {
  id: 'exercise-1',
  modelltestId: 'modelltest-1',
  title: 'E-Mail',
  instructions: 'Schreiben Sie eine formelle E-Mail.',
};

const sessionsResponse = [
  {
    id: 'attempt-uuid-1',
    date: '2026-03-04T10:00:00.000Z',
    dateLabel: 'Gestern',
    score: 78,
    feedback: 'Gute Struktur.',
    durationSeconds: 420,
  },
];

describe('WritingController (e2e)', () => {
  let app: INestApplication<App>;
  const writingService = {
    getExerciseByModelltest: jest.fn().mockResolvedValue(exerciseResponse),
    getSessions: jest.fn().mockResolvedValue(sessionsResponse),
    submit: jest.fn().mockResolvedValue({
      attemptId: 'attempt-uuid-new',
      status: 'pending',
      message: 'Submission received. Correction in progress.',
    }),
  };

  const rateLimitService = {
    checkWritingSubmitLimit: jest.fn(),
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
    writingService.getExerciseByModelltest.mockResolvedValue(exerciseResponse);
    writingService.getSessions.mockResolvedValue(sessionsResponse);
    writingService.submit.mockResolvedValue({
      attemptId: 'attempt-uuid-new',
      status: 'pending',
      message: 'Submission received. Correction in progress.',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WritingController],
      providers: [
        { provide: WritingService, useValue: writingService },
        { provide: RateLimitService, useValue: rateLimitService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardThatRequiresAuth)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/writing/exercise returns the exercise for a Modelltest', async () => {
    await request(app.getHttpServer())
      .get('/api/writing/exercise?modelltest=1')
      .set('Authorization', 'Bearer fake-token')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject(exerciseResponse);
      });
    expect(writingService.getExerciseByModelltest).toHaveBeenCalledWith(1);
  });

  it('GET /api/writing/sessions returns 200 and array', async () => {
    await request(app.getHttpServer())
      .get('/api/writing/sessions')
      .set('Authorization', 'Bearer fake-token')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toHaveProperty('id', 'attempt-uuid-1');
        expect(res.body[0]).toHaveProperty('score', 78);
        expect(res.body[0]).toHaveProperty('feedback');
      });
  });

  it('GET /api/writing/exercise without token returns 401', async () => {
    await request(app.getHttpServer())
      .get('/api/writing/exercise?modelltest=1')
      .expect(401);
  });

  it('GET /api/writing/sessions without token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/writing/sessions').expect(401);
  });

  it('POST /api/writing/submit returns 201 with attemptId and status', async () => {
    await request(app.getHttpServer())
      .post('/api/writing/submit')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'application/json')
      .send({
        exerciseId: '1',
        content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.attemptId).toBe('attempt-uuid-new');
        expect(res.body.status).toBe('pending');
      });
  });

  it('POST /api/writing/submit with missing exerciseId returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/writing/submit')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'application/json')
      .send({ content: 'Some text' })
      .expect(400);
  });

  it('POST /api/writing/submit with missing content returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/writing/submit')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'application/json')
      .send({ exerciseId: '1' })
      .expect(400);
  });

  it('POST /api/writing/submit when rate limit exceeded returns 429', async () => {
    rateLimitService.checkWritingSubmitLimit.mockImplementationOnce(() => {
      throw new HttpException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    });

    await request(app.getHttpServer())
      .post('/api/writing/submit')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'application/json')
      .send({ exerciseId: '1', content: 'Some content' })
      .expect(429);
  });

  it('POST /api/writing/submit when exercise not found returns 404 with messageKey', async () => {
    writingService.submit.mockRejectedValueOnce(
      new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Exercise type not found',
        messageKey: 'writingExerciseNotFound',
      }),
    );

    await request(app.getHttpServer())
      .post('/api/writing/submit')
      .set('Authorization', 'Bearer fake-token')
      .set('Content-Type', 'application/json')
      .send({ exerciseId: '99', content: 'Some content' })
      .expect(404)
      .expect((res) => {
        expect(res.body.messageKey).toBe('writingExerciseNotFound');
      });
  });
});
