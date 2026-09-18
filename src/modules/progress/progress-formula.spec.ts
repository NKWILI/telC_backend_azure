import {
  alerts,
  readiness,
  roundScores,
  skillScores,
  type SkillScores,
  type TeilScore,
} from './progress-formula';

const NOW = new Date('2026-09-19T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const scores = (over: Partial<SkillScores>): SkillScores => ({
  HOEREN: null,
  LESEN: null,
  SPRACHBAUSTEINE: null,
  SCHREIBEN: null,
  SPRECHEN: null,
  ...over,
});

describe('skillScores', () => {
  it('averages the Teils, counting a Teil never attempted as 0', () => {
    // Hören has 3 Teils; only two were attempted.
    const teils: TeilScore[] = [
      { skill: 'HOEREN', teil: 1, score: 90 },
      { skill: 'HOEREN', teil: 2, score: 60 },
    ];

    expect(skillScores(teils).HOEREN).toBe(50); // (90 + 60 + 0) / 3
  });

  it('leaves a skill never practised as null, not 0', () => {
    const result = skillScores([{ skill: 'SCHREIBEN', teil: 1, score: 70 }]);

    expect(result.SCHREIBEN).toBe(70);
    expect(result.SPRECHEN).toBeNull();
  });

  it('ignores a Teil number the skill does not have', () => {
    const result = skillScores([
      { skill: 'SPRACHBAUSTEINE', teil: 1, score: 80 },
      { skill: 'SPRACHBAUSTEINE', teil: 5, score: 0 },
    ]);

    expect(result.SPRACHBAUSTEINE).toBe(40); // (80 + 0) / 2 Teils
  });
});

describe('readiness', () => {
  const allAt = (value: number) =>
    scores({
      HOEREN: value,
      LESEN: value,
      SPRACHBAUSTEINE: value,
      SCHREIBEN: value,
      SPRECHEN: value,
    });

  it('is null under 5 attempts: not enough exercises yet', () => {
    expect(readiness(allAt(90), 4)).toEqual({
      score: null,
      written: null,
      oral: null,
      ready: false,
    });
  });

  it('weighs written 75 and oral 25, the written skills equally', () => {
    const result = readiness(
      scores({
        HOEREN: 80,
        LESEN: 60,
        SPRACHBAUSTEINE: 70,
        SCHREIBEN: 90,
        SPRECHEN: 40,
      }),
      12,
    );

    // written = (80 + 60 + 70 + 90) / 4 = 75; 0.75 × 75 + 0.25 × 40 = 66.25
    expect(result).toEqual({ score: 66, written: 75, oral: 40, ready: false });
  });

  it('counts a skill never practised as 0, so skipping speaking is not ready', () => {
    expect(readiness(allAt(90), 20).ready).toBe(true);
    expect(readiness({ ...allAt(90), SPRECHEN: null }, 20)).toMatchObject({
      score: 68,
      oral: 0,
      ready: false,
    });
  });

  it('decides the pass on exact skill scores, not rounded ones', () => {
    // Sprechen Teils 60, 60, 59 = 59.67: shown as 60, but not a pass.
    const exact = skillScores([
      { skill: 'SPRECHEN', teil: 1, score: 60 },
      { skill: 'SPRECHEN', teil: 2, score: 60 },
      { skill: 'SPRECHEN', teil: 3, score: 59 },
    ]);
    const all = { ...allAt(90), SPRECHEN: exact.SPRECHEN };

    expect(roundScores(exact).SPRECHEN).toBe(60);
    expect(readiness(all, 20).ready).toBe(false);
    expect(readiness(all, 20).oral).toBe(60);
  });

  it('needs the pass mark in both parts, compared before rounding', () => {
    expect(readiness(allAt(60), 10).ready).toBe(true);
    // written = 59.75, which rounds to 60 but is not a pass.
    expect(readiness({ ...allAt(60), LESEN: 59 }, 10).ready).toBe(false);
  });
});

describe('alerts', () => {
  const enough = { score: 70, written: 70, oral: 70, ready: true };

  it('flags a student with no activity for 7 days, or never', () => {
    expect(alerts(scores({}), enough, daysAgo(8), NOW)).toContainEqual({
      type: 'inactive',
      lastActivityAt: daysAgo(8),
    });
    expect(alerts(scores({}), enough, null, NOW)[0].type).toBe('inactive');
    expect(alerts(scores({}), enough, daysAgo(6), NOW)).toEqual([]);
  });

  it('flags readiness under 40, and not a readiness still unknown', () => {
    const low = { score: 39, written: 40, oral: 30, ready: false };
    const unknown = { score: null, written: null, oral: null, ready: false };

    expect(alerts(scores({}), low, daysAgo(1), NOW)).toEqual([
      { type: 'low_progress', readiness: 39 },
    ]);
    expect(alerts(scores({}), unknown, daysAgo(1), NOW)).toEqual([]);
  });

  it('flags a practised skill under 45, never one not practised yet', () => {
    const found = alerts(
      scores({ LESEN: 44, HOEREN: 45 }),
      enough,
      daysAgo(1),
      NOW,
    );

    expect(found).toEqual([{ type: 'weak_skill', skill: 'LESEN', score: 44 }]);
  });
});
