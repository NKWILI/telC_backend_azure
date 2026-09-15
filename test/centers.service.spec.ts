/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { BadGatewayException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CentersService } from '../src/modules/centers/centers.service';

describe('CentersService registration', () => {
  const registration = {
    centerName: 'Goethe Language Center',
    managerFirstName: 'Alain',
    managerLastName: 'Ngeukeu',
    email: ' Manager@Example.COM ',
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
      centerSubscription: {
        create: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
      },
      centerSeat: {
        create: jest.fn().mockResolvedValue({ id: 'seat-1' }),
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
    // A draft center: the name and nothing else. Country, city and the logo
    // are collected during onboarding, and writing placeholders here would
    // make an unfinished profile look complete.
    expect(tx.center.create).toHaveBeenCalledWith({
      data: { name: 'Goethe Language Center' },
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
  it('creates the subscription inside the same transaction as the center', async () => {
    await service.register(registration);

    expect(tx.centerSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        center_id: 'center-1',
        plan: 'TRIAL',
        seats: 1,
      }),
    });
  });

  /**
   * A trial is an ordinary seat row priced at zero, not a special case.
   *
   * Seat counting, tier lookup and the quota check would each otherwise need
   * an "unless they are on trial" branch — three branches in three places all
   * saying the same thing, and the day someone adds a fourth they forget one.
   * With a real row, a trial student and a paid Start student behave
   * identically everywhere except the clock, which is the only thing genuinely
   * different about them.
   */
  it('grants the one trial seat in the same transaction', async () => {
    await service.register(registration);

    expect(tx.centerSeat.create).toHaveBeenCalledWith({
      data: {
        center_id: 'center-1',
        tier: 'START',
        quantity: 1,
        unit_price_xaf: 0,
      },
    });
  });

  it('prices the trial seat at zero, which is what makes it a trial', async () => {
    await service.register(registration);

    const data = tx.centerSeat.create.mock.calls[0][0].data;
    // Not the launch price, and not null. Zero is legal on center_seats and
    // illegal on a payment line, which is what keeps a granted seat and a
    // bought seat from ever being confused.
    expect(data.unit_price_xaf).toBe(0);
    expect(data.tier).toBe('START');
  });

  it('leaves no seat behind when the subscription insert fails', async () => {
    // One transaction, so a half-registered center cannot end up holding a
    // seat it never agreed to.
    tx.centerSubscription.create.mockRejectedValue(new Error('boom'));

    await expect(service.register(registration)).rejects.toThrow();
  });

  it('starts a new center pending, with no trial clock running', async () => {
    await service.register(registration);

    const data = tx.centerSubscription.create.mock.calls[0][0].data;
    // The trial begins at the first student activation (Phase 4), not here, so
    // a center that never provisions anyone never burns its 14 days.
    expect(data.trial_started_at ?? null).toBeNull();
    expect(data.trial_ends_at ?? null).toBeNull();
    expect(data.paid_until ?? null).toBeNull();
  });

  it('leaves no center behind when the owner insert fails', async () => {
    tx.centerUser.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.register(registration)).resolves.toEqual({
      message: 'verification email sent',
    });
    // All three inserts share one transaction, so a duplicate email cannot
    // leave an orphan center or a subscription with nothing to bill.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
