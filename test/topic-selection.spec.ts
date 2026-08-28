import {
  SPEAKING_TOPICS,
  SpeakingTopic,
} from '../src/modules/speaking/room/speaking-topics.data';

describe('B1 speaking topic catalog', () => {
  it('contains exactly 60 B1 Teil 2 topics', () => {
    expect(SPEAKING_TOPICS).toHaveLength(60);
    expect(SPEAKING_TOPICS.every((topic) => topic.level === 'B1')).toBe(true);
    expect(SPEAKING_TOPICS.every((topic) => topic.teil === 2)).toBe(true);
  });

  it('uses unique stable topic IDs', () => {
    const ids = SPEAKING_TOPICS.map((topic) => topic.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^b1-t2-\d{3}$/.test(id))).toBe(true);
  });

  it('provides complete discussion material for every topic', () => {
    for (const topic of SPEAKING_TOPICS) {
      expectNonEmpty(topic, 'title');
      expectNonEmpty(topic, 'positionA');
      expectNonEmpty(topic, 'positionB');
      expect(topic.positionA).not.toBe(topic.positionB);
      expect(topic.followUpQuestions.length).toBeGreaterThanOrEqual(2);
      expect(topic.followUpQuestions.length).toBeLessThanOrEqual(4);
      expect(
        topic.followUpQuestions.every((question) => question.trim().length > 0),
      ).toBe(true);
    }
  });
});

function expectNonEmpty(
  topic: SpeakingTopic,
  field: 'title' | 'positionA' | 'positionB',
): void {
  expect(topic[field].trim().length).toBeGreaterThan(0);
}
