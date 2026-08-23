import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import type { CenterSubscriptionRecord } from '../src/modules/centers/subscription-policy.service';

/**
 * The whole point of this service is that status comes from timestamps rather
 * than a stored column, so these tests drive it with an explicit clock and
 * assert the exact instant each boundary flips.
 */
describe('SubscriptionPolicyService', () => {
  const NOW = new Date('2026-06-15T12:00:00.000Z');
  const service = new SubscriptionPolicyService();

  const DAY = 24 * 60 * 60 * 1000;
  const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

  const subscription = (
    over: Partial<CenterSubscriptionRecord> = {},
  ): CenterSubscriptionRecord => ({
    plan: 'TRIAL',
    seats: 3,
    trial_started_at: null,
    trial_ends_at: null,
    paid_until: null,
    ...over,
  });

  describe('TRIAL_PENDING', () => {
    it('is the state of a center whose trial has never started', () => {
      const result = service.evaluate(subscription(), NOW);

      expect(result.status).toBe('TRIAL_PENDING');
      expect(result.studentsMayLearn).toBe(false);
      expect(result.graceEndsAt).toBeNull();
    });

    it('persists indefinitely, because the clock starts at first activation', () => {
      // A center can provision students and sit here for a year if none of
      // them ever activate. That is intended: the trial should not burn while
      // nobody is using it.
      const result = service.evaluate(subscription(), at(365 * DAY));

      expect(result.status).toBe('TRIAL_PENDING');
    });
  });

  describe('TRIAL', () => {
    const onTrial = subscription({
      trial_started_at: at(-10 * DAY),
      trial_ends_at: at(20 * DAY),
    });

    it('lets students learn while the trial is running', () => {
      const result = service.evaluate(onTrial, NOW);

      expect(result.status).toBe('TRIAL');
      expect(result.studentsMayLearn).toBe(true);
    });

    it('is still running one millisecond before it ends', () => {
      const result = service.evaluate(onTrial, at(20 * DAY - 1));

      expect(result.status).toBe('TRIAL');
      expect(result.studentsMayLearn).toBe(true);
    });

    it('blocks at exactly the expiry instant, with no grace', () => {
      // Grace is for a paying customer whose transfer is late. A trial user
      // owes nothing, so an expired trial blocks immediately and a 30-day
      // trial stays 30 days rather than quietly becoming 37.
      const result = service.evaluate(onTrial, at(20 * DAY));

      expect(result.status).toBe('BLOCKED');
      expect(result.studentsMayLearn).toBe(false);
      expect(result.graceEndsAt).toBeNull();
    });

    it('never grants grace to an expired trial, even one day later', () => {
      const result = service.evaluate(onTrial, at(21 * DAY));

      expect(result.status).toBe('BLOCKED');
    });
  });

  describe('ACTIVE', () => {
    const paid = subscription({
      plan: 'PAID',
      seats: 10,
      trial_started_at: at(-60 * DAY),
      trial_ends_at: at(-30 * DAY),
      paid_until: at(10 * DAY),
    });

    it('lets students learn while the paid period runs', () => {
      const result = service.evaluate(paid, NOW);

      expect(result.status).toBe('ACTIVE');
      expect(result.studentsMayLearn).toBe(true);
    });

    it('reports when grace would end, so a client can warn before it does', () => {
      const result = service.evaluate(paid, NOW);

      expect(result.graceEndsAt).toEqual(at(17 * DAY));
    });

    it('is still active one millisecond before the period ends', () => {
      expect(service.evaluate(paid, at(10 * DAY - 1)).status).toBe('ACTIVE');
    });

    it('outranks an expired trial underneath it', () => {
      // The trial ended 30 days ago; payment is what matters now.
      expect(service.evaluate(paid, NOW).status).toBe('ACTIVE');
    });
  });

  describe('GRACE_PERIOD', () => {
    const lapsed = subscription({
      plan: 'PAID',
      seats: 10,
      paid_until: at(-2 * DAY),
    });

    it('begins at exactly the instant the paid period ends', () => {
      const justPaid = subscription({ plan: 'PAID', paid_until: NOW });
      const result = service.evaluate(justPaid, NOW);

      expect(result.status).toBe('GRACE_PERIOD');
      expect(result.studentsMayLearn).toBe(true);
    });

    it('keeps students learning while a late payment is outstanding', () => {
      const result = service.evaluate(lapsed, NOW);

      expect(result.status).toBe('GRACE_PERIOD');
      expect(result.studentsMayLearn).toBe(true);
      expect(result.graceEndsAt).toEqual(at(5 * DAY));
    });

    it('still applies one millisecond before grace runs out', () => {
      const result = service.evaluate(lapsed, at(5 * DAY - 1));

      expect(result.status).toBe('GRACE_PERIOD');
    });

    it('blocks at exactly the end of the seventh day', () => {
      const result = service.evaluate(lapsed, at(5 * DAY));

      expect(result.status).toBe('BLOCKED');
      expect(result.studentsMayLearn).toBe(false);
    });
  });

  describe('BLOCKED', () => {
    it('is where a lapsed paid center lands after grace', () => {
      const long = subscription({ plan: 'PAID', paid_until: at(-30 * DAY) });

      expect(service.evaluate(long, NOW).status).toBe('BLOCKED');
    });

    it('still reports graceEndsAt so a client can explain what was missed', () => {
      const long = subscription({ plan: 'PAID', paid_until: at(-30 * DAY) });

      expect(service.evaluate(long, NOW).graceEndsAt).toEqual(at(-23 * DAY));
    });
  });

  describe('the access decision', () => {
    it.each([
      ['TRIAL_PENDING', subscription(), false],
      [
        'TRIAL',
        subscription({
          trial_started_at: at(-1 * DAY),
          trial_ends_at: at(DAY),
        }),
        true,
      ],
      ['ACTIVE', subscription({ plan: 'PAID', paid_until: at(DAY) }), true],
      [
        'GRACE_PERIOD',
        subscription({ plan: 'PAID', paid_until: at(-DAY) }),
        true,
      ],
      [
        'BLOCKED',
        subscription({ plan: 'PAID', paid_until: at(-30 * DAY) }),
        false,
      ],
    ])('%s → studentsMayLearn %s', (_status, record, expected) => {
      expect(service.evaluate(record, NOW).studentsMayLearn).toBe(expected);
    });

    it('agrees with its own status field, so callers can use either', () => {
      const record = subscription({ plan: 'PAID', paid_until: at(-DAY) });
      const result = service.evaluate(record, NOW);

      expect(result.studentsMayLearn).toBe(
        ['TRIAL', 'ACTIVE', 'GRACE_PERIOD'].includes(result.status),
      );
    });
  });

  it('defaults its clock to the present when none is supplied', () => {
    const running = subscription({
      trial_started_at: new Date(Date.now() - DAY),
      trial_ends_at: new Date(Date.now() + DAY),
    });

    expect(service.evaluate(running).status).toBe('TRIAL');
  });
});
