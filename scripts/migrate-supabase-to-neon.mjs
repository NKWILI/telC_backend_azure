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

const SUPABASE_URL = process.env.SUPABASE_MIGRATION_URL;
const NEON_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !NEON_URL) {
  console.error('❌ Missing SUPABASE_MIGRATION_URL or DATABASE_URL in .env');
  process.exit(1);
}

const supabase = new Pool({ connectionString: SUPABASE_URL, ssl: { rejectUnauthorized: false } });
const neon = new Pool({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });

function safeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') {
    try { JSON.parse(value); return value; } catch { return null; }
  }
  return null;
}

async function copyTable(tableName, jsonColumns = []) {
  const { rows } = await supabase.query(`SELECT * FROM "${tableName}"`);
  if (rows.length === 0) {
    console.log(`  ⚠️  ${tableName}: empty, skipping`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const columnList = columns.map(c => `"${c}"`).join(', ');
  const insertSql = `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const values = columns.map(c => jsonColumns.includes(c) ? safeJson(row[c]) : row[c]);
      await neon.query(insertSql, values);
      inserted++;
    } catch (err) {
      skipped++;
      if (skipped <= 3) console.log(`    ⚠️  skipped row in ${tableName}: ${err.message.slice(0, 80)}`);
    }
  }
  console.log(`  ✅ ${tableName}: ${inserted} rows copied${skipped ? `, ${skipped} skipped` : ''}`);
}

async function main() {
  console.log('🚀 Starting migration: Supabase → Neon\n');

  // [table, jsonColumns[]]
  const tables = [
    ['students', []],
    ['activation_codes', []],
    ['device_sessions', []],
    ['exam_sessions', []],
    ['gemini_sessions', []],
    ['teil_transcripts', ['conversation_history']],
    ['teil_evaluations', ['corrections_json']],
    ['writing_attempts', ['corrections']],
    ['listening_attempts', []],
    ['lesen_passages', []],
    ['lesen_questions', ['options']],
    ['lesen_sessions', []],
    ['lesen_results', ['user_answers']],
  ];

  for (const [table, jsonCols] of tables) {
    try {
      await copyTable(table, jsonCols);
    } catch (err) {
      console.error(`  ❌ ${table}: ${err.message}`);
    }
  }

  await supabase.end();
  await neon.end();
  console.log('\n✅ Migration complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
