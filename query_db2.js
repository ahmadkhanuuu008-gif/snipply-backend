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
    const res = await client.query("SELECT id, status, error FROM videos WHERE error LIKE '%FFmpeg failed%' ORDER BY created_at DESC LIMIT 3");
    console.log('FFMPEG ERRORS:');
    for (const row of res.rows) {
      console.log('ID:', row.id);
      console.log('Status:', row.status);
      console.log('Full Error:', row.error);
      console.log('---');
    }
    client.release();
  } catch(e) {
    console.log('DB ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();
