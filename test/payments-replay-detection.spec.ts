/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
/**
 * Which unique violations count as a replay.
 *
 * This exists because the obvious implementation is wrong twice over. Checking
 * only `code === 'P2002'` treats any unique violation as a replay, so a bug in
 * another index answers 409 IDEMPOTENCY_KEY_REUSED — a client error the client
 * cannot act on. Checking `meta.target`, which is what Prisma's documentation
 * describes, matches nothing at all on this stack: the `PrismaPg` driver
 * adapter reports the constraint under `meta.driverAdapterError` and leaves
 * `target` undefined, so every replay became a 500.
 *
 * The shapes below are copied from a real Neon error, not imagined. Both are
 * pinned so a Prisma upgrade that moves to either one cannot break replay
 * detection silently — `payments-integration.spec` would catch it, but only
 * when someone runs it against a database.
 */
import { ConflictException } from '@nestjs/common';
import { PaymentsService } from '../src/modules/centers/payments.service';
import { PricingService } from '../src/modules/centers/pricing.service';
import { CenterSeatsService } from '../src/modules/centers/center-seats.service';

const identity = { centerId: 'center-1', centerUserId: 'owner-1' } as never;

/** What the driver adapter really produces, fields and all. */
const adapterViolation = (...fields: string[]) =>
  Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: {
      modelName: 'Payment',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { fields },
        },
      },
    },
  });

/** What Prisma's own engine produces, and what the docs describe. */
const engineViolation = (...target: string[]) =>
  Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target },
  });

const IDEMPOTENCY_SHAPES = [
  [
    'the driver adapter shape',
    adapterViolation('center_id', 'idempotency_key'),
  ],
  ['the engine shape', engineViolation('center_id', 'idempotency_key')],
] as const;

const OTHER_INDEX_SHAPES = [
  ['the driver adapter shape', adapterViolation('payment_id', 'tier')],
  ['the engine shape', engineViolation('payment_id', 'tier')],
] as const;

describe('recognising a replay', () => {
  let prisma: any;
  let payments: PaymentsService;
  let rows: Map<string, any>;

  /**
   * Just enough of the unique index to make a replay real: the second insert
   * on one key fails, and the row from the first is what a lookup finds. The
   * request hash is never computed here — it is stored as the service wrote it
   * and compared as the service compares it, so this cannot pass by
   * reimplementing the fingerprint.
   */
  const withIndexRaising = (violation: unknown) => {
    rows = new Map();

    prisma.$transaction = jest.fn(
      async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          center: prisma.center,
          centerSeat: prisma.centerSeat,
          student: prisma.student,
          payment: {
            create: ({ data }: any) => {
              const key = `${data.center_id}:${data.idempotency_key}`;
              if (rows.has(key)) {
                // Thrown rather than rejected so the lint rule about
                // rejection reasons is satisfied without weakening the test:
                // some of these violations deliberately are not Errors.
                throw violation;
              }

              const row = {
                id: `payment-${rows.size + 1}`,
                center_id: data.center_id,
                total_seats: data.total_seats,
                amount_xaf: data.amount_xaf,
                idempotency_key: data.idempotency_key,
                request_hash: data.request_hash,
                status: 'PENDING',
                created_at: new Date('2026-09-14T00:00:00.000Z'),
                lines: data.lines.create.map((line: any) => ({ ...line })),
              };
              rows.set(key, row);
              return Promise.resolve(row);
            },
          },
        }),
    );

    prisma.payment.findUnique = jest.fn(({ where }: any) => {
      const { center_id, idempotency_key } = where.center_id_idempotency_key;
      return Promise.resolve(
        rows.get(`${center_id}:${idempotency_key}`) ?? null,
      );
    });
  };

  beforeEach(() => {
    prisma = {
      center: {
        findUnique: jest.fn().mockResolvedValue({ _count: { students: 0 } }),
      },
      // A center that has finished its profile, so the gate is not what this
      // file is testing.
      centerUser: {
        findFirst: jest.fn().mockResolvedValue({
          phone: '+237690000000',
          center: { country_code: 'CM', city_id: 'douala', city_other: null },
        }),
      },
      centerSeat: { findMany: jest.fn().mockResolvedValue([]) },
      student: { groupBy: jest.fn().mockResolvedValue([]) },
      payment: { findUnique: jest.fn() },
    };

    payments = new PaymentsService(
      prisma,
      new PricingService(),
      new CenterSeatsService(prisma),
    );
  });

  describe('a violation of the idempotency index', () => {
    it.each(IDEMPOTENCY_SHAPES)(
      'answers the same intent from the original row: %s',
      async (_case, violation) => {
        withIndexRaising(violation);

        const first = await payments.create(identity, { START: 10 }, 'key-1');
        const replay = await payments.create(identity, { START: 10 }, 'key-1');

        expect(replay.id).toBe(first.id);
        expect(replay.amountXaf).toBe(first.amountXaf);
      },
    );

    it.each(IDEMPOTENCY_SHAPES)(
      'refuses a different intent on the same key: %s',
      async (_case, violation) => {
        withIndexRaising(violation);

        await payments.create(identity, { START: 10 }, 'key-1');

        await expect(
          payments.create(identity, { PRO: 10 }, 'key-1'),
        ).rejects.toThrow(ConflictException);
      },
    );
  });

  describe('a violation of any other index', () => {
    it.each(OTHER_INDEX_SHAPES)(
      'rethrows rather than blaming the key: %s',
      async (_case, violation) => {
        // `payment_lines` is unique per (payment, tier) and is written in the
        // same insert. A bug producing two lines for one tier is a server
        // fault, and calling it IDEMPOTENCY_KEY_REUSED would hide it behind a
        // 409 that tells the center to change its key.
        withIndexRaising(violation);
        rows.set('center-1:key-1', { id: 'squatter' });

        await expect(
          payments.create(identity, { START: 10 }, 'key-1'),
        ).rejects.toBe(violation);

        // Never looked for a replay, because this was not one.
        expect(prisma.payment.findUnique).not.toHaveBeenCalled();
      },
    );

    it('rethrows a violation carrying no constraint detail at all', async () => {
      // Neither shape present. Fail closed: a P2002 nobody can attribute is
      // not evidence of a replay.
      const violation = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: {},
      });
      withIndexRaising(violation);
      rows.set('center-1:key-1', { id: 'squatter' });

      await expect(
        payments.create(identity, { START: 10 }, 'key-1'),
      ).rejects.toBe(violation);

      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });
  });

  it('rethrows an error that is not a unique violation', async () => {
    // An amount over the integer ceiling, for instance. It must surface as
    // itself rather than as a payment conflict.
    const error = Object.assign(new Error('integer out of range'), {
      code: 'P2010',
    });
    withIndexRaising(error);
    rows.set('center-1:key-1', { id: 'squatter' });

    await expect(
      payments.create(identity, { START: 10 }, 'key-1'),
    ).rejects.toBe(error);
  });
});
