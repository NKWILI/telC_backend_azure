/**
 * Whether a center can exist before it knows where it is, is a claim about
 * three NOT NULL constraints. A mock has no constraints, so only Postgres can
 * answer it.
 *
 * Registration is being reduced to five fields — name, manager name, email,
 * password — which leaves country, city and the manager's phone to be
 * collected later during onboarding. That is impossible while the columns
 * refuse null.
 *
 * Runs against the disposable branch in `.env.test`, over the direct endpoint.
 */
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/shared/services/prisma.service';

const prisma = new PrismaService();

/**
 * Managers first. `CenterUser.center_id` is a required relation with no
 * cascade, so Postgres refuses to delete a center that still has one — which
 * is correct behaviour and worth not fighting.
 */
async function wipe() {
  await prisma.centerUser.deleteMany({
    where: { center: { name: { startsWith: 'Draft Test' } } },
  });
  await prisma.center.deleteMany({
    where: { name: { startsWith: 'Draft Test' } },
  });
}

const draftCenter = () =>
  prisma.center.create({
    data: { name: `Draft Test ${Date.now()}-${Math.random()}` },
  });

describe('a draft center against real Postgres', () => {
  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await prisma.onModuleDestroy();
  });

  describe('the center itself', () => {
    it('can be created knowing only its name', async () => {
      // Exactly what the five-field registration will write.
      const center = await draftCenter();

      expect(center.country_code).toBeNull();
      expect(center.city_id).toBeNull();
    });

    it('still accepts a country and city when they are known', async () => {
      // Optional, not unused: onboarding fills them in later.
      const center = await prisma.center.create({
        data: {
          name: `Draft Test complete ${Date.now()}`,
          country_code: 'CM',
          city_id: 'douala',
        },
      });

      expect(center.country_code).toBe('CM');
      expect(center.city_id).toBe('douala');
    });

    it('can be completed after the fact', async () => {
      // The onboarding step itself: a draft center filling in its profile.
      const center = await draftCenter();

      const completed = await prisma.center.update({
        where: { id: center.id },
        data: { country_code: 'CM', city_id: 'douala' },
      });

      expect(completed.country_code).toBe('CM');
      expect(completed.city_id).toBe('douala');
    });
  });

  describe('the manager', () => {
    it('can be created without a phone number', async () => {
      const center = await draftCenter();

      const manager = await prisma.centerUser.create({
        data: {
          center_id: center.id,
          first_name: 'Alain',
          last_name: 'Ngeukeu',
          email: `draft-${Date.now()}-${Math.random()}@draft.test`,
          password_hash: await bcrypt.hash('x', 4),
        },
      });

      expect(manager.phone).toBeNull();
    });

    it('still requires the fields registration does collect', async () => {
      // Making three columns optional must not quietly loosen the rest. A
      // manager with no email could never log in or be verified.
      const center = await draftCenter();

      await expect(
        prisma.$executeRaw`
          INSERT INTO center_users (id, center_id, first_name, last_name, password_hash, created_at, updated_at, last_seen_at)
          VALUES (${`no-email-${Date.now()}`}, ${center.id}, 'Alain', 'Ngeukeu', 'hash', now(), now(), now())
        `,
      ).rejects.toThrow();
    });
  });

  it('leaves the name required, since it is all registration collects', async () => {
    // If name were also optional, a five-field registration could write a row
    // that says nothing at all.
    await expect(
      prisma.$executeRaw`
        INSERT INTO centers (id, created_at, updated_at)
        VALUES (${`nameless-${Date.now()}`}, now(), now())
      `,
    ).rejects.toThrow();
  });
});
