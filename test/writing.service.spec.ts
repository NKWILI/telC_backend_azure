import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WritingService } from '../src/modules/writing/writing.service';
import { PrismaService } from '../src/shared/services/prisma.service';

const FAKE_EXERCISE = {
  id: 'uuid-exercise-1',
  content_revision: 'v1',
  title: 'E-Mail / Brief',
  subtitle: 'Formeller Brief',
  task_type: 'brief',
  intro: 'Sie sehen folgende Anzeige:',
  stimulus: {
    heading: 'Büroräume in Neubaukomplex zu vermieten!',
    body: 'In unserem neu gebauten Bürogebäude sind noch Räume frei',
    features: [
      'Gebäude mit 6 Stockwerken',
      'zentrale Lage',
      'helle, großzügige Büros, zwischen 15 und 25 m²',
      'Kaffeeküche',
      'Konferenzräume',
      'vier Aufzüge',
      'moderne Anschlüsse in allen Räumen (z. B. Internet/DSL-Anschlüsse)',
      'Hausmeisterservice rund um die Uhr',
      'moderne Sicherheitstechnik',
    ],
    callToAction:
      'Vereinbaren Sie einen Besichtigungstermin oder fordern Sie weitere Informationen an:',
    contact: { name: 'CenterBüros GmbH', lines: ['Neuer Wall 120', '50160 Köln'] },
  },
  task_instructions:
    'Sie arbeiten in einem Übersetzerbüro. Ihr Chef möchte größere Büroräume mieten.',
  bullet_points: [
    'Beschreiben Sie Ihr Unternehmen.',
    'Was für Räume brauchen Sie?',
    'Wie viele Räume brauchen Sie?',
    'Wann brauchen Sie die Räume?',
    'Fragen Sie nach den Kosten.',
  ],
  closing_reminder:
    'Bevor Sie den Brief schreiben, überlegen Sie sich die passende Reihenfolge der Punkte.',
  modelltest_id: 'uuid-modelltest-1',
  created_at: new Date(),
};

describe('WritingService', () => {
  let service: WritingService;

  const mockPrismaService = {
    writingExercise: {
      findUnique: jest.fn(),
    },
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

  describe('getExercise', () => {
    it('returns mapped WritingExerciseDto from DB row', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue(FAKE_EXERCISE);

      const result = await service.getExercise('uuid-exercise-1');

      expect(result.id).toBe('uuid-exercise-1');
      expect(result.part).toBe(1);
      expect(result.taskType).toBe('brief');
      expect(result.title).toBe('E-Mail / Brief');
      expect(result.bulletPoints).toHaveLength(5);
      expect(result.stimulus).toBeDefined();
      expect((result.stimulus as any).heading).toContain('Büroräume');
    });

    it('throws NotFoundException when exercise not in DB', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue(null);

      await expect(service.getExercise('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for empty id', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue(null);

      await expect(service.getExercise('')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSessions', () => {
    it('returns empty array when no attempts', async () => {
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

      const result = await service.getSessions('student-1');

      expect(result).toEqual([]);
    });

    it('returns attempts mapped to ExerciseAttemptDto', async () => {
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

    it('passes exerciseId UUID directly to WHERE clause', async () => {
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

      await service.getSessions('student-1', 'uuid-exercise-1');

      expect(mockPrismaService.writingAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ exercise_id: 'uuid-exercise-1' }),
        }),
      );
    });

    it('does not apply exercise_id filter when exerciseId is omitted', async () => {
      mockPrismaService.writingAttempt.findMany.mockResolvedValue([]);

      await service.getSessions('student-1');

      const callArg = mockPrismaService.writingAttempt.findMany.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('exercise_id');
    });
  });

  describe('submit', () => {
    it('creates attempt with modelltest_id from exercise and enqueues job', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue({
        id: 'uuid-exercise-1',
        modelltest_id: 'uuid-modelltest-1',
      });
      mockPrismaService.writingAttempt.create.mockResolvedValue({});

      const result = await service.submit('student-1', {
        exerciseId: 'uuid-exercise-1',
        content: 'Sehr geehrte Damen und Herren,\n\nich schreibe...',
      });

      expect(result.attemptId).toBeDefined();
      expect(result.status).toBe('pending');
      expect(mockPrismaService.writingAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            student_id: 'student-1',
            exercise_id: 'uuid-exercise-1',
            modelltest_id: 'uuid-modelltest-1',
            status: 'pending',
          }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'student-1',
          exerciseId: 'uuid-exercise-1',
        }),
      );
    });

    it('throws NotFoundException when exerciseId not in DB', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue(null);

      await expect(
        service.submit('student-1', { exerciseId: 'unknown', content: 'Some text' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException for empty content', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue({
        id: 'uuid-exercise-1',
        modelltest_id: null,
      });

      await expect(
        service.submit('student-1', { exerciseId: 'uuid-exercise-1', content: '' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('does not call queue when DB insert fails', async () => {
      mockPrismaService.writingExercise.findUnique.mockResolvedValue({
        id: 'uuid-exercise-1',
        modelltest_id: null,
      });
      mockPrismaService.writingAttempt.create.mockRejectedValue(new Error('DB error'));

      await expect(
        service.submit('student-1', { exerciseId: 'uuid-exercise-1', content: 'Text' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
