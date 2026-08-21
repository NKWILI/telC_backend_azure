import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ListeningService } from '../src/modules/listening/listening.service';
import { PrismaService } from '../src/shared/services/prisma.service';

const TEIL1_REVISION = 'modelltest-1-teil-1-v1';
const TEIL2_REVISION = 'modelltest-1-teil-2-v1';
const TEIL3_REVISION = 'modelltest-1-teil-3-v1';

const TEIL1_CORRECT_ANSWERS: Record<string, string> = {
  q41: '-',
  q42: '+',
  q43: '-',
  q44: '+',
  q45: '+',
};

describe('ListeningService', () => {
  let service: ListeningService;

  const mockPrismaService = {
    listeningAttempt: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    modelltest: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListeningService,
        { provide: PrismaService, useValue: mockPrismaService },
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
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue([]);

      const result = await service.getTeils('student-1');

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ id: '1', progress: 0 });
      expect(result[1]).toMatchObject({ id: '2', progress: 0 });
      expect(result[2]).toMatchObject({ id: '3', progress: 0 });
    });

    it('returns progress 100 for a Teil that has a completed attempt, 0 for others', async () => {
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue([
        { exercise_id: '2' },
      ]);

      const result = await service.getTeils('student-1');

      expect(result.find((t) => t.id === '1')?.progress).toBe(0);
      expect(result.find((t) => t.id === '2')?.progress).toBe(100);
      expect(result.find((t) => t.id === '3')?.progress).toBe(0);
    });

    it('returns all items with required fields', async () => {
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue([]);

      const result = await service.getTeils('student-1');

      for (const teil of result) {
        expect(teil.id).toBeDefined();
        expect(teil.title).toBeDefined();
        expect(teil.durationMinutes).toBeDefined();
        expect(typeof teil.progress).toBe('number');
      }
    });

    it('returns progress 0 gracefully when DB throws', async () => {
      mockPrismaService.listeningAttempt.findMany.mockRejectedValue(
        new Error('DB error'),
      );

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
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue([]);

      const result = await service.getSessions('student-1');

      expect(result).toEqual([]);
    });

    it('maps DB rows to ExerciseAttemptDto (camelCase)', async () => {
      const rows = [
        {
          attempt_id: 'uuid-listen-1',
          created_at: new Date('2026-03-10T09:00:00.000Z'),
          completed_at: new Date('2026-03-10T09:08:00.000Z'),
          score: 80,
          feedback: null,
          duration_seconds: 480,
        },
      ];
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue(rows);

      const result = await service.getSessions('student-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'uuid-listen-1',
        score: 80,
        durationSeconds: 480,
      });
      expect(result[0].dateLabel).toBeDefined();
    });

    it('returns empty array (no throw) when DB throws', async () => {
      mockPrismaService.listeningAttempt.findMany.mockRejectedValue(
        new Error('fail'),
      );

      const result = await service.getSessions('student-1');

      expect(result).toEqual([]);
    });

    it('applies exercise_id filter when teilNumber is provided', async () => {
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue([]);

      await service.getSessions('student-1', 2);

      expect(mockPrismaService.listeningAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ exercise_id: '2' }),
        }),
      );
    });

    it('does not apply exercise_id filter when teilNumber is omitted', async () => {
      mockPrismaService.listeningAttempt.findMany.mockResolvedValue([]);

      await service.getSessions('student-1');

      const callArg =
        mockPrismaService.listeningAttempt.findMany.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('exercise_id');
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

    it('each question has id and prompt only — no options array', async () => {
      const result = await service.getExercise('1');

      for (const q of result.questions) {
        expect(q.id).toBeDefined();
        expect(q.prompt).toBeDefined();
        expect((q as any).options).toBeUndefined();
      }
    });

    it('returns imagePath string', async () => {
      const result = await service.getExercise('1');

      expect(typeof result.imagePath).toBe('string');
    });

    it('Teil 2 has exactly 10 questions', async () => {
      const result = await service.getExercise('2');

      expect(result.questions).toHaveLength(10);
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

    it('returns answerKey when all answers are correct', async () => {
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});

      const result = await service.submit('student-1', {
        type: '1',
        timed: true,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(result.answerKey).toBeDefined();
      expect(typeof result.answerKey).toBe('object');
      expect((result as any).score).toBeUndefined();
    });

    it('answerKey contains correct +/- values for Teil 1', async () => {
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});

      const result = await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(result.answerKey).toEqual(TEIL1_CORRECT_ANSWERS);
    });

    it('attributes the attempt to the Modelltest named in content_revision', async () => {
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});
      mockPrismaService.modelltest.findUnique.mockResolvedValue({
        id: 'mt-1-uuid',
      });

      await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(mockPrismaService.modelltest.findUnique).toHaveBeenCalledWith({
        where: { number: 1 },
        select: { id: true },
      });
      expect(
        mockPrismaService.listeningAttempt.create.mock.calls[0][0].data
          .modelltest_id,
      ).toBe('mt-1-uuid');
    });

    it('leaves the attempt unattributed when the Modelltest row does not exist', async () => {
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});
      mockPrismaService.modelltest.findUnique.mockResolvedValue(null);

      await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(
        mockPrismaService.listeningAttempt.create.mock.calls[0][0].data
          .modelltest_id,
      ).toBeNull();
    });

    it('still records the attempt when the Modelltest lookup fails', async () => {
      // Attribution is metadata. Losing a student's result because a lookup
      // errored would be a far worse failure than an unattributed row.
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});
      mockPrismaService.modelltest.findUnique.mockRejectedValue(
        new Error('db unavailable'),
      );

      const result = await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(result.answerKey).toBeDefined();
      expect(mockPrismaService.listeningAttempt.create).toHaveBeenCalled();
      expect(
        mockPrismaService.listeningAttempt.create.mock.calls[0][0].data
          .modelltest_id,
      ).toBeNull();
    });

    it('DB insert receives the computed score even though it is not returned', async () => {
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});

      await service.submit('student-1', {
        type: '1',
        timed: true,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(mockPrismaService.listeningAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            student_id: 'student-1',
            exercise_id: '1',
            status: 'completed',
            score: expect.any(Number),
          }),
        }),
      );
    });

    it('partial answers — DB still receives a numeric score', async () => {
      mockPrismaService.listeningAttempt.create.mockResolvedValue({});

      const partial: Record<string, string> = {
        q41: '-',  // correct
        q42: '+',  // correct
        q43: '+',  // wrong
        q44: '-',  // wrong
        q45: '-',  // wrong
      };

      await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: partial,
      });

      expect(mockPrismaService.listeningAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ score: 40 }),
        }),
      );
    });

    it('does not throw when DB insert fails — still returns answerKey', async () => {
      mockPrismaService.listeningAttempt.create.mockRejectedValue(
        new Error('DB down'),
      );

      const result = await service.submit('student-1', {
        type: '1',
        timed: false,
        content_revision: TEIL1_REVISION,
        answers: TEIL1_CORRECT_ANSWERS,
      });

      expect(result.answerKey).toBeDefined();
    });
  });
});
