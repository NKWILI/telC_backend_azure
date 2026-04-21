import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WritingService } from '../src/modules/writing/writing.service';
import { PrismaService } from '../src/shared/services/prisma.service';

describe('WritingService', () => {
  let service: WritingService;

  const mockPrismaService = {
    writingAttempt: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingService,
        { provide: PrismaService, useValue: mockPrismaService },
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
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

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
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([
        { exercise_id: '1' },
      ]);

      const result = await service.getTeils('student-1');

      expect(result[0].progress).toBe(100);
      expect(result[1].progress).toBe(0);
    });
  });

  describe('getSessions', () => {
    it('returns empty array when no attempts', async () => {
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

      const result = await service.getSessions('student-1');

      expect(result).toEqual([]);
    });

    it('returns attempts with id, date, dateLabel, score, feedback, durationSeconds', async () => {
      const rows = [
        {
          attempt_id: 'attempt-uuid-1',
          created_at: new Date('2026-03-04T10:00:00.000Z'),
          completed_at: new Date('2026-03-04T10:07:00.000Z'),
          score: 78,
          feedback: 'Gute Struktur.',
          duration_seconds: 420,
        },
      ];
      mockPrismaService.writingAttempt.findMany.mockResolvedValue(rows);

      const result = await service.getSessions('student-1');

      expect(result.length).toBe(1);
      expect(result[0]).toMatchObject({
        id: 'attempt-uuid-1',
        score: 78,
        feedback: 'Gute Struktur.',
        durationSeconds: 420,
      });
      expect(result[0].dateLabel).toBeDefined();
    });

    it('filters by exercise_id when teilNumber is provided', async () => {
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

      await service.getSessions('student-1', 1);

      expect(mockPrismaService.writingAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ exercise_id: '1' }),
        }),
      );
    });

    it('does not apply exercise_id filter when teilNumber is omitted', async () => {
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

      await service.getSessions('student-1');

      const callArg = mockPrismaService.writingAttempt.findMany.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('exercise_id');
    });
  });

  describe('submit', () => {
    it('creates attempt and enqueues job, returns attemptId and status pending', async () => {
      mockPrismaService.writingAttempt.create.mockResolvedValue({});

      const result = await service.submit('student-1', {
        exerciseId: '1',
        content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
      });

      expect(result.attemptId).toBeDefined();
      expect(result.status).toBe('pending');
      expect(result.message).toBeDefined();
      expect(mockPrismaService.writingAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            student_id: 'student-1',
            exercise_id: '1',
            content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
            status: 'pending',
          }),
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
        await service.submit('student-1', { exerciseId: '99', content: 'Some text' });
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.getResponse()).toMatchObject({ messageKey: 'writingExerciseNotFound' });
      }
    });

    it('throws UnprocessableEntityException for empty content', async () => {
      try {
        await service.submit('student-1', { exerciseId: '1', content: '' });
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e).toBeInstanceOf(UnprocessableEntityException);
        expect(e.getResponse()).toMatchObject({ messageKey: 'writingContentTooShort' });
      }
    });

    it('does not call queue when insert fails', async () => {
      mockPrismaService.writingAttempt.create.mockRejectedValue(new Error('DB error'));

      await expect(
        service.submit('student-1', { exerciseId: '1', content: 'Text' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
