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
    ...over,
  });

  let prisma: any;
  let tokenCrypto: any;
  let service: CenterStudentsService;

  beforeEach(() => {
    prisma = {
      student: {
        findMany: jest.fn().mockResolvedValue([row()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(row()),
        update: jest.fn().mockImplementation(({ data }) => row(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    tokenCrypto = {
      generateToken: jest.fn().mockReturnValue('raw-key'),
      hashToken: jest.fn().mockReturnValue('hashed-key'),
    };
    service = new CenterStudentsService(prisma, tokenCrypto);
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

  describe('update', () => {
    it('changes only the allowlisted fields', async () => {
      await service.update(identity, 'student-1', {
        firstName: 'Awa-Marie',
        phone: '+237690000001',
      });

      expect(prisma.student.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { first_name: 'Awa-Marie', phone: '+237690000001' },
      });
    });

    it('refuses an update with no allowlisted field', async () => {
      await expect(
        service.update(identity, 'student-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('proves ownership before writing', async () => {
      prisma.student.findFirst.mockResolvedValue(null);

      await expect(
        service.update(identity, 'other-1', { firstName: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.student.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('unlinks rather than deleting, so the account survives', async () => {
      await service.remove(identity, 'student-1');

      // Deleting would destroy a person's learning history because an
      // administrator tidied a roster.
      expect(prisma.student.updateMany).toHaveBeenCalledWith({
        where: { id: 'student-1', center_id: 'center-1' },
        data: { center_id: null },
      });
    });

    it('frees the seat immediately', async () => {
      const result = await service.remove(identity, 'student-1');

      expect(result).toEqual({ removed: true });
    });

    it('refuses to touch another center student', async () => {
      prisma.student.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(identity, 'other-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
