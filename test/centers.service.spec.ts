/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { BadGatewayException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CentersService } from '../src/modules/centers/centers.service';

describe('CentersService registration', () => {
  const registration = {
    centerName: 'Goethe Language Center',
    country: 'Cameroon',
    city: 'Douala',
    logoUrl: 'https://cdn.example.com/center.webp',
    managerFirstName: 'Alain',
    managerLastName: 'Ngeukeu',
    email: ' Manager@Example.COM ',
    phone: '+237690000000',
    password: 'private-password',
  };

  let prisma: any;
  let tx: any;
  let tokenCrypto: any;
  let emailService: any;
  let service: CentersService;

  beforeEach(() => {
    tx = {
      center: {
        create: jest.fn().mockResolvedValue({ id: 'center-1' }),
      },
      centerUser: {
        create: jest.fn().mockResolvedValue({ id: 'owner-1' }),
      },
    };
    prisma = {
      centerUser: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    tokenCrypto = {
      generateToken: jest.fn().mockReturnValue('raw-verification-token'),
      hashToken: jest.fn().mockReturnValue('hashed-verification-token'),
    };
    emailService = {
      sendCenterVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendExistingCenterVerificationEmail: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    service = new CentersService(prisma, tokenCrypto, emailService);
  });

  it('atomically creates one center and owner with normalized data and bcrypt-12', async () => {
    await service.register(registration);

    expect(prisma.centerUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'manager@example.com' },
      select: expect.any(Object),
    });
    expect(tx.center.create).toHaveBeenCalledWith({
      data: {
        name: 'Goethe Language Center',
        country: 'Cameroon',
        city: 'Douala',
        logo_url: 'https://cdn.example.com/center.webp',
      },
      select: { id: true },
    });

    const ownerData = tx.centerUser.create.mock.calls[0][0].data;
    expect(ownerData).toEqual(
      expect.objectContaining({
        center_id: 'center-1',
        role: 'OWNER',
        first_name: 'Alain',
        last_name: 'Ngeukeu',
        email: 'manager@example.com',
        phone: '+237690000000',
        email_verified: false,
        email_verification_token: 'hashed-verification-token',
      }),
    );
    expect(
      await bcrypt.compare(registration.password, ownerData.password_hash),
    ).toBe(true);
    expect(bcrypt.getRounds(ownerData.password_hash)).toBe(12);
  });

  it('sends the verification email only after the transaction commits', async () => {
    const events: string[] = [];
    prisma.$transaction.mockImplementation(
      async (callback: (client: any) => unknown) => {
        events.push('transaction-start');
        await callback(tx);
        events.push('transaction-committed');
      },
    );
    emailService.sendCenterVerificationEmail.mockImplementation(async () => {
      events.push('email-sent');
    });

    await service.register(registration);

    expect(events).toEqual([
      'transaction-start',
      'transaction-committed',
      'email-sent',
    ]);
  });

  it('returns the generic response without mutation for a verified email', async () => {
    prisma.centerUser.findUnique.mockResolvedValue({
      id: 'owner-1',
      email_verified: true,
      email_verification_expires: null,
    });

    await expect(service.register(registration)).resolves.toEqual({
      message: 'verification email sent',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.centerUser.updateMany).not.toHaveBeenCalled();
    expect(emailService.sendCenterVerificationEmail).not.toHaveBeenCalled();
  });

  it('does not rotate an unverified token inside the two-minute cooldown', async () => {
    prisma.centerUser.findUnique.mockResolvedValue({
      id: 'owner-1',
      email_verified: false,
      email_verification_expires: new Date(
        Date.now() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000,
      ),
    });

    await expect(service.register(registration)).resolves.toEqual({
      message: 'verification email sent',
    });
    expect(prisma.centerUser.updateMany).not.toHaveBeenCalled();
    expect(
      emailService.sendExistingCenterVerificationEmail,
    ).not.toHaveBeenCalled();
  });

  it('rotates only verification fields after cooldown and explains existing credentials', async () => {
    prisma.centerUser.findUnique.mockResolvedValue({
      id: 'owner-1',
      email_verified: false,
      email_verification_expires: new Date(Date.now() + 20 * 60 * 60 * 1000),
    });

    await service.register(registration);

    const update = prisma.centerUser.updateMany.mock.calls[0][0];
    expect(update.where).toEqual(
      expect.objectContaining({ id: 'owner-1', email_verified: false }),
    );
    expect(update.data).toEqual({
      email_verification_token: 'hashed-verification-token',
      email_verification_expires: expect.any(Date),
    });
    expect(update.data).not.toHaveProperty('password_hash');
    expect(update.data).not.toHaveProperty('center');
    expect(update.data).not.toHaveProperty('first_name');
    expect(
      emailService.sendExistingCenterVerificationEmail,
    ).toHaveBeenCalledWith('manager@example.com', 'raw-verification-token');
  });

  it('sends no email when another request wins the token-rotation race', async () => {
    prisma.centerUser.findUnique.mockResolvedValue({
      id: 'owner-1',
      email_verified: false,
      email_verification_expires: null,
    });
    prisma.centerUser.updateMany.mockResolvedValue({ count: 0 });

    await service.register(registration);

    expect(
      emailService.sendExistingCenterVerificationEmail,
    ).not.toHaveBeenCalled();
  });

  it('handles a concurrent unique-email collision without leaking account existence', async () => {
    prisma.$transaction
      .mockImplementationOnce(async (callback: (client: any) => unknown) =>
        callback(tx),
      )
      .mockRejectedValueOnce({ code: 'P2002' });

    const responses = await Promise.all([
      service.register(registration),
      service.register(registration),
    ]);

    expect(responses).toEqual([
      { message: 'verification email sent' },
      { message: 'verification email sent' },
    ]);
    expect(emailService.sendCenterVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('keeps the committed identity when email delivery fails', async () => {
    emailService.sendCenterVerificationEmail.mockRejectedValue(
      new Error('provider unavailable'),
    );

    await expect(service.register(registration)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.centerUser.create).toHaveBeenCalledTimes(1);
    expect(prisma.centerUser.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'owner-1',
        email_verified: false,
        email_verification_token: 'hashed-verification-token',
      },
      data: {
        email_verification_token: null,
        email_verification_expires: null,
      },
    });
  });

  it('clears a failed resend token so the owner can retry immediately', async () => {
    prisma.centerUser.findUnique.mockResolvedValue({
      id: 'owner-1',
      email_verified: false,
      email_verification_expires: new Date(Date.now() + 20 * 60 * 60 * 1000),
    });
    emailService.sendExistingCenterVerificationEmail.mockRejectedValue(
      new Error('provider unavailable'),
    );

    await expect(service.register(registration)).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    expect(prisma.centerUser.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'owner-1',
        email_verified: false,
        email_verification_token: 'hashed-verification-token',
      },
      data: {
        email_verification_token: null,
        email_verification_expires: null,
      },
    });
  });
});
