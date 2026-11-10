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
    const res = await client.query("SELECT id, status, youtube_url, clips_count, error FROM videos ORDER BY created_at DESC LIMIT 10");
    console.log('RECENT VIDEOS:');
    for (const row of res.rows) {
      console.log('ID:', row.id.slice(0, 8));
      console.log('Status:', row.status);
      console.log('Title:', row.title || row.youtube_url?.slice(0, 50));
      console.log('Clips:', row.clips_count);
      if (row.error) console.log('Error:', row.error.slice(0, 120));
      console.log('---');
    }
    client.release();
  } catch(e) {
    console.log('DB ERROR:', e.message);
  } finally {
    await pool.end();
  }
})();
