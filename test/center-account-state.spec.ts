import { deriveAccountState } from '../src/modules/centers/center-account-state';

/**
 * What the dashboard shows at the top of every page, worked out on read.
 *
 * Nothing here is stored. A stored `paymentStatus` needs a job to flip it when
 * a trial ends, and when that job runs late the center reads "trial" while its
 * students are already blocked — the failure direction being access nobody
 * paid for.
 */
describe('deriveAccountState', () => {
  const onboarding = { complete: true, missing: [] as string[] };

  it('reads a running trial as trial', () => {
    expect(
      deriveAccountState({
        subscriptionStatus: 'TRIAL',
        trialStartedAt: new Date('2027-01-01T00:00:00.000Z'),
        paidUntil: null,
        onboarding,
      }).paymentStatus,
    ).toBe('trial');
  });

  it('reads a paid center as paid, grace period included', () => {
    const paid = {
      trialStartedAt: null,
      paidUntil: new Date('2027-02-01T00:00:00.000Z'),
      onboarding,
    };

    expect(
      deriveAccountState({ ...paid, subscriptionStatus: 'ACTIVE' })
        .paymentStatus,
    ).toBe('paid');
    // Grace is still paid to the manager: access continues, and the dashboard
    // says "payment late" from `subscriptionStatus`, not by going unpaid.
    expect(
      deriveAccountState({ ...paid, subscriptionStatus: 'GRACE_PERIOD' })
        .paymentStatus,
    ).toBe('paid');
  });

  it('reads a center that has never started as unpaid', () => {
    expect(
      deriveAccountState({
        subscriptionStatus: 'TRIAL_PENDING',
        trialStartedAt: null,
        paidUntil: null,
        onboarding,
      }).paymentStatus,
    ).toBe('unpaid');
  });

  it('reads an expired trial as unpaid, while it stays finalized', () => {
    const state = deriveAccountState({
      subscriptionStatus: 'BLOCKED',
      trialStartedAt: new Date('2027-01-01T00:00:00.000Z'),
      paidUntil: null,
      onboarding,
    });

    expect(state.paymentStatus).toBe('unpaid');
    // Finalization is a door a center walks through once. Sending it back to
    // the wizard because its trial ran out would ask it to re-enter data it
    // already gave, instead of asking it to pay.
    expect(state.onboardingCompleted).toBe(true);
  });

  it('is not finalized before a trial or a payment has ever happened', () => {
    expect(
      deriveAccountState({
        subscriptionStatus: 'TRIAL_PENDING',
        trialStartedAt: null,
        paidUntil: null,
        onboarding,
      }).onboardingCompleted,
    ).toBe(false);
  });

  it('counts a past payment as finalized even once it has lapsed', () => {
    expect(
      deriveAccountState({
        subscriptionStatus: 'BLOCKED',
        trialStartedAt: null,
        paidUntil: new Date('2026-01-01T00:00:00.000Z'),
        onboarding,
      }).onboardingCompleted,
    ).toBe(true);
  });

  describe('the step the wizard resumes at', () => {
    const pending = {
      subscriptionStatus: 'TRIAL_PENDING' as const,
      trialStartedAt: null,
      paidUntil: null,
    };

    it('sends a center with nothing filled in to the manager step', () => {
      expect(
        deriveAccountState({
          ...pending,
          onboarding: {
            complete: false,
            missing: ['phone', 'country', 'city'],
          },
        }).onboardingStep,
      ).toBe(1);
    });

    it('sends a center that still owes school details to the school step', () => {
      expect(
        deriveAccountState({
          ...pending,
          onboarding: { complete: false, missing: ['country', 'city'] },
        }).onboardingStep,
      ).toBe(2);
    });

    it('sends a complete but unpaid center to the plan step', () => {
      expect(
        deriveAccountState({ ...pending, onboarding }).onboardingStep,
      ).toBe(3);
    });

    it('leaves a finalized center at the last step', () => {
      expect(
        deriveAccountState({
          subscriptionStatus: 'TRIAL',
          trialStartedAt: new Date('2027-01-01T00:00:00.000Z'),
          paidUntil: null,
          onboarding,
        }).onboardingStep,
      ).toBe(4);
    });
  });
});
