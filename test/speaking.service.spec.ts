import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SpeakingService } from '../src/modules/speaking/services/speaking.service';
import { DatabaseService } from '../src/shared/services/database.service';

describe('SpeakingService', () => {
  let service: SpeakingService;
  let dbService: DatabaseService;

  const mockDatabaseService = {
    getClient: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeakingService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<SpeakingService>(SpeakingService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startSession', () => {
    it('should successfully create a new session with timer', async () => {
      const studentId = 'student-123';
      const teilNumber = 1;
      const useTimer = true;

      const mockCheckQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'No rows found' },
        }),
      };

      const mockInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { session_id: 'session-123' },
          error: null,
        }),
      };

      const fromMock = jest
        .fn()
        .mockReturnValueOnce(mockCheckQuery)
        .mockReturnValueOnce(mockInsertQuery);

      mockDatabaseService.getClient.mockReturnValue({
        from: fromMock,
      });

      const result = await service.startSession(
        studentId,
        teilNumber,
        useTimer,
      );

      expect(result).toBeDefined();
      expect(result.sessionId).toBe('session-123');
      expect(result.teilNumber).toBe(1);
      expect(result.useTimer).toBe(true);
      expect(result.timeLimit).toBe(240); // 4 minutes for Teil 1
      expect(result.teilInstructions).toBeDefined();
    });

    it('should create session without timer if useTimer is false', async () => {
      const studentId = 'student-123';
      const teilNumber = 2;
      const useTimer = false;

      const mockCheckQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'No rows found' },
        }),
      };

      const mockInsertQuery = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { session_id: 'session-456' },
          error: null,
        }),
      };

      const fromMock = jest
        .fn()
        .mockReturnValueOnce(mockCheckQuery)
        .mockReturnValueOnce(mockInsertQuery);

      mockDatabaseService.getClient.mockReturnValue({
        from: fromMock,
      });

      const result = await service.startSession(
        studentId,
        teilNumber,
        useTimer,
      );

      expect(result.useTimer).toBe(false);
      expect(result.timeLimit).toBeNull();
    });

    it('should throw error for invalid Teil number', async () => {
      const studentId = 'student-123';
      const teilNumber = 4; // Invalid
      const useTimer = true;

      await expect(
        service.startSession(studentId, teilNumber, useTimer),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set correct time limits per Teil', async () => {
      const studentId = 'student-123';
      const useTimer = true;

      const createMockPair = () => {
        const mockCheckQuery = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'No rows found' },
          }),
        };

        const mockInsertQuery = {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { session_id: `session-${Math.random()}`, teil_number: 1 },
            error: null,
          }),
        };

        return jest
          .fn()
          .mockReturnValueOnce(mockCheckQuery)
          .mockReturnValueOnce(mockInsertQuery);
      };

      // Teil 1 = 240s
      mockDatabaseService.getClient.mockReturnValue({ from: createMockPair() });
      let result = await service.startSession(studentId, 1, useTimer);
      expect(result.timeLimit).toBe(240);

      // Teil 2 = 360s
      mockDatabaseService.getClient.mockReturnValue({ from: createMockPair() });
      result = await service.startSession(studentId, 2, useTimer);
      expect(result.timeLimit).toBe(360);

      // Teil 3 = 360s
      mockDatabaseService.getClient.mockReturnValue({ from: createMockPair() });
      result = await service.startSession(studentId, 3, useTimer);
      expect(result.timeLimit).toBe(360);
    });
  });

  describe('pauseSession', () => {
    it('should pause an active session', async () => {
      const sessionId = 'session-123';
      const studentId = 'student-123';

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            session_id: sessionId,
            status: 'active',
            server_start_time: new Date().toISOString(),
            time_limit_seconds: 240,
            use_timer: true,
          },
          error: null,
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      const result = await service.pauseSession(sessionId, studentId);

      expect(result.status).toBe('paused');
      expect(result.pausedAt).toBeDefined();
      expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
      expect(result.remainingSeconds).toBeDefined();
    });

    it('should throw error if session not found', async () => {
      const sessionId = 'non-existent';
      const studentId = 'student-123';

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: new Error('Not found'),
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      await expect(service.pauseSession(sessionId, studentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resumeSession', () => {
    it('should resume a paused session', async () => {
      const sessionId = 'session-123';
      const studentId = 'student-123';

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            session_id: sessionId,
            status: 'paused',
            server_start_time: new Date(Date.now() - 60000).toISOString(),
            time_limit_seconds: 240,
            use_timer: true,
            pause_timestamp: new Date().toISOString(),
            elapsed_time: 60,
          },
          error: null,
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      const result = await service.resumeSession(sessionId, studentId);

      expect(result.status).toBe('active');
      expect(result.resumedAt).toBeDefined();
      expect(result.remainingSeconds).toBeDefined();
    });

    it('should throw error if session not found', async () => {
      const sessionId = 'non-existent';
      const studentId = 'student-123';

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: new Error('Not found'),
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      await expect(service.resumeSession(sessionId, studentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('endSession', () => {
    it('should end a session and mark as evaluable if long enough', async () => {
      const sessionId = 'session-123';
      const studentId = 'student-123';

      // Session started 3 minutes ago = 180 seconds (evaluable, min is 120s)
      const startTime = new Date(Date.now() - 180000);

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            session_id: sessionId,
            teil_number: 1,
            status: 'active',
            server_start_time: startTime.toISOString(),
            elapsed_time: 0,
            use_timer: true,
            time_limit_seconds: 240,
            pause_timestamp: null,
          },
          error: null,
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      const result = await service.endSession(
        sessionId,
        studentId,
        'completed',
      );

      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(120);
      expect(result.isEvaluable).toBe(true);
      expect(result.wordCount).toBe(0); // Placeholder
    });

    it('should end a session but mark as not evaluable if too short', async () => {
      const sessionId = 'session-456';
      const studentId = 'student-123';

      // Session started 30 seconds ago = too short
      const startTime = new Date(Date.now() - 30000);

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: {
            session_id: sessionId,
            teil_number: 1,
            status: 'active',
            server_start_time: startTime.toISOString(),
            elapsed_time: 0,
            use_timer: true,
            time_limit_seconds: 240,
            pause_timestamp: null,
          },
          error: null,
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      const result = await service.endSession(
        sessionId,
        studentId,
        'completed',
      );

      expect(result.isEvaluable).toBe(false);
    });

    it('should throw error if session not found', async () => {
      const sessionId = 'non-existent';
      const studentId = 'student-123';

      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: new Error('Not found'),
        }),
      };

      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue(mockQuery),
      });

      await expect(
        service.endSession(sessionId, studentId, 'completed'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Session state management', () => {
    it('should store and retrieve session state', () => {
      const sessionId = 'session-789';
      const state = {
        sessionId,
        studentId: 'student-123',
        teilNumber: 1,
        status: 'active',
        useTimer: true,
        timeLimit: 240,
        serverStartTime: new Date(),
        elapsedSeconds: 0,
      };

      service.updateSessionState(sessionId, state);
      const retrieved = service.getSessionState(sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved.sessionId).toBe(sessionId);
      expect(retrieved.status).toBe('active');
    });

    it('should update session state', () => {
      const sessionId = 'session-999';
      const initialState = {
        sessionId,
        studentId: 'student-123',
        teilNumber: 1,
        status: 'active',
        useTimer: true,
        timeLimit: 240,
        serverStartTime: new Date(),
        elapsedSeconds: 0,
      };

      service.updateSessionState(sessionId, initialState);
      service.updateSessionState(sessionId, {
        status: 'paused',
        elapsedSeconds: 30,
      });

      const updated = service.getSessionState(sessionId);
      expect(updated.status).toBe('paused');
      expect(updated.elapsedSeconds).toBe(30);
    });

    it('should remove session state', () => {
      const sessionId = 'session-to-remove';
      const state = {
        sessionId,
        studentId: 'student-123',
        teilNumber: 1,
        status: 'active',
        useTimer: true,
        timeLimit: 240,
        serverStartTime: new Date(),
        elapsedSeconds: 0,
      };

      service.updateSessionState(sessionId, state);
      expect(service.getSessionState(sessionId)).toBeDefined();

      service.removeSessionState(sessionId);
      expect(service.getSessionState(sessionId)).toBeUndefined();
    });
  });
});
