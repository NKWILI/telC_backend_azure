import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SpeakingService } from '../src/modules/speaking/services/speaking.service';
import { PrismaService } from '../src/shared/services/prisma.service';

describe('SpeakingService', () => {
  let service: SpeakingService;

  const mockPrismaService = {
    examSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    teilTranscript: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeakingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SpeakingService>(SpeakingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startSession', () => {
    it('should successfully create a new session with timer', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue(null);
      mockPrismaService.examSession.create.mockResolvedValue({ session_id: 'session-123' });

      const result = await service.startSession('student-123', 1, true);

      expect(result).toBeDefined();
      expect(result.sessionId).toBe('session-123');
      expect(result.teilNumber).toBe(1);
      expect(result.useTimer).toBe(true);
      expect(result.timeLimit).toBe(240);
      expect(result.teilInstructions).toBeDefined();
    });

    it('should create session without timer if useTimer is false', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue(null);
      mockPrismaService.examSession.create.mockResolvedValue({ session_id: 'session-456' });

      const result = await service.startSession('student-123', 2, false);

      expect(result.useTimer).toBe(false);
      expect(result.timeLimit).toBeNull();
    });

    it('should throw error for invalid Teil number', async () => {
      await expect(service.startSession('student-123', 4, true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should set correct time limits per Teil', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue(null);
      mockPrismaService.examSession.create.mockResolvedValue({ session_id: 'session-1' });

      let result = await service.startSession('student-123', 1, true);
      expect(result.timeLimit).toBe(240);

      mockPrismaService.examSession.create.mockResolvedValue({ session_id: 'session-2' });
      result = await service.startSession('student-123', 2, true);
      expect(result.timeLimit).toBe(360);

      mockPrismaService.examSession.create.mockResolvedValue({ session_id: 'session-3' });
      result = await service.startSession('student-123', 3, true);
      expect(result.timeLimit).toBe(360);
    });

    it('should close existing active session before creating a new one', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue({
        session_id: 'old-session',
        status: 'active',
      });
      mockPrismaService.examSession.update.mockResolvedValue({});
      mockPrismaService.examSession.create.mockResolvedValue({ session_id: 'new-session' });

      const result = await service.startSession('student-123', 1, true);

      expect(mockPrismaService.examSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { session_id: 'old-session' } }),
      );
      expect(result.sessionId).toBe('new-session');
    });
  });

  describe('pauseSession', () => {
    it('should pause an active session', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue({
        session_id: 'session-123',
        status: 'active',
        server_start_time: new Date(Date.now() - 10000),
        time_limit_seconds: 240,
        use_timer: true,
      });
      mockPrismaService.examSession.update.mockResolvedValue({});

      const result = await service.pauseSession('session-123', 'student-123');

      expect(result.status).toBe('paused');
      expect(result.pausedAt).toBeDefined();
      expect(result.elapsedSeconds).toBeGreaterThanOrEqual(0);
      expect(result.remainingSeconds).toBeDefined();
    });

    it('should throw error if session not found', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue(null);

      await expect(service.pauseSession('non-existent', 'student-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resumeSession', () => {
    it('should resume a paused session', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue({
        session_id: 'session-123',
        status: 'paused',
        pause_timestamp: new Date(Date.now() - 5000),
        elapsed_time: 60,
        time_limit_seconds: 240,
        use_timer: true,
      });
      mockPrismaService.examSession.update.mockResolvedValue({});

      const result = await service.resumeSession('session-123', 'student-123');

      expect(result.status).toBe('active');
      expect(result.resumedAt).toBeDefined();
      expect(result.remainingSeconds).toBeDefined();
    });

    it('should throw error if session not found', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue(null);

      await expect(service.resumeSession('non-existent', 'student-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('endSession', () => {
    it('should end a session and mark as evaluable if long enough', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue({
        session_id: 'session-123',
        teil_number: 1,
        status: 'active',
        server_start_time: new Date(Date.now() - 180000),
        elapsed_time: 0,
        use_timer: true,
        time_limit_seconds: 240,
        pause_timestamp: null,
      });
      mockPrismaService.examSession.update.mockResolvedValue({});
      mockPrismaService.teilTranscript.findFirst.mockResolvedValue(null);

      const result = await service.endSession('session-123', 'student-123', 'completed');

      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(120);
      expect(result.isEvaluable).toBe(true);
      expect(result.wordCount).toBe(0);
    });

    it('should end a session but mark as not evaluable if too short', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue({
        session_id: 'session-456',
        teil_number: 1,
        status: 'active',
        server_start_time: new Date(Date.now() - 30000),
        elapsed_time: 0,
        use_timer: true,
        time_limit_seconds: 240,
        pause_timestamp: null,
      });
      mockPrismaService.examSession.update.mockResolvedValue({});
      mockPrismaService.teilTranscript.findFirst.mockResolvedValue(null);

      const result = await service.endSession('session-456', 'student-123', 'completed');

      expect(result.isEvaluable).toBe(false);
    });

    it('should throw error if session not found', async () => {
      mockPrismaService.examSession.findFirst.mockResolvedValue(null);

      await expect(
        service.endSession('non-existent', 'student-123', 'completed'),
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
      expect(retrieved!.sessionId).toBe(sessionId);
      expect(retrieved!.status).toBe('active');
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
      service.updateSessionState(sessionId, { status: 'paused', elapsedSeconds: 30 });

      const updated = service.getSessionState(sessionId);
      expect(updated!.status).toBe('paused');
      expect(updated!.elapsedSeconds).toBe(30);
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
