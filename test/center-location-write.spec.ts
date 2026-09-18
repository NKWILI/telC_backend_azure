/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { CenterProfileService } from '../src/modules/centers/center-profile.service';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';

/**
 * Writing where a school and its manager are.
 *
 * Two routes rather than one, because the rules are not the same: the address
 * rules belong to the school's country, and nothing is ever posted to a
 * manager. One route validating both would need a branch per field.
 */
describe('CenterProfileService location writes', () => {
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
    country_code: null,
    region_id: null,
    city_id: null,
    city_other: null,
    center: {
      id: 'center-1',
      name: 'Goethe Language Center',
      country: null,
      city: null,
      logo_url: null,
      country_code: 'CM',
      region_id: 'littoral',
      city_id: 'douala',
      city_other: null,
      district: 'Akwa',
      postal_code: null,
      street: null,
      house_number: null,
    },
  };

  let prisma: any;
  let service: CenterProfileService;

  const centerWrite = () => prisma.center.update.mock.calls[0][0].data;
  const managerWrite = () => prisma.centerUser.update.mock.calls[0][0].data;

  beforeEach(() => {
    prisma = {
      centerUser: {
        findFirst: jest.fn().mockResolvedValue(storedUser),
        update: jest.fn().mockResolvedValue(storedUser),
      },
      center: { update: jest.fn().mockResolvedValue(storedUser.center) },
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          plan: 'TRIAL',
          trial_started_at: null,
          trial_ends_at: null,
          paid_until: null,
        }),
      },
      centerSeat: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (operations: unknown) =>
        Array.isArray(operations) ? Promise.all(operations) : operations,
      ),
    };
    service = new CenterProfileService(prisma, new SubscriptionPolicyService());
  });

  describe('the school', () => {
    it('fills the region in itself, so a client cannot file a city under the wrong one', async () => {
      await service.updateCenter(signedIdentity, {
        countryCode: 'CM',
        cityId: 'douala',
        district: 'Akwa',
      });

      expect(centerWrite()).toEqual(
        expect.objectContaining({
          country_code: 'CM',
          region_id: 'littoral',
          city_id: 'douala',
          city_other: null,
        }),
      );
    });

    it('accepts a town we do not list, rather than blocking the school', async () => {
      await service.updateCenter(signedIdentity, {
        countryCode: 'CM',
        cityOther: 'Kribi',
        district: 'Centre-ville',
      });

      expect(centerWrite()).toEqual(
        expect.objectContaining({
          region_id: null,
          city_id: null,
          city_other: 'Kribi',
        }),
      );
    });

    it('refuses a city that belongs to another country', async () => {
      await expect(
        service.updateCenter(signedIdentity, {
          countryCode: 'CM',
          cityId: 'essen',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.center.update).not.toHaveBeenCalled();
    });

    it('requires a district in Cameroon, where that is how an address is given', async () => {
      await expect(
        service.updateCenter(signedIdentity, {
          countryCode: 'CM',
          cityId: 'douala',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires street, number and postal code in Germany', async () => {
      await expect(
        service.updateCenter(signedIdentity, {
          countryCode: 'DE',
          cityId: 'essen',
          street: 'Hauptstraße',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.updateCenter(signedIdentity, {
        countryCode: 'DE',
        cityId: 'essen',
        street: 'Hauptstraße',
        houseNumber: '12',
        postalCode: '45127',
      });

      expect(centerWrite()).toEqual(
        expect.objectContaining({
          country_code: 'DE',
          region_id: 'nordrhein-westfalen',
          postal_code: '45127',
          house_number: '12',
        }),
      );
    });

    it('renames a school without touching its address', async () => {
      await service.updateCenter(signedIdentity, { name: 'Institut Lerniqo' });

      expect(centerWrite()).toEqual({ name: 'Institut Lerniqo' });
    });

    it('refuses a body that changes nothing', async () => {
      await expect(
        service.updateCenter(signedIdentity, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never writes to the manager row', async () => {
      await service.updateCenter(signedIdentity, { name: 'Institut Lerniqo' });

      expect(prisma.centerUser.update).not.toHaveBeenCalled();
    });
  });

  /**
   * The checklist decides whether a center may be charged, so it has to read
   * the columns the wizard now writes — and keep reading the old ones, or
   * every center that onboarded before this change would be sent back to a
   * form it already filled in.
   */
  describe('the onboarding checklist', () => {
    it('counts a structured location as complete', async () => {
      prisma.centerUser.findFirst.mockResolvedValue({
        ...storedUser,
        center: {
          ...storedUser.center,
          country: null,
          city: null,
          country_code: 'CM',
          city_id: 'douala',
        },
      });

      const profile = await service.getProfile(signedIdentity);

      expect(profile.onboarding).toEqual({ complete: true, missing: [] });
    });

    it('counts an unlisted town as a city, because the school did answer', async () => {
      prisma.centerUser.findFirst.mockResolvedValue({
        ...storedUser,
        center: {
          ...storedUser.center,
          country: null,
          city: null,
          country_code: 'CM',
          city_id: null,
          city_other: 'Kribi',
        },
      });

      const profile = await service.getProfile(signedIdentity);

      expect(profile.onboarding.complete).toBe(true);
    });

    it('still accepts the free text written before the structured columns existed', async () => {
      prisma.centerUser.findFirst.mockResolvedValue({
        ...storedUser,
        center: {
          ...storedUser.center,
          country: 'Cameroun',
          city: 'Douala',
          country_code: null,
          region_id: null,
          city_id: null,
          city_other: null,
        },
      });

      const profile = await service.getProfile(signedIdentity);

      expect(profile.onboarding.complete).toBe(true);
    });
  });

  describe('the manager', () => {
    it('stores the manager own location, region included', async () => {
      await service.updateManager(signedIdentity, {
        phone: '+237690111222',
        countryCode: 'CM',
        cityId: 'yaounde',
      });

      expect(managerWrite()).toEqual(
        expect.objectContaining({
          phone: '+237690111222',
          country_code: 'CM',
          region_id: 'centre',
          city_id: 'yaounde',
        }),
      );
    });

    it('asks for no address: nothing is posted to a manager', async () => {
      await service.updateManager(signedIdentity, {
        countryCode: 'CM',
        cityId: 'douala',
      });

      expect(managerWrite()).not.toHaveProperty('district');
      expect(managerWrite()).not.toHaveProperty('postal_code');
    });

    it('refuses an unknown country', async () => {
      await expect(
        service.updateManager(signedIdentity, {
          countryCode: 'FR',
          cityId: 'paris',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.centerUser.update).not.toHaveBeenCalled();
    });

    it('never writes to the center row', async () => {
      await service.updateManager(signedIdentity, { phone: '+237690111222' });

      expect(prisma.center.update).not.toHaveBeenCalled();
    });
  });
});
