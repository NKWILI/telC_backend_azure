/**
 * The tier model, against real Postgres.
 *
 * A center holds seats per tier and may mix them. The claims here are all
 * about constraints — one row per tier, a free trial seat, a price that cannot
 * go negative — and constraints are the one thing a mock cannot have.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/shared/services/prisma.service';

const prisma = new PrismaService();

async function wipe() {
  await prisma.student.deleteMany({
    where: { email: { endsWith: '@seats.integration.test' } },
  });
  await prisma.centerSeat.deleteMany({
    where: { center: { name: { startsWith: 'Seats Test' } } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Seats Test' } },
  });
}

const makeCenter = () =>
  prisma.center.create({
    data: { name: `Seats Test ${Date.now()}-${Math.random()}` },
  });

describe('center seats against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  describe('holding seats', () => {
    it('lets a center hold several tiers at once', async () => {
      // The arrangement the pricing page sells: a mix, not one plan.
      const center = await makeCenter();

      await prisma.centerSeat.createMany({
        data: [
          {
            center_id: center.id,
            tier: 'START',
            quantity: 5,
            unit_price_xaf: 4500,
          },
          {
            center_id: center.id,
            tier: 'PRO',
            quantity: 3,
            unit_price_xaf: 10000,
          },
          {
            center_id: center.id,
            tier: 'PREMIUM',
            quantity: 2,
            unit_price_xaf: 20000,
          },
        ],
      });

      const seats = await prisma.centerSeat.findMany({
        where: { center_id: center.id },
        orderBy: { tier: 'asc' },
      });

      expect(seats).toHaveLength(3);
      expect(seats.reduce((n, s) => n + s.quantity, 0)).toBe(10);
    });

    it('refuses a second row for the same tier', async () => {
      // Quantity belongs in one row per tier. Two rows would mean the seat
      // count depends on remembering to sum them.
      const center = await makeCenter();
      await prisma.centerSeat.create({
        data: {
          center_id: center.id,
          tier: 'START',
          quantity: 5,
          unit_price_xaf: 4500,
        },
      });

      await expect(
        prisma.centerSeat.create({
          data: {
            center_id: center.id,
            tier: 'START',
            quantity: 1,
            unit_price_xaf: 4500,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('lets two centers hold the same tier independently', async () => {
      const a = await makeCenter();
      const b = await makeCenter();

      await prisma.centerSeat.create({
        data: {
          center_id: a.id,
          tier: 'START',
          quantity: 5,
          unit_price_xaf: 4500,
        },
      });

      await expect(
        prisma.centerSeat.create({
          data: {
            center_id: b.id,
            tier: 'START',
            quantity: 5,
            unit_price_xaf: 4800,
          },
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('the stamped price', () => {
    it('keeps a partner price that differs from the list price', async () => {
      // The whole point of stamping: raising the list price later must not
      // rewrite what this center agreed to.
      const center = await makeCenter();

      const seat = await prisma.centerSeat.create({
        data: {
          center_id: center.id,
          tier: 'START',
          quantity: 10,
          unit_price_xaf: 4500,
        },
      });

      expect(seat.unit_price_xaf).toBe(4500);
    });

    it('allows a free seat, which is how a trial is held', async () => {
      // A trial is an ordinary Start seat priced at zero, so the check must be
      // "not negative" rather than "positive".
      const center = await makeCenter();

      const seat = await prisma.centerSeat.create({
        data: {
          center_id: center.id,
          tier: 'START',
          quantity: 1,
          unit_price_xaf: 0,
        },
      });

      expect(seat.unit_price_xaf).toBe(0);
    });

    it('refuses a negative price', async () => {
      const center = await makeCenter();

      await expect(
        prisma.$executeRaw`
          INSERT INTO center_seats (id, center_id, tier, quantity, unit_price_xaf, created_at, updated_at)
          VALUES (${`neg-${Date.now()}`}, ${center.id}, 'START', 1, -1, now(), now())
        `,
      ).rejects.toThrow();
    });

    it('refuses a seat count of zero', async () => {
      // A row saying "no seats" is not the same as no row, and would make
      // every count ambiguous.
      const center = await makeCenter();

      await expect(
        prisma.$executeRaw`
          INSERT INTO center_seats (id, center_id, tier, quantity, unit_price_xaf, created_at, updated_at)
          VALUES (${`zero-${Date.now()}`}, ${center.id}, 'START', 0, 4500, now(), now())
        `,
      ).rejects.toThrow();
    });
  });

  describe('a student carries a tier', () => {
    const makeStudent = async (
      centerId: string | null,
      tier: 'START' | 'PRO' | 'PREMIUM' | null,
    ) =>
      prisma.student.create({
        data: {
          email: `s-${Date.now()}-${Math.random()}@seats.integration.test`,
          password_hash: await bcrypt.hash('x', 4),
          email_verified: true,
          center_id: centerId,
          tier,
        },
      });

    it('records which tier a center student occupies', async () => {
      const center = await makeCenter();

      const student = await makeStudent(center.id, 'PRO');

      expect(student.tier).toBe('PRO');
    });

    it('leaves the tier null for a student no center governs', async () => {
      // Students who predate centers, and anyone removed from one. The tier
      // has to be nullable or they could not exist.
      const student = await makeStudent(null, null);

      expect(student.tier).toBeNull();
    });

    it('loses its center on delete but KEEPS a stale tier', async () => {
      // Honest about what the schema does rather than what would be tidy.
      // `center_id` nulls itself through ON DELETE SET NULL; `tier` does not,
      // so a student outlives their center still marked PRO.
      //
      // That stale value must never be read on its own. A tier is only
      // meaningful alongside a center, or a student whose center was deleted
      // would keep Pro's larger quota with nobody paying for it. Every reader
      // therefore checks center_id first — asserted where the quota is
      // enforced, not here.
      const center = await makeCenter();
      const student = await makeStudent(center.id, 'PRO');

      await prisma.centerSeat.deleteMany({ where: { center_id: center.id } });
      await prisma.center.delete({ where: { id: center.id } });

      const reread = await prisma.student.findUnique({
        where: { id: student.id },
      });

      expect(reread!.center_id).toBeNull();
      expect(reread!.tier).toBe('PRO');
    });
  });

  it('removes a centers seats when the center goes', async () => {
    // Seats belong to the center and mean nothing without it, so they cascade
    // rather than being left as orphans.
    const center = await makeCenter();
    await prisma.centerSeat.create({
      data: {
        center_id: center.id,
        tier: 'START',
        quantity: 5,
        unit_price_xaf: 4500,
      },
    });

    await prisma.center.delete({ where: { id: center.id } });

    const orphans = await prisma.centerSeat.count({
      where: { center_id: center.id },
    });
    expect(orphans).toBe(0);
  });
});
