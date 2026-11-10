const { Pool } = require('pg');
const pool = new Pool({
  host: 'aws-0-ap-southeast-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.ujibkwqemqeyodxvmcjs',
  password: 'Xq7#mK2$vL9pR4@nW8yT3bJ!zQ6cF5',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});
(async () => {
  try {
    const client = await pool.connect();
    const res = await client.query("SELECT id, status, error FROM videos ORDER BY created_at DESC LIMIT 1");
    if (res.rows.length > 0) {
      const err = res.rows[0].error || '';
      console.log('ID:', res.rows[0].id);
      console.log('Status:', res.rows[0].status);
      console.log('Error length:', err.length);
      // Print last 1500 chars
      console.log('--- LAST 1500 CHARS ---');
      console.log(err.slice(-1500));
    }
    client.release();
  } catch(e) {
    console.log('DB ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();
