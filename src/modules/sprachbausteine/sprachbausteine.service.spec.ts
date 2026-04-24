import { NotFoundException } from '@nestjs/common';
import { SprachbausteineService } from './sprachbausteine.service';

const mockTeil1Exercise = {
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

const mockTeil2Exercise = {
  id: 'cccccccc-0001-0001-0002-000000000001',
  contentRevision: 'modelltest-1-sprachbausteine-teil2-v1',
  label: '',
  instruction: 'Lesen Sie den Text...',
  durationMinutes: 18,
  body: 'Text with -31- through -40-',
  createdAt: new Date(),
  words: Array.from({ length: 15 }, (_, i) => ({
    id: `dddddddd-${String(i + 1).padStart(4, '0')}-0001-0002-000000000001`,
    exerciseId: 'cccccccc-0001-0001-0002-000000000001',
    letter: String.fromCharCode(97 + i),
    content: [
      'ANZEIGE', 'ARBEIT', 'AUSBILDUNG', 'BEWERBE', 'BERUFLICHEN',
      'BESONDEREN', 'CHANCE', 'ENTNEHMEN', 'KARRIERE', 'LESEN',
      'NAHM', 'PERSÖNLICHEN', 'STELLE', 'ÜBERNAHM', 'VERBESSERT',
    ][i],
    sortOrder: i,
  })),
  gaps: [
    // 31 → a (ANZEIGE, sortOrder 0)
    { id: 'eeeeeeee-0031-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '31', gapNumber: 31, correctWordId: 'dddddddd-0001-0001-0002-000000000001', sortOrder: 0 },
    // 32 → m (STELLE, sortOrder 12)
    { id: 'eeeeeeee-0032-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '32', gapNumber: 32, correctWordId: 'dddddddd-0013-0001-0002-000000000001', sortOrder: 1 },
    // 33 → d (BEWERBE, sortOrder 3)
    { id: 'eeeeeeee-0033-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '33', gapNumber: 33, correctWordId: 'dddddddd-0004-0001-0002-000000000001', sortOrder: 2 },
    // 34 → c (AUSBILDUNG, sortOrder 2)
    { id: 'eeeeeeee-0034-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '34', gapNumber: 34, correctWordId: 'dddddddd-0003-0001-0002-000000000001', sortOrder: 3 },
    // 35 → o (VERBESSERT, sortOrder 14)
    { id: 'eeeeeeee-0035-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '35', gapNumber: 35, correctWordId: 'dddddddd-0015-0001-0002-000000000001', sortOrder: 4 },
    // 36 → n (ÜBERNAHM, sortOrder 13)
    { id: 'eeeeeeee-0036-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '36', gapNumber: 36, correctWordId: 'dddddddd-0014-0001-0002-000000000001', sortOrder: 5 },
    // 37 → g (CHANCE, sortOrder 6)
    { id: 'eeeeeeee-0037-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '37', gapNumber: 37, correctWordId: 'dddddddd-0007-0001-0002-000000000001', sortOrder: 6 },
    // 38 → e (BERUFLICHEN, sortOrder 4)
    { id: 'eeeeeeee-0038-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '38', gapNumber: 38, correctWordId: 'dddddddd-0005-0001-0002-000000000001', sortOrder: 7 },
    // 39 → h (ENTNEHMEN, sortOrder 7)
    { id: 'eeeeeeee-0039-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '39', gapNumber: 39, correctWordId: 'dddddddd-0008-0001-0002-000000000001', sortOrder: 8 },
    // 40 → l (PERSÖNLICHEN, sortOrder 11)
    { id: 'eeeeeeee-0040-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '40', gapNumber: 40, correctWordId: 'dddddddd-0012-0001-0002-000000000001', sortOrder: 9 },
  ],
};

const mockPrisma = {
  sprachbausteineExercise: {
    findFirst: jest.fn(),
  },
  sprachbausteineTeil2Exercise: {
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
    it('returns correct DTO shape with 10 teil1 gaps and real teil2 data', async () => {
      mockPrisma.sprachbausteineExercise.findFirst.mockResolvedValue(mockTeil1Exercise);
      mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);

      const result = await service.getExercise();

      expect(result.contentRevision).toBe('modelltest-1-v1');
      expect(typeof result.issuedAt).toBe('string');
      expect(result.teil1.gaps).toHaveLength(10);
      result.teil1.gaps.forEach((gap, i) => {
        const gapKey = String(21 + i);
        expect(gap.id).toBe(gapKey);
        expect(gap.options).toHaveLength(3);
        expect(gap.options.map((o) => o.id)).toEqual([`${gapKey}a`, `${gapKey}b`, `${gapKey}c`]);
        expect(gap.correctOptionId).toBe(`${gapKey}b`);
      });
      expect(result.teil2.wordBank).toHaveLength(15);
      expect(result.teil2.gaps).toHaveLength(10);
    });

    it('throws NotFoundException when no Teil 1 exercise exists', async () => {
      mockPrisma.sprachbausteineExercise.findFirst.mockResolvedValue(null);
      mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);

      await expect(service.getExercise()).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTeil2Exercise', () => {
    it('returns correct shape — 15 words in wordBank, 10 gaps, no UUIDs in ids', async () => {
      mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);
      const result = await (service as any).getTeil2Exercise();

      expect(result.wordBank).toHaveLength(15);
      expect(result.gaps).toHaveLength(10);
      expect(result.wordBank[0].id).toBe('wa');
      expect(result.wordBank[0].letter).toBe('a');
      expect(result.wordBank[14].id).toBe('wo');
      expect(result.wordBank[14].letter).toBe('o');
      expect(result.gaps[0].id).toBe('31');
      expect(result.gaps[9].id).toBe('40');

      const json = JSON.stringify(result);
      expect(json).not.toMatch(/"id":"[0-9a-f]{8}-/);
    });

    it('derives correctWordId from word sortOrder and maps all 10 gaps correctly', async () => {
      mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);
      const result = await (service as any).getTeil2Exercise();

      const answers: Record<string, string> = {};
      result.gaps.forEach((g: any) => { answers[g.id] = g.correctWordId; });

      expect(answers['31']).toBe('wa');   // ANZEIGE
      expect(answers['32']).toBe('wm');   // STELLE
      expect(answers['33']).toBe('wd');   // BEWERBE
      expect(answers['34']).toBe('wc');   // AUSBILDUNG
      expect(answers['35']).toBe('wo');   // VERBESSERT
      expect(answers['36']).toBe('wn');   // ÜBERNAHM
      expect(answers['37']).toBe('wg');   // CHANCE
      expect(answers['38']).toBe('we');   // BERUFLICHEN
      expect(answers['39']).toBe('wh');   // ENTNEHMEN
      expect(answers['40']).toBe('wl');   // PERSÖNLICHEN
    });

    it('throws NotFoundException when no Teil 2 exercise exists', async () => {
      mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(null);
      await expect((service as any).getTeil2Exercise()).rejects.toThrow(NotFoundException);
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
