/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CenterStudentsService } from '../src/modules/centers/center-students.service';

describe('CenterStudentsService', () => {
  const identity = { centerUserId: 'owner-1', centerId: 'center-1' } as never;
  const DAY = 24 * 60 * 60 * 1000;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'student-1',
    center_id: 'center-1',
    first_name: 'Awa',
    last_name: 'Mbarga',
    email: 'awa@example.com',
    phone: '+237690000000',
    activated_at: null,
    activation_key_expires: new Date(Date.now() + 5 * DAY),
    created_at: new Date(),
    last_seen_at: new Date(),
    tier: 'START',
    ...over,
  });

  let prisma: any;
  let tx: any;
  let tokenCrypto: any;
  let service: CenterStudentsService;

  beforeEach(() => {
    tx = {
      student: {
        findFirst: jest.fn().mockResolvedValue(row()),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ data }) => row(data)),
      },
      centerSeat: {
        findUnique: jest.fn().mockResolvedValue({ quantity: 5 }),
      },
    };
    prisma = {
      student: {
        findMany: jest.fn().mockResolvedValue([row()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockImplementation(({ data }) => row(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((cb: (c: any) => unknown) =>
        Promise.resolve(cb(tx)),
      ),
    };
    tokenCrypto = {
      generateToken: jest.fn().mockReturnValue('raw-key'),
      hashToken: jest.fn().mockReturnValue('hashed-key'),
    };
    service = new CenterStudentsService(prisma, tokenCrypto);
  });

  /**
   * The most common thing a school does after buying: a Start student decides
   * to sit the exam and needs Pro.
   *
   * The alternative was remove-and-re-add, which works but invites mistakes on
   * an account holding the student's whole history.
   */
  describe('moving a student between tiers', () => {
    it('writes the new tier', async () => {
      const view = await service.update(identity, 'student-1', {
        tier: 'PRO',
      });

      expect(tx.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { tier: 'PRO' },
      });
      expect(view.tier).toBe('PRO');
    });

    it('checks the target tier for a free seat, not the current one', async () => {
      await service.update(identity, 'student-1', { tier: 'PREMIUM' });

      expect(tx.centerSeat.findUnique).toHaveBeenCalledWith({
        where: {
          center_id_tier: { center_id: 'center-1', tier: 'PREMIUM' },
        },
        select: { quantity: true },
      });
    });

    it('refuses a move into a full tier', async () => {
      tx.centerSeat.findUnique.mockResolvedValue({ quantity: 2 });
      tx.student.count.mockResolvedValue(2);

      await expect(
        service.update(identity, 'student-1', { tier: 'PRO' }),
      ).rejects.toThrow('SEAT_LIMIT_REACHED');
      expect(tx.student.update).not.toHaveBeenCalled();
    });

    it('refuses a move into a tier the center holds no seats in', async () => {
      tx.centerSeat.findUnique.mockResolvedValue(null);

      await expect(
        service.update(identity, 'student-1', { tier: 'PREMIUM' }),
      ).rejects.toThrow('TIER_NOT_HELD');
      expect(tx.student.update).not.toHaveBeenCalled();
    });

    it('does not count the student being moved against the target tier', async () => {
      // Otherwise a student already in Pro could never be "moved" to Pro, and
      // a re-send of the same value would fail on a tier that is exactly full.
      tx.student.findFirst.mockResolvedValue(row({ tier: 'PRO' }));
      tx.centerSeat.findUnique.mockResolvedValue({ quantity: 1 });
      tx.student.count.mockResolvedValue(0);

      await expect(
        service.update(identity, 'student-1', { tier: 'PRO' }),
      ).resolves.toBeDefined();

      expect(tx.student.count).toHaveBeenCalledWith({
        where: {
          center_id: 'center-1',
          tier: 'PRO',
          id: { not: 'student-1' },
        },
      });
    });

    it('checks the seat and writes in one serializable transaction', async () => {
      // Two administrators moving two students into the last free Pro seat
      // would otherwise both read it free and both write.
      await service.update(identity, 'student-1', { tier: 'PRO' });

      expect(prisma.$transaction.mock.calls[0][1]).toEqual(
        expect.objectContaining({ isolationLevel: 'Serializable' }),
      );
    });

    it('refuses a student of another center before looking at seats', async () => {
      tx.student.findFirst.mockResolvedValue(null);

      await expect(
        service.update(identity, 'student-1', { tier: 'PRO' }),
      ).rejects.toThrow('STUDENT_NOT_FOUND');
      expect(tx.centerSeat.findUnique).not.toHaveBeenCalled();
    });

    it('moves a tier and a name together', async () => {
      await service.update(identity, 'student-1', {
        firstName: 'Awa',
        tier: 'PRO',
      });

      expect(tx.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { first_name: 'Awa', tier: 'PRO' },
      });
    });

    it('charges nothing today', async () => {
      // No pro-rating, by decision. Access changes now and the price
      // difference settles at renewal; a school moving a student to Pro on day
      // two gets Pro for most of a month at Start's price, which is tolerated
      // because the alternative is building pro-rating.
      await service.update(identity, 'student-1', { tier: 'PRO' });

      expect(tx.centerSeat.findUnique).toHaveBeenCalled();
      expect(prisma.payment).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns only students of the signed center', async () => {
      await service.list(identity, { page: 1, pageSize: 20 });

      expect(prisma.student.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { center_id: 'center-1' } }),
      );
    });

    it('paginates rather than returning every student at once', async () => {
      await service.list(identity, { page: 3, pageSize: 20 });

      const call = prisma.student.findMany.mock.calls[0][0];
      expect(call.skip).toBe(40);
      expect(call.take).toBe(20);
    });

    it('reports the total so a client can page through it', async () => {
      prisma.student.count.mockResolvedValue(57);

      const result = await service.list(identity, { page: 1, pageSize: 20 });

      expect(result.total).toBe(57);
      expect(result.page).toBe(1);
    });

    it('never exposes credentials or the activation key hash', async () => {
      prisma.student.findMany.mockResolvedValue([
        row({
          password_hash: 'secret-hash',
          activation_key_hash: 'secret-key-hash',
          password_reset_token: 'secret-reset',
        }),
      ]);

      const result = await service.list(identity, { page: 1, pageSize: 20 });

      const json = JSON.stringify(result);
      expect(json).not.toContain('secret-hash');
      expect(json).not.toContain('secret-key-hash');
      expect(json).not.toContain('secret-reset');
    });

    it('reports whether each student has activated', async () => {
      prisma.student.findMany.mockResolvedValue([
        row({ activated_at: new Date() }),
      ]);

      const result = await service.list(identity, { page: 1, pageSize: 20 });

      expect(result.students[0].activated).toBe(true);
    });
  });

  describe('get', () => {
    it('scopes the lookup by the signed center', async () => {
      await service.get(identity, 'student-1');

      expect(prisma.student.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'student-1', center_id: 'center-1' },
        }),
      );
    });

    it('answers 404 for another center student, never 403', async () => {
      // 403 would confirm the id exists somewhere, which is a probe a center
      // could use to enumerate other schools' rosters.
      prisma.student.findFirst.mockResolvedValue(null);

      await expect(service.get(identity, 'other-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // The read and the write both moved inside the transaction, because an
  // update can now consume a seat. They are asserted on the transaction client
  // for that reason, not because the assertions changed meaning.
  describe('update', () => {
    it('changes only the allowlisted fields', async () => {
      await service.update(identity, 'student-1', {
        firstName: 'Awa-Marie',
        phone: '+237690000001',
      });

      expect(tx.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { first_name: 'Awa-Marie', phone: '+237690000001' },
      });
    });

    it('refuses an update with no allowlisted field', async () => {
      await expect(
        service.update(identity, 'student-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.student.update).not.toHaveBeenCalled();
      // Refused before a transaction is opened: nothing to check in the
      // database, so nothing should hold a connection.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('proves ownership before writing', async () => {
      tx.student.findFirst.mockResolvedValue(null);

      await expect(
        service.update(identity, 'other-1', { firstName: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.student.update).not.toHaveBeenCalled();
    });

    it('does not touch seats when no tier is supplied', async () => {
      // A name change must not be able to fail because a tier is full.
      tx.centerSeat.findUnique.mockResolvedValue(null);

      await expect(
        service.update(identity, 'student-1', { firstName: 'Awa-Marie' }),
      ).resolves.toBeDefined();

      expect(tx.centerSeat.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      tx.student.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      tx.activationCode = {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
      tx.activationCodeEvent = { create: jest.fn().mockResolvedValue({}) };
    });

    it('unlinks rather than deleting, so the account survives', async () => {
      await service.remove(identity, 'student-1');

      // Deleting would destroy a person's learning history because an
      // administrator tidied a roster.
      expect(tx.student.updateMany).toHaveBeenCalledWith({
        where: { id: 'student-1', center_id: 'center-1' },
        data: { center_id: null },
      });
    });

    it('frees the seat immediately', async () => {
      const result = await service.remove(identity, 'student-1');

      expect(result).toEqual({ removed: true });
    });

    it('refuses to touch another center student', async () => {
      tx.student.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(identity, 'other-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.activationCode.updateMany).not.toHaveBeenCalled();
    });

    // Review finding 1: removal used to unlink the student and leave their
    // code connected — so they could never redeem at another school, and this
    // school kept counting the seat as used.
    it('releases the code the student held here, and records it', async () => {
      tx.activationCode.findMany.mockResolvedValue([{ id: 'code-1' }]);

      await service.remove(identity, 'student-1');

      expect(tx.activationCode.findMany).toHaveBeenCalledWith({
        where: {
          student_id: 'student-1',
          center_id: 'center-1',
          status: 'CONNECTED',
        },
        select: { id: true },
      });
      expect(tx.activationCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'code-1', status: 'CONNECTED' },
        data: { status: 'DEACTIVATED' },
      });
      expect(tx.activationCodeEvent.create).toHaveBeenCalledWith({
        data: {
          code_id: 'code-1',
          center_id: 'center-1',
          center_user_id: 'owner-1',
          from_status: 'CONNECTED',
          to_status: 'DEACTIVATED',
          student_id: 'student-1',
        },
      });
    });
  });

  describe('activation keys', () => {
    it('mints a key scoped to the signed center', async () => {
      const result = await service.issueActivationKey(identity, 'student-1');

      expect(prisma.student.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'student-1',
          center_id: 'center-1',
          activated_at: null,
        },
        data: expect.objectContaining({ activation_key_hash: 'hashed-key' }),
      });
      expect(result.activationKey).toBe('raw-key');
    });

    it('stores only the hash', async () => {
      await service.issueActivationKey(identity, 'student-1');

      const data = prisma.student.updateMany.mock.calls[0][0].data;
      expect(JSON.stringify(data)).not.toContain('raw-key');
    });

    it('refuses to re-key a student who already activated', async () => {
      // Re-keying an active account would let a center take it over.
      prisma.student.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.issueActivationKey(identity, 'student-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revokes an outstanding key', async () => {
      await service.revokeActivationKey(identity, 'student-1');

      expect(prisma.student.updateMany).toHaveBeenCalledWith({
        where: { id: 'student-1', center_id: 'center-1', activated_at: null },
        data: { activation_key_hash: null, activation_key_expires: null },
      });
    });
  });
});
