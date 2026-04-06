import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ListeningService } from '../src/modules/listening/listening.service';
import { DatabaseService } from '../src/shared/services/database.service';

/**
 * Catalog constants mirrored here so tests drive the implementation.
 * If the service changes these values, these tests will catch the drift.
 */
const TEIL1_REVISION = 'mock-horen-teil-1-v1';
const TEIL2_REVISION = 'mock-horen-teil-2-v1';
const TEIL3_REVISION = 'mock-horen-teil-3-v1';

// Answer keys that the implementation must satisfy (drive the service catalog)
const TEIL1_CORRECT_ANSWERS: Record<string, string> = {
  q11: 'b',
  q12: 'a',
  q13: 'c',
  q14: 'b',
  q15: 'a',
};

describe('ListeningService', () => {
  let service: ListeningService;
  const mockDatabaseService = { getClient: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListeningService,
        { provide: DatabaseService, useValue: mockDatabaseService },
      ],
    }).compile();

    service = module.get<ListeningService>(ListeningService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getTeils
  // ---------------------------------------------------------------------------
  describe('getTeils', () => {
    it('returns 3 items with progress 0 when DB has no completed attempts', async () => {
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

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ id: '1', progress: 0 });
      expect(result[1]).toMatchObject({ id: '2', progress: 0 });
      expect(result[2]).toMatchObject({ id: '3', progress: 0 });
    });

    it('returns progress 100 for a Teil that has a completed attempt, 0 for others', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: [{ exercise_id: '2' }],
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await service.getTeils('student-1');

      expect(result.find((t) => t.id === '1')?.progress).toBe(0);
      expect(result.find((t) => t.id === '2')?.progress).toBe(100);
      expect(result.find((t) => t.id === '3')?.progress).toBe(0);
    });

    it('returns all items with required fields', async () => {
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

      for (const teil of result) {
        expect(teil.id).toBeDefined();
        expect(teil.title).toBeDefined();
        expect(teil.durationMinutes).toBeDefined();
        expect(typeof teil.progress).toBe('number');
      }
    });

    it('returns progress 0 gracefully when DB returns error', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'DB error' },
              }),
            }),
          }),
        }),
      });

      const result = await service.getTeils('student-1');

      expect(result).toHaveLength(3);
      expect(result.every((t) => t.progress === 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getSessions
  // ---------------------------------------------------------------------------
  describe('getSessions', () => {
    it('returns empty array when there are no attempts', async () => {
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

    it('maps DB rows to ExerciseAttemptDto (camelCase)', async () => {
      const rows = [
        {
          attempt_id: 'uuid-listen-1',
          created_at: '2026-03-10T09:00:00.000Z',
          completed_at: '2026-03-10T09:08:00.000Z',
          score: 80,
          feedback: null,
          duration_seconds: 480,
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

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'uuid-listen-1',
        date: '2026-03-10T09:08:00.000Z',
        score: 80,
        durationSeconds: 480,
      });
      expect(result[0].dateLabel).toBeDefined();
    });

    it('returns empty array (no throw) when DB returns an error', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'fail' },
                }),
              }),
            }),
          }),
        }),
      });

      const result = await service.getSessions('student-1');

      expect(result).toEqual([]);
    });

    it('applies exercise_id filter when teilNumber is provided', async () => {
      const eqExerciseMock = jest
        .fn()
        .mockResolvedValue({ data: [], error: null });
      const limitMock = jest.fn().mockReturnValue({ eq: eqExerciseMock });
      const orderMock = jest.fn().mockReturnValue({ limit: limitMock });
      const eqStudentMock = jest.fn().mockReturnValue({ order: orderMock });
      const selectMock = jest.fn().mockReturnValue({ eq: eqStudentMock });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ select: selectMock }),
      });

      await service.getSessions('student-1', 2);

      expect(eqExerciseMock).toHaveBeenCalledWith('exercise_id', '2');
    });

    it('does not apply exercise_id filter when teilNumber is omitted', async () => {
      const limitMock = jest.fn().mockResolvedValue({ data: [], error: null });
      const orderMock = jest.fn().mockReturnValue({ limit: limitMock });
      const eqStudentMock = jest.fn().mockReturnValue({ order: orderMock });
      const selectMock = jest.fn().mockReturnValue({ eq: eqStudentMock });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ select: selectMock }),
      });

      await service.getSessions('student-1');

      // limit resolves directly — no additional .eq() call on the query
      expect(limitMock).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getExercise
  // ---------------------------------------------------------------------------
  describe('getExercise', () => {
    it('returns exercise payload with required fields for type "1"', async () => {
      const result = await service.getExercise('1');

      expect(result.content_revision).toBe(TEIL1_REVISION);
      expect(result.issued_at).toBeDefined();
      expect(typeof result.audio_url).toBe('string');
      expect(Array.isArray(result.questions)).toBe(true);
      expect(result.questions.length).toBeGreaterThan(0);
    });

    it('returns exercise payload for type "2"', async () => {
      const result = await service.getExercise('2');

      expect(result.content_revision).toBe(TEIL2_REVISION);
      expect(result.questions.length).toBeGreaterThan(0);
    });

    it('returns exercise payload for type "3"', async () => {
      const result = await service.getExercise('3');

      expect(result.content_revision).toBe(TEIL3_REVISION);
      expect(result.questions.length).toBeGreaterThan(0);
    });

    it('each question has id, prompt, and options array with id+label', async () => {
      const result = await service.getExercise('1');

      for (const q of result.questions) {
        expect(q.id).toBeDefined();
        expect(q.prompt).toBeDefined();
        expect(Array.isArray(q.options)).toBe(true);
        expect(q.options.length).toBeGreaterThan(0);
        for (const opt of q.options) {
          expect(opt.id).toBeDefined();
          expect(opt.label).toBeDefined();
        }
      }
    });

    it('does NOT expose the answer key in the response', async () => {
      const result = await service.getExercise('1');

      expect((result as any).answerKey).toBeUndefined();
      expect((result as any).answers).toBeUndefined();
      expect((result as any).correctAnswers).toBeUndefined();
    });

    it('throws NotFoundException for unknown type', async () => {
      await expect(service.getExercise('99')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for empty string type', async () => {
      await expect(service.getExercise('')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // submit
  // ---------------------------------------------------------------------------
  describe('submit', () => {
    it('throws UnprocessableEntityException for unknown type', async () => {
      await expect(
        service.submit('student-1', {
          type: '99',
          timed: false,
          content_revision: TEIL1_REVISION,
          answers: { q11: 'a' },
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException for stale content_revision', async () => {
      await expect(
        service.submit('student-1', {
          type: '1',
          timed: false,
          content_revision: 'outdated-revision-xyz',
          answers: { q11: 'a' },
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException for empty answers object', async () => {
      await expect(
        service.submit('student-1', {
          type: '1',
          timed: false,
          content_revision: TEIL1_REVISION,
          answers: {},
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns score 100 when all answers are correct', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: insertMock }),
      });

      const result = await service.submit('student-1', {
        type: '1',
        timed: true,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(result.score).toBe(100);
    });

    it('returns score 0 when all answers are wrong', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: insertMock }),
      });

      // Pick the wrong option for every question (not in TEIL1_CORRECT_ANSWERS values)
      const allWrong: Record<string, string> = {};
      for (const qId of Object.keys(TEIL1_CORRECT_ANSWERS)) {
        allWrong[qId] = 'z'; // 'z' is never a valid option → treated as wrong
      }

      const result = await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: allWrong,
      });

      expect(result.score).toBe(0);
    });

    it('returns a partial score for partially correct answers', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: insertMock }),
      });

      // Correct answers for q11 and q12 only (2 out of 5 → 40)
      const partial: Record<string, string> = {
        q11: TEIL1_CORRECT_ANSWERS['q11'],
        q12: TEIL1_CORRECT_ANSWERS['q12'],
        q13: 'z',
        q14: 'z',
        q15: 'z',
      };

      const result = await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: partial,
      });

      expect(result.score).toBe(40);
    });

    it('inserts a completed attempt row and returns score', async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: insertMock }),
      });

      const result = await service.submit('student-1', {
        type: '1',
        timed: true,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          student_id: 'student-1',
          exercise_id: '1',
          status: 'completed',
          score: expect.any(Number),
        }),
      );
    });

    it('does not throw when DB insert fails — logs and returns score anyway', async () => {
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          insert: jest
            .fn()
            .mockResolvedValue({ error: { message: 'DB down' } }),
        }),
      });

      // Score is computed in-memory; DB failure should be logged but not crash the response
      await expect(
        service.submit('student-1', {
          type: '1',
          timed: false,
          content_revision: TEIL1_REVISION,
          answers: TEIL1_CORRECT_ANSWERS,
        }),
      ).resolves.toMatchObject({ score: expect.any(Number) });
    });
  });
});
