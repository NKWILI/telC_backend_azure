import { Test, TestingModule } from '@nestjs/testing';
import { SpeakingService } from '../src/modules/speaking/services/speaking.service';
import { PrismaService } from '../src/shared/services/prisma.service';

const mockPrismaService = {
  examSession: {
    findMany: jest.fn(),
  },
};

describe('SpeakingService', () => {
  let service: SpeakingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpeakingService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SpeakingService>(SpeakingService);
    jest.clearAllMocks();
  });

  describe('getTeils', () => {
    it('should return exactly 3 Teile', () => {
      const teils = service.getTeils();
      expect(teils).toHaveLength(3);
    });

    it('should have correct part numbers 1, 2, 3', () => {
      const teils = service.getTeils();
      expect(teils[0].part).toBe(1);
      expect(teils[1].part).toBe(2);
      expect(teils[2].part).toBe(3);
    });

    it('should include required fields on each Teil', () => {
      service.getTeils().forEach((teil) => {
        expect(teil.id).toBeDefined();
        expect(teil.title).toBeDefined();
        expect(teil.instructions).toBeDefined();
        expect(teil.durationMinutes).toBeGreaterThan(0);
        expect(Array.isArray(teil.topicPoints)).toBe(true);
        expect(teil.topicPoints.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getSessions', () => {
    it('should return mapped session history', async () => {
      mockPrismaService.examSession.findMany.mockResolvedValue([
        {
          session_id: 'session-1',
          teil_number: 1,
          completed_at: new Date('2026-01-01T10:00:00Z'),
          teil_evaluations: [
            { overall_score: 78, strengths: 'Gut', areas_for_improvement: 'Grammatik' },
          ],
        },
      ]);

      const result = await service.getSessions('student-123');

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('session-1');
      expect(result[0].teilNumber).toBe(1);
      expect(result[0].overallScore).toBe(78);
      expect(result[0].strengths).toBe('Gut');
      expect(result[0].areasForImprovement).toBe('Grammatik');
    });

    it('should return null scores when no evaluation exists', async () => {
      mockPrismaService.examSession.findMany.mockResolvedValue([
        {
          session_id: 'session-2',
          teil_number: 2,
          completed_at: new Date(),
          teil_evaluations: [],
        },
      ]);

      const result = await service.getSessions('student-123');

      expect(result[0].overallScore).toBeNull();
      expect(result[0].strengths).toBeNull();
      expect(result[0].areasForImprovement).toBeNull();
    });

    it('should return empty array on DB error', async () => {
      mockPrismaService.examSession.findMany.mockRejectedValue(new Error('DB down'));

      const result = await service.getSessions('student-123');

      expect(result).toEqual([]);
    });

    it('should filter by teilNumber when provided', async () => {
      mockPrismaService.examSession.findMany.mockResolvedValue([]);

      await service.getSessions('student-123', 2, 10);

      expect(mockPrismaService.examSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teil_number: 2 }),
        }),
      );
    });

    it('should respect the limit parameter', async () => {
      mockPrismaService.examSession.findMany.mockResolvedValue([]);

      await service.getSessions('student-123', undefined, 5);

      expect(mockPrismaService.examSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });
});
