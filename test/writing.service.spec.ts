import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WritingService } from '../src/modules/writing/writing.service';
import { DatabaseService } from '../src/shared/services/database.service';

describe('WritingService', () => {
  let service: WritingService;
  const mockDatabaseService = {
    getClient: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: 'WRITING_CORRECTION_QUEUE', useValue: mockQueue },
      ],
    }).compile();

    service = module.get<WritingService>(WritingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTeils', () => {
    it('returns array of exercise types in camelCase with progress', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await service.getTeils('student-1');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toMatchObject({
        id: '1',
        title: 'E-Mail',
        subtitle: 'Formelle E-Mail schreiben',
        prompt: expect.any(String),
        part: 1,
        durationMinutes: 15,
      });
      expect(result[0].progress).toBe(0);
      expect(result[1].id).toBe('2');
      expect(result[1].title).toBe('Beitrag');
    });

    it('sets progress to 100 when student has completed attempt for that exercise', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ exercise_id: '1' }],
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await service.getTeils('student-1');

      expect(result[0].progress).toBe(100);
      expect(result[1].progress).toBe(0);
    });
  });

  describe('getSessions', () => {
    it('returns empty array when no attempts', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getSessions('student-1');

      expect(result).toEqual([]);
    });

    it('returns attempts with id, date, dateLabel, score, feedback, durationSeconds', async () => {
      const rows = [
        {
          attempt_id: 'attempt-uuid-1',
          created_at: '2026-03-04T10:00:00.000Z',
          completed_at: '2026-03-04T10:07:00.000Z',
          score: 78,
          feedback: 'Gute Struktur.',
          duration_seconds: 420,
        },
      ];
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: rows, error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getSessions('student-1');

      expect(result.length).toBe(1);
      expect(result[0]).toMatchObject({
        id: 'attempt-uuid-1',
        date: '2026-03-04T10:07:00.000Z',
        score: 78,
        feedback: 'Gute Struktur.',
        durationSeconds: 420,
      });
      expect(result[0].dateLabel).toBeDefined();
    });

    it('filters by teilNumber (exercise_id) when provided', async () => {
      const eqExerciseMock = jest
        .fn()
        .mockResolvedValue({ data: [], error: null });
      const limitMock = jest.fn().mockReturnValue({ eq: eqExerciseMock });
      const orderMock = jest.fn().mockReturnValue({ limit: limitMock });
      const eqStudentMock = jest.fn().mockReturnValue({ order: orderMock });
      const selectMock = jest.fn().mockReturnValue({ eq: eqStudentMock });
      const fromMock = jest.fn().mockReturnValue({
        select: selectMock,
        eq: eqStudentMock,
        order: orderMock,
        limit: limitMock,
      });

      mockDatabaseService.getClient.mockReturnValue({ from: fromMock });

      await service.getSessions('student-1', 1);

      expect(fromMock).toHaveBeenCalledWith('writing_attempts');
      expect(eqExerciseMock).toHaveBeenCalledWith('exercise_id', '1');
    });
  });

  describe('submit', () => {
    it('creates attempt and enqueues job, returns attemptId and status pending', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: insertMock }),
      });

      const result = await service.submit('student-1', {
        exerciseId: '1',
        content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
      });

      expect(result.attemptId).toBeDefined();
      expect(result.status).toBe('pending');
      expect(result.message).toBeDefined();
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: 'student-1',
          exercise_id: '1',
          content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
          status: 'pending',
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'student-1',
          exerciseId: '1',
          content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
        }),
      );
    });

    it('throws NotFoundException with messageKey for unknown exerciseId', async () => {
      try {
        await service.submit('student-1', {
          exerciseId: '99',
          content: 'Some text',
        });
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.getResponse()).toMatchObject({
          messageKey: 'writingExerciseNotFound',
        });
      }
    });

    it('throws UnprocessableEntityException for empty content', async () => {
      try {
        await service.submit('student-1', { exerciseId: '1', content: '' });
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnprocessableEntityException);
        expect(e.getResponse()).toMatchObject({
          messageKey: 'writingContentTooShort',
        });
      }
    });

    it('does not call queue when insert fails', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          insert: jest.fn().mockResolvedValue({
            error: { message: 'DB error' },
          }),
        }),
      });

      await expect(
        service.submit('student-1', { exerciseId: '1', content: 'Text' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
