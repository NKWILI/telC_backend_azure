/**
 * Load `.env.test` so integration suites talk to a disposable database rather
 * than the one in `.env`.
 *
 * DIRECT_URL is promoted to DATABASE_URL on purpose. These suites exercise
 * interactive `$transaction` callbacks at Serializable isolation, which hold a
 * single connection across several statements. Neon's `-pooler` endpoint is
 * PgBouncer in transaction mode and multiplexes connections underneath that,
 * so running through it would measure the pooler instead of Postgres.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.test') });

if (!process.env.DIRECT_URL) {
  throw new Error(
    'Integration tests require .env.test with DATABASE_URL and DIRECT_URL ' +
      'pointing at a disposable database branch.',
  );
}

// Refuse to run against anything that is not the scratch branch. An integration
// suite that truncates center tables must never reach the live database.
if (/ep-wandering-hall/.test(process.env.DIRECT_URL)) {
  throw new Error(
    'DIRECT_URL points at the live database. Integration tests must target a ' +
      'disposable branch.',
  );
}

process.env.DATABASE_URL = process.env.DIRECT_URL;

process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-'.padEnd(64, 'a');
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-'.padEnd(
  64,
  'b',
);
process.env.TOKEN_HMAC_SECRET ??= 'integration-hmac-secret-'.padEnd(64, 'c');
