/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CenterProfileService } from '../src/modules/centers/center-profile.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

describe('CenterProfileService', () => {
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
      country: 'Cameroon',
      city: 'Douala',
      logo_url: null,
    },
  };

  let prisma: any;
  let service: CenterProfileService;

  beforeEach(() => {
    prisma = {
      centerUser: {
        findFirst: jest.fn().mockResolvedValue(storedUser),
        update: jest.fn().mockResolvedValue(storedUser),
      },
      center: {
        update: jest.fn().mockResolvedValue(storedUser.center),
      },
      $transaction: jest.fn(async (operations: unknown) =>
        Array.isArray(operations) ? Promise.all(operations) : operations,
      ),
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          plan: 'TRIAL',
          trial_started_at: null,
          trial_ends_at: null,
          paid_until: null,
        }),
      },
      centerSeat: { findMany: jest.fn().mockResolvedValue([]) },
      get student(): never {
        throw new Error('Student must never be accessed');
      },
    };
    service = new CenterProfileService(prisma, new SubscriptionPolicyService());
  });

  it('scopes the profile read by both signed identifiers', async () => {
    await service.getProfile(signedIdentity);

    expect(prisma.centerUser.findFirst).toHaveBeenCalledWith({
      where: { id: 'owner-1', center_id: 'center-1' },
      include: { center: true },
    });
  });

  it('maps the stored row onto the public profile shape', async () => {
    await expect(service.getProfile(signedIdentity)).resolves.toEqual({
      centerUser: {
        id: 'owner-1',
        role: 'OWNER',
        firstName: 'Alain',
        lastName: 'Ngeukeu',
        email: 'manager@example.com',
        phone: '+237690000000',
        emailVerified: true,
      },
      center: {
        id: 'center-1',
        name: 'Goethe Language Center',
        country: 'Cameroon',
        city: 'Douala',
        logoUrl: null,
      },
      // Derived on every read, never stored. This row has all three required
      // fields, so it is complete. The rules themselves are covered in
      // center-onboarding-state.spec.ts; this asserts the block belongs to the
      // response shape, so a future refactor cannot quietly drop it.
      onboarding: { complete: true, missing: [] },
      // Also derived on every read: what the dashboard shell shows above every
      // page. Asserted whole here so a refactor cannot quietly drop a field
      // the shell depends on; the mapping rules themselves live in
      // center-account-state.spec.ts.
      account: {
        paymentStatus: 'unpaid',
        subscriptionStatus: 'TRIAL_PENDING',
        onboardingCompleted: false,
        onboardingStep: 3,
        trialEndsAt: null,
        paidUntil: null,
        graceEndsAt: null,
        studentsMayLearn: false,
        seats: { START: 0, PRO: 0, PREMIUM: 0 },
      },
    });
  });

  it('never exposes the password hash or verification columns', async () => {
    prisma.centerUser.findFirst.mockResolvedValue({
      ...storedUser,
      password_hash: 'top-secret-hash',
      email_verification_token: 'verification-token',
      password_reset_token: 'reset-token',
    });

    const result = await service.getProfile(signedIdentity);

    expect(JSON.stringify(result)).not.toContain('top-secret-hash');
    expect(JSON.stringify(result)).not.toContain('verification-token');
    expect(JSON.stringify(result)).not.toContain('reset-token');
  });

  it('rejects a profile that does not belong to the signed center', async () => {
    prisma.centerUser.findFirst.mockResolvedValue(null);

    await expect(service.getProfile(signedIdentity)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Each write now has its own route (see center-location-write.spec.ts for
  // what they accept); these keep the two rules that must hold for both.
  it('refuses to update anything outside the signed center', async () => {
    prisma.centerUser.findFirst.mockResolvedValue(null);

    await expect(
      service.updateCenter(signedIdentity, { name: 'Institut Lerniqo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateManager(signedIdentity, { phone: '+237690000001' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
    expect(prisma.center.update).not.toHaveBeenCalled();
  });

  it('rejects an update that carries no allowlisted field', async () => {
    await expect(
      service.updateCenter(signedIdentity, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateManager(signedIdentity, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
    expect(prisma.center.update).not.toHaveBeenCalled();
  });
});
