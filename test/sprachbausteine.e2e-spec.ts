import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SprachbausteineController } from '../src/modules/sprachbausteine/sprachbausteine.controller';
import { SprachbausteineService } from '../src/modules/sprachbausteine/sprachbausteine.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

const exerciseResponse = {
  contentRevision: 'modelltest-1-v1',
  issuedAt: '2026-08-21T12:00:00.000Z',
  teil1: { label: 'Sprachbausteine, Teil 1' },
  teil2: { label: 'Sprachbausteine, Teil 2' },
};

describe('SprachbausteineController (e2e)', () => {
  let app: INestApplication<App>;

  const sprachbausteineService = {
    getExercise: jest.fn().mockResolvedValue(exerciseResponse),
    getSessions: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SprachbausteineController],
      providers: [
        { provide: SprachbausteineService, useValue: sprachbausteineService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    // Must mirror main.ts. Without the global ValidationPipe this suite does
    // not represent production: transform: true coerces query params before
    // any parameter-level pipe runs, which is precisely what hid this bug.
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('defaults to Modelltest 1 when the param is omitted', async () => {
    await request(app.getHttpServer())
      .get('/api/sprachbausteine/exercise')
      .expect(200);

    expect(sprachbausteineService.getExercise).toHaveBeenCalledWith(1);
  });

  it('requests the Modelltest named in the query', async () => {
    await request(app.getHttpServer())
      .get('/api/sprachbausteine/exercise?modelltest=2')
      .expect(200);

    expect(sprachbausteineService.getExercise).toHaveBeenCalledWith(2);
  });

  it('rejects a non-numeric modelltest instead of serving Modelltest 1', async () => {
    await request(app.getHttpServer())
      .get('/api/sprachbausteine/exercise?modelltest=abc')
      .expect(400);

    expect(sprachbausteineService.getExercise).not.toHaveBeenCalled();
  });

  it('rejects a negative modelltest', async () => {
    await request(app.getHttpServer())
      .get('/api/sprachbausteine/exercise?modelltest=-1')
      .expect(400);

    expect(sprachbausteineService.getExercise).not.toHaveBeenCalled();
  });

  it('rejects a decimal modelltest', async () => {
    await request(app.getHttpServer())
      .get('/api/sprachbausteine/exercise?modelltest=1.5')
      .expect(400);

    expect(sprachbausteineService.getExercise).not.toHaveBeenCalled();
  });
});
