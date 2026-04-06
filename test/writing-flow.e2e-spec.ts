/**
 * Full-stack Writing (Schreiben) flow E2E: POST submit + Socket.IO correction_ready.
 *
 * Requires: Supabase (writing_attempts + students), JWT_SECRET, GEMINI_API_KEY recommended.
 *
 * Run (bash):
 *   RUN_WRITING_FLOW_E2E=1 npm run test:e2e -- test/writing-flow.e2e-spec.ts
 * PowerShell:
 *   $env:RUN_WRITING_FLOW_E2E='1'; npm run test:e2e -- test/writing-flow.e2e-spec.ts
 *
 * Optional (flaky if Gemini quota fails):
 *   WRITING_E2E_EXPECT_GEMINI=1 — assert feedback is not the stub string.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/shared/services/database.service';
import { TokenService } from '../src/modules/auth/token.service';
import { AuthExceptionFilter } from '../src/shared/filters/auth-exception.filter';

const runFlowE2E = process.env.RUN_WRITING_FLOW_E2E === '1';
const expectGemini = process.env.WRITING_E2E_EXPECT_GEMINI === '1';

const STUB_FEEDBACK = 'Stub feedback. Echte Korrektur folgt.';

/** Intentionally flawed formal German (grammar / word order). */
const FLAWED_GERMAN =
  'Sehr geehrte Damen und Herren, ich habe geschrieben Sie wegen der Wohnung. Ich möchte mehr Informationen bitte.';

(runFlowE2E ? describe : describe.skip)(
  'Writing flow (E2E — real submit + WebSocket)',
  () => {
    let app: INestApplication<App> | undefined;
    let databaseService: DatabaseService | undefined;
    let tokenService: TokenService;
    let baseUrl: string;
    let socket: Socket | undefined;
    let testStudentId: string;
    let testActivationCode = '';
    let validJwt: string;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      app.useGlobalFilters(new AuthExceptionFilter());
      await app.init();
      await app.listen(0);
      const addr = app.getHttpServer().address();
      if (typeof addr !== 'object' || !addr) {
        throw new Error('Could not read HTTP server address');
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;

      databaseService = moduleFixture.get<DatabaseService>(DatabaseService);
      tokenService = moduleFixture.get<TokenService>(TokenService);
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    beforeEach(async () => {
      testActivationCode = `E2E-W-${Date.now()}`;
      const now = new Date().toISOString();

      const acInsert: Record<string, string> = {
        code: testActivationCode,
        status: 'available',
        created_at: now,
      };

      const { error: acError } = await databaseService!
        .getClient()
        .from('activation_codes')
        .insert(acInsert);

      if (acError) {
        throw new Error(
          `Failed to insert activation_codes: ${acError.message}`,
        );
      }

      const { data: row, error } = await databaseService!
        .getClient()
        .from('students')
        .insert({
          activation_code: testActivationCode,
          first_name: 'E2E',
          last_name: 'Writing',
          email: `${testActivationCode}@test.com`,
          is_registered: true,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (error || !row) {
        throw new Error(
          `Failed to insert test student: ${error?.message ?? 'no row'}`,
        );
      }

      testStudentId = row.id as string;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      await databaseService!
        .getClient()
        .from('activation_codes')
        .update({
          status: 'active',
          student_id: testStudentId,
          claimed_at: now,
          expires_at: expiresAt.toISOString(),
        })
        .eq('code', testActivationCode);

      validJwt = tokenService.generateAccessToken({
        studentId: testStudentId,
        isRegistered: true,
        deviceId: 'test-device',
      });
    });

    afterEach(async () => {
      if (socket?.connected) {
        socket.disconnect();
      }
      socket = undefined;
      if (!databaseService) {
        return;
      }
      await databaseService
        .getClient()
        .from('writing_attempts')
        .delete()
        .eq('student_id', testStudentId);
      await databaseService
        .getClient()
        .from('students')
        .delete()
        .eq('id', testStudentId);
      if (testActivationCode) {
        await databaseService
          .getClient()
          .from('activation_codes')
          .delete()
          .eq('code', testActivationCode);
      }
    });

    it('submits flawed German text and receives correction_ready with matching attemptId', async () => {
      socket = io(`${baseUrl}/writing`, {
        transports: ['websocket'],
        auth: { token: validJwt },
      });

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error('Socket connect timeout (15s)')),
          15_000,
        );
        socket!.once('connect', () => {
          clearTimeout(t);
          resolve();
        });
        socket!.once('connect_error', (err) => {
          clearTimeout(t);
          reject(err);
        });
      });

      const correctionReady = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const t = setTimeout(
            () => reject(new Error('correction_ready timeout (40s)')),
            40_000,
          );
          socket!.once(
            'correction_ready',
            (payload: Record<string, unknown>) => {
              clearTimeout(t);
              resolve(payload);
            },
          );
        },
      );

      const res = await request(app.getHttpServer())
        .post('/api/writing/submit')
        .set('Authorization', `Bearer ${validJwt}`)
        .set('Content-Type', 'application/json')
        .send({ exerciseId: '1', content: FLAWED_GERMAN })
        .expect(201);

      const attemptId = res.body.attemptId as string;
      expect(res.body.status).toBe('pending');
      expect(attemptId).toBeDefined();

      const payload = await correctionReady;

      expect(payload.attemptId).toBe(attemptId);
      expect(payload.exerciseId).toBe('1');
      expect(payload.status).toBe('completed');
      expect(typeof payload.score).toBe('number');
      expect(typeof payload.feedback).toBe('string');
      expect(payload.feedback).toBeTruthy();

      if (expectGemini) {
        expect(payload.feedback).not.toBe(STUB_FEEDBACK);
      }

      const sessionsRes = await request(app.getHttpServer())
        .get('/api/writing/sessions')
        .set('Authorization', `Bearer ${validJwt}`)
        .expect(200);

      const attempts = sessionsRes.body as Array<{
        id: string;
        score?: number;
      }>;
      const found = attempts.find((a) => a.id === attemptId);
      expect(found).toBeDefined();
      expect(found?.score).toBe(payload.score as number);
    }, 45_000);
  },
);
