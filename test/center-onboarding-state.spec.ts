/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { CenterProfileService } from '../src/modules/centers/center-profile.service';

/**
 * Onboarding completeness, derived on read.
 *
 * There is no stored flag on purpose. A column would need something to keep it
 * true, and when that runs late the value is wrong — the same reasoning that
 * left subscription status computed from timestamps rather than stored.
 *
 * `missing` exists so the dashboard renders its checklist without holding a
 * second copy of the rules. Add a fourth required field later and every
 * checklist updates with no frontend change.
 */
const identity = { centerUserId: 'owner-1', centerId: 'center-1' } as never;

/**
 * `center` is merged rather than replaced, so an override naming only
 * `country` keeps the id and name. Spreading the override over the whole row
 * would blank the rest of the center, which is a fixture bug that reads like a
 * service bug.
 */
const managerRow = (
  over: { phone?: string | null; center?: Record<string, unknown> } = {},
) => {
  const { center: centerOver, ...userOver } = over;

  return {
    id: 'owner-1',
    role: 'OWNER',
    first_name: 'Alain',
    last_name: 'Ngeukeu',
    email: 'manager@example.com',
    phone: '+237690000000',
    email_verified: true,
    ...userOver,
    center: {
      id: 'center-1',
      name: 'Institut Goethe Douala',
      country: 'CM',
      city: 'Douala',
      logo_url: null,
      ...(centerOver ?? {}),
    },
  };
};

describe('onboarding state on the center profile', () => {
  let prisma: any;
  let service: CenterProfileService;

  const given = (row: unknown) => {
    prisma.centerUser.findFirst.mockResolvedValue(row);
  };

  beforeEach(() => {
    prisma = { centerUser: { findFirst: jest.fn() } };
    service = new CenterProfileService(prisma);
  });

  it('reports a complete profile', async () => {
    given(managerRow());

    const profile: any = await service.getProfile(identity);

    expect(profile.onboarding).toEqual({ complete: true, missing: [] });
  });

  it('reports a freshly registered center as incomplete', async () => {
    // Exactly what five-field registration writes: a name and nothing else.
    given(managerRow({ phone: null, center: { country: null, city: null } }));

    const profile: any = await service.getProfile(identity);

    expect(profile.onboarding.complete).toBe(false);
    expect(profile.onboarding.missing).toEqual(['country', 'city', 'phone']);
  });

  describe('each field on its own', () => {
    it('names country when only that is absent', async () => {
      given(managerRow({ center: { country: null } }));

      const profile: any = await service.getProfile(identity);

      expect(profile.onboarding).toEqual({
        complete: false,
        missing: ['country'],
      });
    });

    it('names city when only that is absent', async () => {
      given(managerRow({ center: { city: null } }));

      const profile: any = await service.getProfile(identity);

      expect(profile.onboarding.missing).toEqual(['city']);
    });

    it('names phone when only that is absent', async () => {
      given(managerRow({ phone: null }));

      const profile: any = await service.getProfile(identity);

      expect(profile.onboarding.missing).toEqual(['phone']);
    });
  });

  describe('what does not count as complete', () => {
    it.each([
      ['an empty country', ''],
      ['a whitespace country', '   '],
    ])('treats %s as missing', async (_case, country) => {
      // A blank string is not an answer. Without this, a client could satisfy
      // the checklist by submitting spaces.
      given(managerRow({ center: { country } }));

      const profile: any = await service.getProfile(identity);

      expect(profile.onboarding.missing).toContain('country');
    });
  });

  it('does not require a logo', async () => {
    // Optional by decision: a center completes onboarding without one.
    given(managerRow({ center: { logo_url: null } }));

    const profile: any = await service.getProfile(identity);

    expect(profile.onboarding.complete).toBe(true);
    expect(profile.onboarding.missing).not.toContain('logoUrl');
  });

  it('keeps the order stable, so a checklist does not reshuffle', async () => {
    given(managerRow({ phone: null, center: { city: null } }));

    const profile: any = await service.getProfile(identity);

    // Declaration order, not discovery order: country, city, phone.
    expect(profile.onboarding.missing).toEqual(['city', 'phone']);
  });

  it('still returns the profile itself alongside the state', async () => {
    given(managerRow({ phone: null, center: { country: null, city: null } }));

    const profile: any = await service.getProfile(identity);

    expect(profile.center.name).toBe('Institut Goethe Douala');
    expect(profile.centerUser.email).toBe('manager@example.com');
  });
});
