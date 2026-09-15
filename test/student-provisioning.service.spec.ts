/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { StudentProvisioningService } from '../src/modules/centers/student-provisioning.service';

describe('StudentProvisioningService', () => {
  const identity = { centerUserId: 'owner-1', centerId: 'center-1' } as never;

  const input = {
    firstName: 'Awa',
    lastName: 'Mbarga',
    email: 'awa@example.com',
    phone: '+237690000000',
    tier: 'START' as const,
  };

  let prisma: any;
  let tx: any;
  let tokenCrypto: any;
  let emailService: any;
  let service: StudentProvisioningService;

  beforeEach(() => {
    tx = {
      student: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'student-1',
          ...data,
        })),
      },
      centerSubscription: {
        findUnique: jest.fn().mockResolvedValue({ seats: 1 }),
      },
      centerSeat: {
        // One Start seat is what a fresh trialling center holds.
        findUnique: jest.fn().mockResolvedValue({ tier: 'START', quantity: 3 }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (c: any) => unknown) => cb(tx)),
    };
    tokenCrypto = {
      generateToken: jest.fn().mockReturnValue('raw-activation-key'),
      hashToken: jest.fn().mockReturnValue('hashed-activation-key'),
    };
    emailService = {
      sendStudentWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    service = new StudentProvisioningService(prisma, tokenCrypto, emailService);
  });

  it('creates the student inside the signed center', async () => {
    await service.provision(identity, input);

    const data = tx.student.create.mock.calls[0][0].data;
    expect(data.center_id).toBe('center-1');
    expect(data.first_name).toBe('Awa');
    expect(data.email).toBe('awa@example.com');
    // WhatsApp is the channel that actually reaches people in-market, so a
    // silently dropped phone would cost a renewal reminder later.
    expect(data.phone).toBe('+237690000000');
  });

  it('leaves the account without a password until the student activates', async () => {
    await service.provision(identity, input);

    const data = tx.student.create.mock.calls[0][0].data;
    // The center creates the account; only the student sets the credential.
    expect(data.password_hash ?? null).toBeNull();
    expect(data.activated_at ?? null).toBeNull();
  });

  it('marks the email verified, because the center vouched for it', async () => {
    await service.provision(identity, input);

    expect(tx.student.create.mock.calls[0][0].data.email_verified).toBe(true);
  });

  it('stores only the hash of the key and returns the raw one once', async () => {
    const result = await service.provision(identity, input);

    const data = tx.student.create.mock.calls[0][0].data;
    expect(data.activation_key_hash).toBe('hashed-activation-key');
    expect(JSON.stringify(data)).not.toContain('raw-activation-key');
    expect(result.activationKey).toBe('raw-activation-key');
  });

  it('expires the key seven days out', async () => {
    const before = Date.now();
    await service.provision(identity, input);

    const expires = tx.student.create.mock.calls[0][0].data
      .activation_key_expires as Date;
    const days = (expires.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('counts seats and inserts inside one serializable transaction', async () => {
    await service.provision(identity, input);

    // Counting outside the transaction would let two admins both read the
    // second-to-last seat and both insert.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual(
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    // Per tier, not per center. A Start student cannot sit in a Pro seat, so
    // counting the whole center would let a full tier borrow from a free one.
    expect(tx.student.count).toHaveBeenCalledWith({
      where: { center_id: 'center-1', tier: 'START' },
    });
  });

  it('refuses when every seat is taken', async () => {
    tx.student.count.mockResolvedValue(3);

    await expect(service.provision(identity, input)).rejects.toThrow(
      'SEAT_LIMIT_REACHED',
    );
    expect(tx.student.create).not.toHaveBeenCalled();
  });

  it('refuses a center already over its limit', async () => {
    // Dropping to a smaller plan leaves a center over the limit. Existing
    // students keep working; only new provisioning stops.
    tx.student.count.mockResolvedValue(9);
    tx.centerSeat.findUnique.mockResolvedValue({ tier: 'START', quantity: 5 });

    await expect(service.provision(identity, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows the very last seat', async () => {
    tx.student.count.mockResolvedValue(2);

    await expect(service.provision(identity, input)).resolves.toBeDefined();
  });

  /**
   * A seat belongs to a tier, so the seat check has to as well.
   *
   * Counting the center as a whole would let a center with its Start seats
   * full and a spare Pro seat add another Start student — who would then be
   * entitled to Start's allowance while occupying a seat nobody paid for at
   * that tier.
   */
  describe('the seat check is per tier', () => {
    it('writes the tier the center assigned', async () => {
      await service.provision(identity, { ...input, tier: 'PRO' });

      expect(tx.student.create.mock.calls[0][0].data.tier).toBe('PRO');
    });

    it('checks the seats of the requested tier, not another', async () => {
      await service.provision(identity, { ...input, tier: 'PREMIUM' });

      expect(tx.centerSeat.findUnique).toHaveBeenCalledWith({
        where: {
          center_id_tier: { center_id: 'center-1', tier: 'PREMIUM' },
        },
        select: { quantity: true },
      });
      expect(tx.student.count).toHaveBeenCalledWith({
        where: { center_id: 'center-1', tier: 'PREMIUM' },
      });
    });

    it('refuses a full tier even when another tier has room', async () => {
      // Three Start seats, three Start students. Pro seats being free is
      // irrelevant: this student is being put in Start.
      tx.centerSeat.findUnique.mockResolvedValue({ quantity: 3 });
      tx.student.count.mockResolvedValue(3);

      await expect(service.provision(identity, input)).rejects.toThrow(
        'SEAT_LIMIT_REACHED',
      );
      expect(tx.student.create).not.toHaveBeenCalled();
    });

    it('names the tier that is full, because a center holds several', () => {
      // "No seats left" is useless to a center holding three tiers.
      tx.centerSeat.findUnique.mockResolvedValue({ quantity: 3 });
      tx.student.count.mockResolvedValue(3);

      return expect(
        service.provision(identity, { ...input, tier: 'PRO' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ tier: 'PRO' }),
      });
    });

    it('refuses a tier the center holds no seats in', async () => {
      // No row at all, which is different from a full one: the center has
      // never bought this tier, so the answer is to buy it, not to wait.
      tx.centerSeat.findUnique.mockResolvedValue(null);

      await expect(
        service.provision(identity, { ...input, tier: 'PREMIUM' }),
      ).rejects.toThrow('TIER_NOT_HELD');
      expect(tx.student.create).not.toHaveBeenCalled();
    });

    it('names the tier it does not hold', () => {
      tx.centerSeat.findUnique.mockResolvedValue(null);

      return expect(
        service.provision(identity, { ...input, tier: 'PREMIUM' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ tier: 'PREMIUM' }),
      });
    });

    it('does not count students of other tiers against this one', async () => {
      // The count is scoped in the query, so a center with many Pro students
      // can still fill its one free Start seat.
      tx.centerSeat.findUnique.mockResolvedValue({ quantity: 1 });
      tx.student.count.mockResolvedValue(0);

      await expect(service.provision(identity, input)).resolves.toBeDefined();
    });
  });

  it('refuses an email that already belongs to someone', async () => {
    // Attaching would hand a school control of a stranger's account.
    tx.student.findUnique.mockResolvedValue({ id: 'someone-else' });

    await expect(service.provision(identity, input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.student.create).not.toHaveBeenCalled();
  });

  it('sends the welcome email after the transaction commits', async () => {
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async (cb: (c: any) => unknown) => {
      order.push('transaction');
      const r = await cb(tx);
      order.push('committed');
      return r;
    });
    emailService.sendStudentWelcomeEmail.mockImplementation(async () => {
      order.push('welcome-email');
    });

    await service.provision(identity, input);

    expect(order).toEqual(['transaction', 'committed', 'welcome-email']);
  });

  it('still provisions when the welcome email fails', async () => {
    // The email proves the address and surfaces a typo. It is not worth
    // failing a provision that already succeeded in the database.
    emailService.sendStudentWelcomeEmail.mockRejectedValue(
      new Error('provider down'),
    );

    await expect(service.provision(identity, input)).resolves.toBeDefined();
  });

  it('rejects a blank email rather than creating an unreachable account', async () => {
    await expect(
      service.provision(identity, { ...input, email: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
