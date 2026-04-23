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

const TERMINABSAGE_ID = 'ffffffff-0007-0001-0001-000000000001';

const mockTeil1Exercise = {
  id: 'eeeeeeee-0001-0001-0001-000000000001',
  contentRevision: 'modelltest-1-lesen-teil1-v1',
  label: 'Leseverstehen, Teil 1',
  instruction: 'Lesen Sie…',
  createdAt: new Date(),
  titles: [
    { id: 'ffffffff-0001-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Anfrage',             sortOrder: 0 },
    { id: 'ffffffff-0002-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Lieferschein',        sortOrder: 1 },
    { id: 'ffffffff-0003-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Reklamation',         sortOrder: 2 },
    { id: 'ffffffff-0004-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Schadensmeldung',     sortOrder: 3 },
    { id: 'ffffffff-0005-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Schließregelung',     sortOrder: 4 },
    { id: 'ffffffff-0006-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Sommerfest',          sortOrder: 5 },
    { id: TERMINABSAGE_ID,                        exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Terminabsage',        sortOrder: 6 },
    { id: 'ffffffff-0008-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Terminverschiebung',  sortOrder: 7 },
    { id: 'ffffffff-0009-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Terminzusage',        sortOrder: 8 },
    { id: 'ffffffff-0010-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', content: 'Übernachtung',        sortOrder: 9 },
  ],
  texts: [
    { id: '44444444-0001-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', textNumber: 1, von: 'r.fazli@grb.com',          an: 'v.gruedle@grb.com', body: 'body1', sortOrder: 0, correctTitleId: TERMINABSAGE_ID },
    { id: '44444444-0002-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', textNumber: 2, von: null,                       an: null,                body: 'body2', sortOrder: 1, correctTitleId: 'ffffffff-0005-0001-0001-000000000001' },
    { id: '44444444-0003-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', textNumber: 3, von: 'rene.gallack@fa-rzw.de',    an: 's.gerke@web.de',    body: 'body3', sortOrder: 2, correctTitleId: 'ffffffff-0003-0001-0001-000000000001' },
    { id: '44444444-0004-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', textNumber: 4, von: 'i.villa@kompsit.net',       an: 'aurum@gaestehaus.com', body: 'body4', sortOrder: 3, correctTitleId: 'ffffffff-0001-0001-0001-000000000001' },
    { id: '44444444-0005-0001-0001-000000000001', exerciseId: 'eeeeeeee-0001-0001-0001-000000000001', textNumber: 5, von: 'michaela.rojka@rett-platt.de', an: 'nella.weber@rett-platt.de', body: 'body5', sortOrder: 4, correctTitleId: 'ffffffff-0008-0001-0001-000000000001' },
  ],
};

const mockPrisma = {
  lesenTeil1Exercise: { findFirst: jest.fn() },
  lesenTeil2Exercise: { findFirst: jest.fn() },
};

describe('LesenService', () => {
  let service: LesenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LesenService(mockPrisma as any);
  });

  describe('getTeil1Exercise', () => {
    it('returns correct shape — 5 texts, 10 titles, correctMatches map, no correctTitleId on texts', async () => {
      mockPrisma.lesenTeil1Exercise.findFirst.mockResolvedValue(mockTeil1Exercise);

      const result = await (service as any).getTeil1Exercise();

      expect(result.texts).toHaveLength(5);
      expect(result.titles).toHaveLength(10);

      // text 2 (index 1) has null von/an
      expect(result.texts[1].von).toBeNull();
      expect(result.texts[1].an).toBeNull();

      // correctTitleId must NOT appear on text objects
      expect(result.texts[0]).not.toHaveProperty('correctTitleId');

      // correctMatches map at teil1 level
      expect(Object.keys(result.correctMatches)).toHaveLength(5);
      expect(result.correctMatches['1']).toBe(TERMINABSAGE_ID);
    });

    it('throws NotFoundException when no exercise exists', async () => {
      mockPrisma.lesenTeil1Exercise.findFirst.mockResolvedValue(null);

      await expect((service as any).getTeil1Exercise()).rejects.toThrow(NotFoundException);
    });
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
