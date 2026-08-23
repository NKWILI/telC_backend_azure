/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { StudentActivationService } from '../src/modules/centers/student-activation.service';

describe('StudentActivationService', () => {
  const DAY = 24 * 60 * 60 * 1000;

  const pending = (over: Record<string, unknown> = {}) => ({
    id: 'student-1',
    center_id: 'center-1',
    email: 'awa@example.com',
    password_hash: null,
    activation_key_hash: 'hashed-key',
    activation_key_expires: new Date(Date.now() + 5 * DAY),
    activated_at: null,
    ...over,
  });

  let prisma: any;
  let tx: any;
  let tokenCrypto: any;
  let authService: any;
  let service: StudentActivationService;

  beforeEach(() => {
    tx = {
      student: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      centerSubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      student: { findFirst: jest.fn().mockResolvedValue(pending()) },
      $transaction: jest.fn(async (cb: (c: any) => unknown) => cb(tx)),
    };
    tokenCrypto = { hashToken: jest.fn().mockReturnValue('hashed-key') };
    authService = {
      issueSessionForStudent: jest.fn().mockResolvedValue({
        accessToken: 'student-access-token',
        refreshToken: 'student-refresh-token',
      }),
    };
    service = new StudentActivationService(prisma, tokenCrypto, authService);
  });

  const activate = (over: Record<string, unknown> = {}) =>
    service.activate({
      key: 'raw-key',
      password: 'a-strong-password',
      deviceId: 'device-1',
      ip: '1.2.3.4',
      ...over,
    } as never);

  it('looks the student up by the hash, never the raw key', async () => {
    await activate();

    expect(tokenCrypto.hashToken).toHaveBeenCalledWith('raw-key');
    expect(prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ activation_key_hash: 'hashed-key' }),
      }),
    );
  });

  it('sets the password the student chose, hashed', async () => {
    await activate();

    const data = tx.student.updateMany.mock.calls[0][0].data;
    expect(await bcrypt.compare('a-strong-password', data.password_hash)).toBe(
      true,
    );
  });

  it('consumes the key so it cannot be used twice', async () => {
    await activate();

    const call = tx.student.updateMany.mock.calls[0][0];
    expect(call.where).toEqual(
      expect.objectContaining({
        id: 'student-1',
        activation_key_hash: 'hashed-key',
        activated_at: null,
      }),
    );
    expect(call.data.activation_key_hash).toBeNull();
    expect(call.data.activation_key_expires).toBeNull();
    expect(call.data.activated_at).toBeInstanceOf(Date);
  });

  it('records where the activation came from', async () => {
    await activate();

    // A center holds the key and can redeem it itself. This is the trace that
    // makes that visible after the fact.
    expect(tx.student.updateMany.mock.calls[0][0].data.activated_ip).toBe(
      '1.2.3.4',
    );
  });

  it('rejects a replay, because the predicate matches nothing', async () => {
    tx.student.updateMany.mockResolvedValue({ count: 0 });

    await expect(activate()).rejects.toThrow('ACTIVATION_KEY_INVALID');
  });

  it('rejects an unknown key', async () => {
    prisma.student.findFirst.mockResolvedValue(null);

    await expect(activate()).rejects.toThrow('ACTIVATION_KEY_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an expired key distinctly from an unknown one', async () => {
    prisma.student.findFirst.mockResolvedValue(
      pending({ activation_key_expires: new Date(Date.now() - 1) }),
    );

    await expect(activate()).rejects.toThrow('ACTIVATION_KEY_EXPIRED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a key for an account that already activated', async () => {
    prisma.student.findFirst.mockResolvedValue(
      pending({ activated_at: new Date() }),
    );

    await expect(activate()).rejects.toThrow('ACTIVATION_KEY_INVALID');
  });

  describe('the trial clock', () => {
    it('starts when the first student activates', async () => {
      await activate();

      const call = tx.centerSubscription.updateMany.mock.calls[0][0];
      expect(call.where).toEqual(
        expect.objectContaining({
          center_id: 'center-1',
          trial_started_at: null,
        }),
      );
      expect(call.data.trial_started_at).toBeInstanceOf(Date);
    });

    it('runs for thirty days', async () => {
      await activate();

      const { trial_started_at, trial_ends_at } =
        tx.centerSubscription.updateMany.mock.calls[0][0].data;
      const days = (trial_ends_at.getTime() - trial_started_at.getTime()) / DAY;
      expect(days).toBe(30);
    });

    it('cannot be restarted by a second student', async () => {
      // The predicate is what guarantees this: once trial_started_at is set,
      // the update matches zero rows and the clock does not move.
      tx.centerSubscription.updateMany.mockResolvedValue({ count: 0 });

      await expect(activate()).resolves.toBeDefined();
      expect(
        tx.centerSubscription.updateMany.mock.calls[0][0].where
          .trial_started_at,
      ).toBeNull();
    });

    it('is not started for a student who belongs to no center', async () => {
      prisma.student.findFirst.mockResolvedValue(pending({ center_id: null }));

      await activate();

      expect(tx.centerSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('starts inside the same transaction that consumes the key', async () => {
      await activate();

      // Separate transactions could consume a key and then fail to start the
      // trial, leaving a center that can never be billed for a student who is
      // already learning.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  it('returns an ordinary student session', async () => {
    const result = await activate();

    expect(authService.issueSessionForStudent).toHaveBeenCalled();
    expect(result.accessToken).toBe('student-access-token');
    expect(result.refreshToken).toBe('student-refresh-token');
  });

  it('rejects a password below the student policy', async () => {
    await expect(activate({ password: 'short' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
