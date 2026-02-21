import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/shared/services/database.service';
import { TokenService } from '../src/modules/auth/token.service';

describe('Speaking WebSocket Gateway (E2E)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
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
    await app.init();
    await app.listen(3000);

    databaseService = moduleFixture.get<DatabaseService>(DatabaseService);
    tokenService = moduleFixture.get<TokenService>(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Create test student
    testStudentId = `test-student-${Date.now()}`;
    const { data: student } = await databaseService
      .getClient()
      .from('students')
      .insert({
        id: testStudentId,
        email: `${testStudentId}@test.com`,
        password_hash: 'test_hash',
        registration_number: `REG${Date.now()}`,
      })
      .select()
      .single();

    // Create test session
    const { data: session } = await databaseService
      .getClient()
      .from('exam_sessions')
      .insert({
        student_id: testStudentId,
        teil_number: 1,
        status: 'active',
        server_start_time: new Date().toISOString(),
        use_timer: true,
        elapsed_time: 0,
      })
      .select()
      .single();

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
    await databaseService
      .getClient()
      .from('exam_sessions')
      .delete()
      .eq('session_id', testSessionId);
    await databaseService
      .getClient()
      .from('students')
      .delete()
      .eq('id', testStudentId);
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
      const { data: otherSession } = await databaseService
        .getClient()
        .from('exam_sessions')
        .insert({
          student_id: 'different-student-123',
          teil_number: 1,
          status: 'active',
          server_start_time: new Date().toISOString(),
          use_timer: true,
        })
        .select()
        .single();

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
      await databaseService
        .getClient()
        .from('exam_sessions')
        .delete()
        .eq('session_id', otherSession.session_id);
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
          const { data: session } = await databaseService
            .getClient()
            .from('exam_sessions')
            .select('status')
            .eq('session_id', testSessionId)
            .single();

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
});
