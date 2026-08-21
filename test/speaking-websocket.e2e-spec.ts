import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/services/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';
import { createGlobalValidationPipe } from '../src/shared/pipes/global-validation.pipe';

const runSpeakingE2E = process.env.RUN_SPEAKING_E2E === '1';

(runSpeakingE2E ? describe : describe.skip)(
  'Speaking WebSocket Gateway (E2E)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let tokenService: TokenService;
    let socket: Socket;
    let testStudentId: string;
    let testSessionId: string;
    let validJwt: string;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();

      app.useGlobalPipes(createGlobalValidationPipe());
      await app.init();
      await app.listen(3000);

      prisma = moduleFixture.get<PrismaService>(PrismaService);
      tokenService = moduleFixture.get<TokenService>(TokenService);
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(async () => {
      // Create test student
      testStudentId = `test-student-${Date.now()}`;
      await prisma.student.create({
        data: {
          id: testStudentId,
          email: `${testStudentId}@test.com`,
          password_hash: 'test_hash',
        },
      });

      // Create test session
      const session = await prisma.examSession.create({
        data: {
          student_id: testStudentId,
          teil_number: 1,
          status: 'active',
          server_start_time: new Date(),
          use_timer: true,
          elapsed_time: 0,
        },
      });

      testSessionId = session.session_id;

      // Generate valid JWT
      validJwt = tokenService.generateAccessToken({
        studentId: testStudentId,
        isRegistered: true,
        deviceId: 'test-device',
      });
    });

    afterEach(async () => {
      // Disconnect socket if connected
      if (socket?.connected) {
        socket.disconnect();
      }

      // Cleanup database
      await prisma.examSession.deleteMany({
        where: { session_id: testSessionId },
      });
      await prisma.student.deleteMany({ where: { id: testStudentId } });
    });

    describe('Connection Lifecycle', () => {
      it('should connect with valid sessionId and token', (done) => {
        socket = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
          auth: { token: validJwt },
        });

        socket.on('session_ready', (payload) => {
          expect(payload).toHaveProperty('sessionId', testSessionId);
          expect(payload).toHaveProperty('teilNumber', 1);
          expect(payload).toHaveProperty('status', 'ready');
          expect(socket.connected).toBeTruthy();
          done();
        });

        socket.on('connection_error', (error) => {
          done(new Error(`Connection failed: ${error.message}`));
        });
      });

      it('should reject connection without sessionId', (done) => {
        socket = io('http://localhost:3000/speaking', {
          auth: { token: validJwt },
        });

        socket.on('connection_error', (error) => {
          expect(error.code).toBe(4001);
          expect(error.message).toContain('sessionId');
          done();
        });

        socket.on('session_ready', () => {
          done(new Error('Should not have connected'));
        });
      });

      it('should reject connection without authentication token', (done) => {
        socket = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
        });

        socket.on('connection_error', (error) => {
          expect(error.code).toBe(4008);
          expect(error.message).toContain('Authentication');
          done();
        });

        socket.on('session_ready', () => {
          done(new Error('Should not have connected'));
        });
      });

      it('should reject connection with invalid sessionId', (done) => {
        socket = io('http://localhost:3000/speaking', {
          query: { sessionId: 'invalid-session-id-12345' },
          auth: { token: validJwt },
        });

        socket.on('connection_error', (error) => {
          expect(error.code).toBe(4003);
          expect(error.message).toContain('not found');
          done();
        });

        socket.on('session_ready', () => {
          done(new Error('Should not have connected'));
        });
      });

      it('should reject connection if session belongs to different student', async () => {
        // Create session for different student
        const otherStudent = await prisma.student.create({
          data: { email: `other-${Date.now()}@test.com` },
        });
        const otherSession = await prisma.examSession.create({
          data: {
            student_id: otherStudent.id,
            teil_number: 1,
            status: 'active',
            server_start_time: new Date(),
            use_timer: true,
          },
        });

        const done = new Promise<void>((resolve, reject) => {
          socket = io('http://localhost:3000/speaking', {
            query: { sessionId: otherSession.session_id },
            auth: { token: validJwt },
          });

          socket.on('connection_error', (error) => {
            expect(error.code).toBe(4010);
            expect(error.message).toContain('does not belong');
            resolve();
          });

          socket.on('session_ready', () => {
            reject(new Error('Should not have connected'));
          });
        });

        await done;

        // Cleanup
        await prisma.examSession.delete({
          where: { session_id: otherSession.session_id },
        });
        await prisma.student.delete({ where: { id: otherStudent.id } });
      });
    });

    describe('Reconnection and Grace Period', () => {
      it('should allow reconnection during 5-second grace period', (done) => {
        // First connection
        const socket1 = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
          auth: { token: validJwt },
        });

        socket1.on('session_ready', () => {
          // Disconnect after 500ms
          setTimeout(() => {
            socket1.disconnect();

            // Reconnect after 2 seconds (within grace period)
            setTimeout(() => {
              socket = io('http://localhost:3000/speaking', {
                query: { sessionId: testSessionId },
                auth: { token: validJwt },
              });

              socket.on('session_ready', (payload) => {
                expect(payload.status).toBe('reconnected');
                expect(payload.message).toContain('grace period');
                done();
              });

              socket.on('connection_error', (error) => {
                done(new Error(`Reconnection failed: ${error.message}`));
              });
            }, 2000);
          }, 500);
        });
      }, 10000);

      it('should mark session as interrupted after grace period expires', (done) => {
        // First connection
        const socket1 = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
          auth: { token: validJwt },
        });

        socket1.on('session_ready', () => {
          // Disconnect
          socket1.disconnect();

          // Wait 6 seconds (grace period is 5 seconds)
          setTimeout(async () => {
            // Check database status
            const session = await prisma.examSession.findUnique({
              where: { session_id: testSessionId },
              select: { status: true },
            });

            expect(session).toBeDefined();
            expect(session?.status).toBe('interrupted');
            done();
          }, 6000);
        });
      }, 10000);
    });

    describe('Error Handling', () => {
      it('should emit error with session context on invalid audio chunk', (done) => {
        socket = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
          auth: { token: validJwt },
        });

        socket.on('session_ready', () => {
          // Send invalid audio chunk (not Base64)
          socket.emit('audio_chunk', {
            data: 'invalid-not-base64!!!',
            timestamp: new Date().toISOString(),
          });

          socket.on('error', (error) => {
            expect(error.code).toBe('INVALID_BASE64');
            expect(error).toHaveProperty('sessionId', testSessionId);
            expect(error).toHaveProperty('clientId');
            done();
          });
        });
      }, 5000);

      it('should reject oversized audio chunks', (done) => {
        socket = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
          auth: { token: validJwt },
        });

        socket.on('session_ready', () => {
          // Create 200KB Base64 string (exceeds 100KB limit)
          const largeData = Buffer.alloc(150000).toString('base64');

          socket.emit('audio_chunk', {
            data: largeData,
            timestamp: new Date().toISOString(),
          });

          socket.on('error', (error) => {
            expect(error.code).toBe('AUDIO_CHUNK_TOO_LARGE');
            expect(error).toHaveProperty('sessionId');
            done();
          });
        });
      }, 5000);

      it('should enforce rate limit on audio chunks', (done) => {
        socket = io('http://localhost:3000/speaking', {
          query: { sessionId: testSessionId },
          auth: { token: validJwt },
        });

        socket.on('session_ready', () => {
          // Send 51 chunks rapidly (exceeds 50/second limit)
          const validBase64 = Buffer.from('test audio').toString('base64');

          for (let i = 0; i < 51; i++) {
            socket.emit('audio_chunk', {
              data: validBase64,
              timestamp: new Date().toISOString(),
            });
          }

          socket.on('error', (error) => {
            if (error.code === 'RATE_LIMIT_EXCEEDED') {
              expect(error).toHaveProperty('sessionId');
              done();
            }
          });
        });
      }, 5000);
    });
  },
);
