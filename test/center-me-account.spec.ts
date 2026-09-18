/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { CenterProfileService } from '../src/modules/centers/center-profile.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

/**
 * `GET /api/centers/me` is the one call the dashboard makes on every page. It
 * therefore has to answer three questions at once: who this is, where the
 * center stands, and what it holds — otherwise each page invents its own
 * combination of routes and they disagree.
 */
describe('CenterProfileService account state', () => {
  const signedIdentity = {
    centerUserId: 'owner-1',
    centerId: 'center-1',
  } as never;

  const storedUser = {
    id: 'owner-1',
    center_id: 'center-1',
    role: 'OWNER',
    first_name: 'Alain',
    last_name: 'Ngeukeu',
    email: 'manager@example.com',
    phone: '+237690000000',
    email_verified: true,
    center: {
      id: 'center-1',
      name: 'Goethe Language Center',
      country: 'CM',
      city: 'Douala',
      logo_url: null,
    },
  };

  let prisma: any;
  let service: CenterProfileService;

  const withSubscription = (over: Record<string, unknown> = {}) => ({
    plan: 'TRIAL',
    trial_started_at: null,
    trial_ends_at: null,
    paid_until: null,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      centerUser: {
        findFirst: jest.fn().mockResolvedValue(storedUser),
        update: jest.fn().mockResolvedValue(storedUser),
      },
      center: { update: jest.fn().mockResolvedValue(storedUser.center) },
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue(withSubscription()),
      },
      centerSeat: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operations: unknown) =>
        Array.isArray(operations) ? Promise.all(operations) : operations,
      ),
    };
    service = new CenterProfileService(prisma, new SubscriptionPolicyService());
  });

  it('reports a center that has done nothing yet as unpaid and unfinalized', async () => {
    const profile = await service.getProfile(signedIdentity);

    expect(profile.account).toEqual(
      expect.objectContaining({
        paymentStatus: 'unpaid',
        subscriptionStatus: 'TRIAL_PENDING',
        onboardingCompleted: false,
        onboardingStep: 3,
        // No trial has started and nothing is paid, so nobody may learn yet.
        // The center may still provision students — that is a different
        // question, and `SubscriptionPolicyService` keeps them apart.
        studentsMayLearn: false,
      }),
    );
  });

  it('reports a running trial with the date it ends, which the banner counts down to', async () => {
    const trialEndsAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    prisma.centerSubscription.findUnique.mockResolvedValue(
      withSubscription({
        trial_started_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        trial_ends_at: trialEndsAt,
      }),
    );

    const profile = await service.getProfile(signedIdentity);

    expect(profile.account.paymentStatus).toBe('trial');
    expect(profile.account.subscriptionStatus).toBe('TRIAL');
    expect(profile.account.onboardingCompleted).toBe(true);
    expect(profile.account.trialEndsAt).toEqual(trialEndsAt);
  });

  it('reports the seats a center holds, per tier, from the seat rows', async () => {
    prisma.centerSeat.findMany.mockResolvedValue([
      { tier: 'START', quantity: 7 },
      { tier: 'PRO', quantity: 3 },
    ]);

    const profile = await service.getProfile(signedIdentity);

    // Plan ids, the same words `GET /api/plans` uses. A client should not have
    // to know that the database spells them differently.
    expect(profile.account.seats).toEqual({ start: 7, pro: 3, premium: 0 });
  });

  it('reads the subscription scoped to the signed center, never an id from a client', async () => {
    await service.getProfile(signedIdentity);

    expect(prisma.centerSubscription.findUnique).toHaveBeenCalledWith({
      where: { center_id: 'center-1' },
      select: expect.any(Object),
    });
    expect(prisma.centerSeat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { center_id: 'center-1' } }),
    );
  });

  it('keeps the onboarding checklist, so the banner still lists what is missing', async () => {
    prisma.centerUser.findFirst.mockResolvedValue({
      ...storedUser,
      phone: null,
      center: { ...storedUser.center, city: null },
    });

    const profile = await service.getProfile(signedIdentity);

    expect(profile.onboarding).toEqual({
      complete: false,
      missing: ['city', 'phone'],
    });
    expect(profile.account.onboardingStep).toBe(1);
  });
});
