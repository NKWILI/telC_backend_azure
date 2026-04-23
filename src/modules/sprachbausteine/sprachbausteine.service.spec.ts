import { NotFoundException } from '@nestjs/common';
import { SprachbausteineService } from './sprachbausteine.service';

const mockExercise = {
  id: 'aaaaaaaa-0001-0001-0001-000000000001',
  teil_number: 1,
  content_revision: 'modelltest-1-v1',
  label: 'Sprachbausteine, Teil 1',
  instruction: 'Lesen Sie den Text…',
  duration_minutes: 18,
  body: 'Text with -21- and -22-',
  created_at: new Date(),
  gaps: Array.from({ length: 10 }, (_, i) => ({
    id: `gap-${i}`,
    exercise_id: 'aaaaaaaa-0001-0001-0001-000000000001',
    gap_key: String(21 + i),
    gap_number: 21 + i,
    sort_order: i,
    options: [
      { id: `opt-${i}-0`, gap_id: `gap-${i}`, content: 'a-word', is_correct: false, sort_order: 0 },
      { id: `opt-${i}-1`, gap_id: `gap-${i}`, content: 'b-word', is_correct: true,  sort_order: 1 },
      { id: `opt-${i}-2`, gap_id: `gap-${i}`, content: 'c-word', is_correct: false, sort_order: 2 },
    ],
  })),
};

const mockPrisma = {
  sprachbausteineExercise: {
    findFirst: jest.fn(),
  },
};

describe('SprachbausteineService', () => {
  let service: SprachbausteineService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SprachbausteineService(mockPrisma as any);
  });

  describe('getExercise', () => {
    it('returns correct DTO shape with 10 gaps and non-null correctOptionId', async () => {
      mockPrisma.sprachbausteineExercise.findFirst.mockResolvedValue(mockExercise);

      const result = await service.getExercise();

      expect(result.contentRevision).toBe('modelltest-1-v1');
      expect(typeof result.issuedAt).toBe('string');
      expect(result.teil2).toEqual({});
      expect(result.teil1.gaps).toHaveLength(10);
      result.teil1.gaps.forEach((gap, i) => {
        const gapKey = String(21 + i);
        expect(gap.id).toBe(gapKey);
        expect(gap.options).toHaveLength(3);
        expect(gap.options.map((o) => o.id)).toEqual([
          `${gapKey}a`,
          `${gapKey}b`,
          `${gapKey}c`,
        ]);
        // correct option is sort_order=1 (b) in mock data
        expect(gap.correctOptionId).toBe(`${gapKey}b`);
      });
    });

    it('throws NotFoundException when no exercise exists', async () => {
      mockPrisma.sprachbausteineExercise.findFirst.mockResolvedValue(null);

      await expect(service.getExercise()).rejects.toThrow(NotFoundException);
    });
  });

  describe('submit', () => {
    it('returns { score: 0 } for any valid payload', async () => {
      const result = await service.submit({
        id: 'x',
        exercise_type_id: '1',
        teil_id: '1',
        score_percent: 75,
        tested_at: '2026-04-22T10:00:00Z',
        answers: { '21': 'c' },
      });

      expect(result).toEqual({ score: 0 });
    });
  });
});
