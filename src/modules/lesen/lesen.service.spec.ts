import { NotFoundException } from '@nestjs/common';
import { LesenService } from './lesen.service';

const mockExercise = {
  id: 'cccccccc-0002-0002-0002-000000000001',
  contentRevision: 'modelltest-1-lesen-teil2-v1',
  label: 'Leseverstehen, Teil 2',
  instruction: 'Lesen Sie die E-Mail…',
  cautionNote: 'Achtung!',
  topSender: 'k.weisshaupt@web.de',
  topReceiver: 'j.baric@freenet.com',
  topBody: 'Sehr geehrter Herr Baric…',
  quotedThread: 'Johannes Baric schrieb:…',
  createdAt: new Date(),
  questions: [
    // question 6 — correct: c (sort_order 2)
    {
      id: 'dddddddd-0006-0002-0002-000000000001',
      exerciseId: 'cccccccc-0002-0002-0002-000000000001',
      questionNumber: 6,
      prompt: 'Die Arbeiten können in der Werkstatt durchgeführt werden, wenn',
      sortOrder: 0,
      options: [
        { id: 'opt-6-0', questionId: 'q6', content: 'der Termin nicht abgesprochen werden muss',           isCorrect: false, sortOrder: 0 },
        { id: 'opt-6-1', questionId: 'q6', content: 'der Termin von der Werkstatt festgelegt werden kann', isCorrect: false, sortOrder: 1 },
        { id: 'opt-6-2', questionId: 'q6', content: 'der Termin vorher mit Frau Weisshaupt abgesprochen wird', isCorrect: true, sortOrder: 2 },
      ],
    },
    // questions 7–10 with correct at sort_order 0 (a)
    ...([7, 8, 9, 10] as const).map((n, i) => ({
      id: `dddddddd-00${String(n).padStart(2, '0')}-0002-0002-000000000001`,
      exerciseId: 'cccccccc-0002-0002-0002-000000000001',
      questionNumber: n,
      prompt: `Frage ${n}`,
      sortOrder: i + 1,
      options: [
        { id: `opt-${n}-0`, questionId: `q${n}`, content: `option-a-${n}`, isCorrect: true,  sortOrder: 0 },
        { id: `opt-${n}-1`, questionId: `q${n}`, content: `option-b-${n}`, isCorrect: false, sortOrder: 1 },
        { id: `opt-${n}-2`, questionId: `q${n}`, content: `option-c-${n}`, isCorrect: false, sortOrder: 2 },
      ],
    })),
  ],
};

const mockPrisma = {
  lesenTeil2Exercise: { findFirst: jest.fn() },
};

describe('LesenService', () => {
  let service: LesenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LesenService(mockPrisma as any);
  });

  describe('getTeil2Exercise', () => {
    it('returns correct DTO shape — 5 questions, derived IDs, correctOptionId', async () => {
      mockPrisma.lesenTeil2Exercise.findFirst.mockResolvedValue(mockExercise);

      const result = await service.getTeil2Exercise();

      expect(result.contentRevision).toBe('modelltest-1-lesen-teil2-v1');
      expect(typeof result.issuedAt).toBe('string');
      expect(result.teil2.questions).toHaveLength(5);

      // question 6: correct is sort_order 2 → "6c"
      const q6 = result.teil2.questions[0];
      expect(q6.id).toBe('6');
      expect(q6.options.map((o) => o.id)).toEqual(['6a', '6b', '6c']);
      expect(q6.correctOptionId).toBe('6c');

      // thread fields present
      expect(result.teil2.thread.topSender).toBe('k.weisshaupt@web.de');
      expect(result.teil2.thread.topReceiver).toBe('j.baric@freenet.com');
      expect(typeof result.teil2.thread.topBody).toBe('string');
      expect(typeof result.teil2.thread.quotedThread).toBe('string');

      // no isCorrect in output
      const json = JSON.stringify(result);
      expect(json).not.toContain('isCorrect');
    });

    it('throws NotFoundException when no exercise exists', async () => {
      mockPrisma.lesenTeil2Exercise.findFirst.mockResolvedValue(null);

      await expect(service.getTeil2Exercise()).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitTeil2', () => {
    it('returns { score: 0 }', async () => {
      const result = await service.submitTeil2({
        id: 'test-001',
        exercise_type_id: '2',
        teil_id: '2',
        score_percent: 80,
        tested_at: '2026-04-22T10:00:00Z',
        answers: { '6': '6c', '7': '7a' },
      });

      expect(result).toEqual({ score: 0 });
    });
  });
});
