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

const mockTeil3Exercise = {
  id: 'bbbbbbbb-0001-0003-0003-000000000001',
  contentRevision: 'modelltest-1-lesen-teil3-v1',
  label: 'Leseverstehen, Teil 3',
  instruction: 'Lesen Sie die Situationen 11–20…',
  createdAt: new Date(),
  announcements: Array.from({ length: 12 }, (_, i) => ({
    id: `dddddddd-${String(i + 1).padStart(4, '0')}-0003-0003-000000000001`,
    exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001',
    title: `Title ${i}`,
    content: `Content ${i}`,
    sortOrder: i,
  })),
  situations: [
    // 11 → "j" (sortOrder 9)
    { id: 'eeeeeeee-0011-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 11, content: 'Situation 11', noMatch: false, correctAnnouncementId: 'dddddddd-0010-0003-0003-000000000001', sortOrder: 0 },
    // 12 → "g" (sortOrder 6)
    { id: 'eeeeeeee-0012-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 12, content: 'Situation 12', noMatch: false, correctAnnouncementId: 'dddddddd-0007-0003-0003-000000000001', sortOrder: 1 },
    // 13 → "d" (sortOrder 3)
    { id: 'eeeeeeee-0013-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 13, content: 'Situation 13', noMatch: false, correctAnnouncementId: 'dddddddd-0004-0003-0003-000000000001', sortOrder: 2 },
    // 14 → "h" (sortOrder 7)
    { id: 'eeeeeeee-0014-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 14, content: 'Situation 14', noMatch: false, correctAnnouncementId: 'dddddddd-0008-0003-0003-000000000001', sortOrder: 3 },
    // 15 → "X" (no match)
    { id: 'eeeeeeee-0015-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 15, content: 'Situation 15', noMatch: true,  correctAnnouncementId: null,                                        sortOrder: 4 },
    // 16 → "e" (sortOrder 4)
    { id: 'eeeeeeee-0016-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 16, content: 'Situation 16', noMatch: false, correctAnnouncementId: 'dddddddd-0005-0003-0003-000000000001', sortOrder: 5 },
    // 17 → "k" (sortOrder 10)
    { id: 'eeeeeeee-0017-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 17, content: 'Situation 17', noMatch: false, correctAnnouncementId: 'dddddddd-0011-0003-0003-000000000001', sortOrder: 6 },
    // 18 → "l" (sortOrder 11)
    { id: 'eeeeeeee-0018-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 18, content: 'Situation 18', noMatch: false, correctAnnouncementId: 'dddddddd-0012-0003-0003-000000000001', sortOrder: 7 },
    // 19 → "b" (sortOrder 1)
    { id: 'eeeeeeee-0019-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 19, content: 'Situation 19', noMatch: false, correctAnnouncementId: 'dddddddd-0002-0003-0003-000000000001', sortOrder: 8 },
    // 20 → "c" (sortOrder 2)
    { id: 'eeeeeeee-0020-0003-0003-000000000001', exerciseId: 'bbbbbbbb-0001-0003-0003-000000000001', situationNumber: 20, content: 'Situation 20', noMatch: false, correctAnnouncementId: 'dddddddd-0003-0003-0003-000000000001', sortOrder: 9 },
  ],
};

const mockPrisma = {
  lesenTeil1Exercise: { findFirst: jest.fn() },
  lesenTeil2Exercise: { findFirst: jest.fn() },
  lesenTeil3Exercise: { findFirst: jest.fn() },
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

      // id is textNumber as string, no textNumber field
      expect(result.texts[0].id).toBe('1');
      expect(result.texts[0]).not.toHaveProperty('textNumber');

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

      // flat thread fields (no nested thread object)
      expect(result.teil2).not.toHaveProperty('thread');
      expect(result.teil2.sender).toBe('k.weisshaupt@web.de');
      expect(result.teil2.receiver).toBe('j.baric@freenet.com');
      expect(typeof result.teil2.content).toBe('string');
      expect(typeof result.teil2.quotedThread).toBe('string');

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

  describe('getTeil3Exercise', () => {
    it('returns correct shape — 10 situations, 12 announcements, no UUIDs in ids', async () => {
      mockPrisma.lesenTeil3Exercise.findFirst.mockResolvedValue(mockTeil3Exercise);

      const result = await (service as any).getTeil3Exercise();

      expect(result.situations).toHaveLength(10);
      expect(result.announcements).toHaveLength(12);
      expect(Object.keys(result.correctMatches)).toHaveLength(10);
      expect(result.situations[0].id).toBe('11');
      expect(result.situations[9].id).toBe('20');
      expect(result.announcements[0].id).toBe('a');
      expect(result.announcements[11].id).toBe('l');

      const json = JSON.stringify(result);
      expect(json).not.toMatch(/"id":"[0-9a-f]{8}-/);
    });

    it('maps noMatch to "X" and derives correct letter from announcement sortOrder', async () => {
      mockPrisma.lesenTeil3Exercise.findFirst.mockResolvedValue(mockTeil3Exercise);

      const result = await (service as any).getTeil3Exercise();

      expect(result.correctMatches['15']).toBe('X');
      expect(result.correctMatches['11']).toBe('j');
      expect(result.correctMatches['12']).toBe('g');
      expect(result.correctMatches['13']).toBe('d');
      expect(result.correctMatches['14']).toBe('h');
      expect(result.correctMatches['16']).toBe('e');
      expect(result.correctMatches['17']).toBe('k');
      expect(result.correctMatches['18']).toBe('l');
      expect(result.correctMatches['19']).toBe('b');
      expect(result.correctMatches['20']).toBe('c');
    });

    it('throws NotFoundException when no exercise exists', async () => {
      mockPrisma.lesenTeil3Exercise.findFirst.mockResolvedValue(null);

      await expect((service as any).getTeil3Exercise()).rejects.toThrow(NotFoundException);
    });
  });
});
