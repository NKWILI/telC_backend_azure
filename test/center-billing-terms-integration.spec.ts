/**
 * Billing terms are a claim about the table, not about Prisma.
 *
 * The whole pricing authority rests on every center having terms to read. A
 * center created before this migration must come out of it priced, not null —
 * the same property the Phase 3 backfill had to be shown to have, where only a
 * real database could tell us whether pre-existing rows were covered.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import { PrismaService } from '../src/shared/services/prisma.service';

const prisma = new PrismaService();

const STANDARD_UNIT_PRICE_XAF = 4800;
const STANDARD_MIN_SEATS = 10;

async function wipe() {
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Billing Terms Test' } },
  });
}

const makeCenter = () =>
  prisma.center.create({
    data: {
      name: `Billing Terms Test ${Date.now()}-${Math.random()}`,
      country: 'Cameroon',
      city: 'Douala',
    },
  });

describe('center billing terms against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  it('prices a center that says nothing about pricing', async () => {
    // Registration does not mention money. The terms must arrive anyway, or
    // the pricing service has nothing to read for every center created so far.
    const center = await makeCenter();

    expect(center.unit_price_xaf).toBe(STANDARD_UNIT_PRICE_XAF);
    expect(center.min_seats).toBe(STANDARD_MIN_SEATS);
  });

  it('covers rows the migration found already in the table', async () => {
    // Inserted through raw SQL naming only the pre-migration columns, which is
    // as close as a test can get to a row that predates the change. If the
    // column were added without a default, this is where it would come back
    // null and the pricing service would have nothing to work with.
    const id = `legacy-${Date.now()}-${Math.random()}`;
    await prisma.$executeRaw`
      INSERT INTO centers (id, name, country, city, created_at, updated_at)
      VALUES (${id}, ${'Billing Terms Test legacy'}, 'Cameroon', 'Douala', now(), now())
    `;

    const legacy = await prisma.center.findUnique({ where: { id } });

    expect(legacy!.unit_price_xaf).toBe(STANDARD_UNIT_PRICE_XAF);
    expect(legacy!.min_seats).toBe(STANDARD_MIN_SEATS);
  });

  it('stores a partner price as an exact integer', async () => {
    // XAF has no minor units. A partner center is written by Phase 2; this
    // asserts the column can hold that value without rounding it.
    const center = await makeCenter();

    const updated = await prisma.center.update({
      where: { id: center.id },
      data: { unit_price_xaf: 4500 },
    });

    expect(updated.unit_price_xaf).toBe(4500);
  });

  it('refuses a negative price at the database, not only in code', async () => {
    // A price below zero is not a discount, it is a payout. The constraint
    // belongs in the table so no future code path can write one.
    const center = await makeCenter();

    await expect(
      prisma.$executeRaw`
        UPDATE centers SET unit_price_xaf = -1 WHERE id = ${center.id}
      `,
    ).rejects.toThrow();
  });

  it('refuses a zero or negative seat minimum', async () => {
    const center = await makeCenter();

    await expect(
      prisma.$executeRaw`
        UPDATE centers SET min_seats = 0 WHERE id = ${center.id}
      `,
    ).rejects.toThrow();
  });
});
