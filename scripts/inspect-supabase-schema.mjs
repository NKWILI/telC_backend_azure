import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [key, ...rest] = trimmed.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
}

const pool = new Pool({ connectionString: process.env.SUPABASE_MIGRATION_URL, ssl: { rejectUnauthorized: false } });

const { rows } = await pool.query(`
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`);

let current = '';
for (const row of rows) {
  if (row.table_name !== current) {
    current = row.table_name;
    console.log(`\n📋 ${current}`);
  }
  console.log(`   ${row.column_name.padEnd(30)} ${row.data_type.padEnd(25)} nullable:${row.is_nullable} default:${row.column_default ?? 'none'}`);
}

await pool.end();
