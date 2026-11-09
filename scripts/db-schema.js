// Utility: inspect Snipply DB schema (and optionally fix it with --fix)
const { Client } = require('pg');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ujibkwqemqeyodxvmcjs.supabase.co';
const ref = SUPABASE_URL.replace('https://', '').split('.')[0];
// DB password must be URL-encoded
const DB_PASS_ENC = 'Xq7%23mK2%24vL9pR4%40nW8yT3bJ%21zQ6cF5';

async function main() {
  const client = new Client({
    connectionString: `postgres://postgres.${ref}:${DB_PASS_ENC}@db.${ref}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });

  try {
    await client.connect();
    console.log('Connected to Postgres');

    const { rows } = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('users','videos','clips')
      ORDER BY table_name, ordinal_position;
    `);
    const byTable = {};
    for (const r of rows) {
      byTable[r.table_name] = byTable[r.table_name] || [];
      byTable[r.table_name].push(`${r.column_name} ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
    }
    for (const t of ['users', 'videos', 'clips']) {
      console.log(`\n== ${t} ==`);
      if (byTable[t]) byTable[t].forEach((c) => console.log('  ' + c));
      else console.log('  (MISSING TABLE)');
    }
  } catch (err) {
    console.error('DB ERROR:', err.message);
    process.exitCode = 2;
  } finally {
    try { await client.end(); } catch {}
  }
}

main();
