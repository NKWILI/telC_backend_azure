/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CenterAuthService } from '../src/modules/centers/center-auth.service';

/**
 * Changing a password from inside the dashboard.
 *
 * Different from a reset: the caller is already signed in, so the old password
 * is the proof rather than an emailed code. Everything else matches reset —
 * every other device loses its session, because whoever knew the old password
 * may be holding one of them.
 */
describe('CenterAuthService.changePassword', () => {
  const signedIdentity = {
    centerUserId: 'owner-1',
    centerId: 'center-1',
    sessionId: 'session-1',
  } as never;

  const currentPassword = 'OldPassw0rd!';
  const newPassword = 'NewPassw0rd!';

  let prisma: any;
  let service: CenterAuthService;
  let storedUser: any;

  beforeEach(async () => {
    storedUser = {
      id: 'owner-1',
      center_id: 'center-1',
      email: 'manager@example.com',
      password_hash: await bcrypt.hash(currentPassword, 4),
    };

    prisma = {
      centerUser: {
        findFirst: jest.fn().mockResolvedValue(storedUser),
        update: jest.fn().mockResolvedValue(storedUser),
      },
      centerDeviceSession: {
        findMany: jest.fn().mockResolvedValue([{ id: 'session-2' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    // The rate limit lives on the controller, as it does for login and reset
    // (see center-auth.controller.spec.ts); this service owns the rules.
    service = new CenterAuthService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  const change = (over: Record<string, string> = {}) =>
    service.changePassword(signedIdentity, {
      currentPassword,
      newPassword,
      ...over,
    });

  it('stores a hash of the new password, never the password', async () => {
    await change();

    const written = prisma.centerUser.update.mock.calls[0][0];
    expect(written.where).toEqual({ id: 'owner-1' });
    expect(written.data.password_hash).not.toBe(newPassword);
    await expect(
      bcrypt.compare(newPassword, written.data.password_hash),
    ).resolves.toBe(true);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    await expect(change({ currentPassword: 'NotTheOne1!' })).rejects.toThrow(
      new BadRequestException('WRONG_CURRENT_PASSWORD'),
    );
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
  });

  it('logs out every other device, and leaves the caller signed in', async () => {
    await change();

    expect(prisma.centerDeviceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          center_user_id: 'owner-1',
          id: { not: 'session-1' },
          revoked_at: null,
        }),
      }),
    );
  });

  it('refuses a new password that would not pass registration', async () => {
    await expect(change({ newPassword: 'short1!' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(change({ newPassword: 'alllowercase1!' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(change({ newPassword: 'NoDigitsHere!' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(change({ newPassword: 'NoSpecial1234' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
  });

  it('refuses reusing the password already in place', async () => {
    await expect(change({ newPassword: currentPassword })).rejects.toThrow(
      new BadRequestException('PASSWORD_UNCHANGED'),
    );
    expect(prisma.centerUser.update).not.toHaveBeenCalled();
  });

  it('refuses a caller whose user no longer belongs to the signed center', async () => {
    prisma.centerUser.findFirst.mockResolvedValue(null);

    await expect(change()).rejects.toBeInstanceOf(NotFoundException);
  });
});
