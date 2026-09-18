import { resetAllowance } from '../src/modules/centers/code-reset-allowance';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-20T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const connected = (at: Date) => ({
  created_at: at,
  to_status: 'CONNECTED' as const,
  previous_code: null,
});
const reset = (at: Date) => ({
  created_at: at,
  to_status: 'ACTIVATED' as const,
  previous_code: 'LQ-OLD0-VALU',
});
const deactivated = (at: Date) => ({
  created_at: at,
  to_status: 'DEACTIVATED' as const,
  previous_code: null,
});

/** Paid until 1 April, so the current period is 1 March → 1 April. */
const paid = {
  trial_started_at: null,
  trial_ends_at: null,
  paid_until: new Date('2027-04-01T00:00:00.000Z'),
};

const trial = {
  trial_started_at: daysAgo(3),
  trial_ends_at: new Date(daysAgo(3).getTime() + 14 * DAY_MS),
  paid_until: null,
};

/**
 * How many times a seat may be handed on (D39), worked out from the event log
 * alone, so no counter can drift from what actually happened.
 *
 * A reset is an event whose old-value column is filled. A code is "used" when
 * the log holds a CONNECTED event since its last reset.
 */
describe('resetAllowance', () => {
  it('lets a code nobody ever redeemed be reset freely', () => {
    const allowance = resetAllowance([], paid, NOW);

    expect(allowance.used).toBe(false);
    expect(allowance.allowed).toBe(true);
  });

  it('gives a used code two resets per billing period', () => {
    const allowance = resetAllowance([connected(daysAgo(5))], paid, NOW);

    expect(allowance).toEqual({
      used: true,
      allowed: true,
      remaining: 2,
      resetsAvailableAt: paid.paid_until,
    });
  });

  it('refuses a third reset of a used seat in the same period', () => {
    const events = [
      connected(daysAgo(15)),
      reset(daysAgo(12)),
      connected(daysAgo(10)),
      reset(daysAgo(6)),
      connected(daysAgo(2)),
    ];

    expect(resetAllowance(events, paid, NOW)).toEqual({
      used: true,
      allowed: false,
      remaining: 0,
      resetsAvailableAt: paid.paid_until,
    });
  });

  it('does not count resets from an earlier billing period', () => {
    const events = [
      connected(daysAgo(60)),
      reset(daysAgo(50)),
      connected(daysAgo(45)),
      reset(daysAgo(40)),
      connected(daysAgo(2)),
    ];

    expect(resetAllowance(events, paid, NOW).remaining).toBe(2);
  });

  it('does not count a reset of a code that had not been used', () => {
    // A leaked or mistyped code, reset before anyone redeemed it, costs
    // nothing — so it must not eat into the allowance either.
    const events = [
      reset(daysAgo(10)),
      reset(daysAgo(8)),
      connected(daysAgo(2)),
    ];

    expect(resetAllowance(events, paid, NOW).remaining).toBe(2);
  });

  it('forgets a connection that happened before the last reset', () => {
    const events = [connected(daysAgo(10)), reset(daysAgo(5))];

    const allowance = resetAllowance(events, paid, NOW);

    expect(allowance.used).toBe(false);
    expect(allowance.allowed).toBe(true);
  });

  it('counts a code that was redeemed and then taken back as used', () => {
    // Used is about the log, not the current status: a seat someone held is
    // still a seat that moved, even after a deactivation.
    const events = [connected(daysAgo(4)), deactivated(daysAgo(2))];

    expect(resetAllowance(events, paid, NOW).used).toBe(true);
  });

  it('allows a trial code one reset during the trial', () => {
    expect(resetAllowance([connected(daysAgo(2))], trial, NOW)).toEqual({
      used: true,
      allowed: true,
      remaining: 1,
      resetsAvailableAt: null,
    });

    const afterOne = [
      connected(daysAgo(2)),
      reset(daysAgo(1)),
      connected(daysAgo(1)),
    ];
    expect(resetAllowance(afterOne, trial, NOW).allowed).toBe(false);
  });
});
