/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CenterProfileService } from '../src/modules/centers/center-profile.service';

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
      get student(): never {
        throw new Error('Student must never be accessed');
      },
    };
    service = new CenterProfileService(prisma);
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

  it('routes user fields and center fields to their own tables', async () => {
    await service.updateProfile(signedIdentity, {
      firstName: 'Alain-Michel',
      city: 'Yaounde',
    });

    expect(prisma.centerUser.update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { first_name: 'Alain-Michel' },
    });
    expect(prisma.center.update).toHaveBeenCalledWith({
      where: { id: 'center-1' },
      data: { city: 'Yaounde' },
    });
  });

  it('touches only the table a partial update names', async () => {
    await service.updateProfile(signedIdentity, { phone: '+237690000001' });

    expect(prisma.centerUser.update).toHaveBeenCalled();
    expect(prisma.center.update).not.toHaveBeenCalled();
  });

  it('refuses to update a profile outside the signed center', async () => {
    prisma.centerUser.findFirst.mockResolvedValue(null);

    await expect(
      service.updateProfile(signedIdentity, { city: 'Yaounde' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
    expect(prisma.center.update).not.toHaveBeenCalled();
  });

  it('rejects an update that carries no allowlisted field', async () => {
    await expect(
      service.updateProfile(signedIdentity, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
    expect(prisma.center.update).not.toHaveBeenCalled();
  });
});
