// Inspect + fix Snipply DB schema via the Supavisor pooler
const { Client } = require('pg');

const ref = 'ujibkwqemqeyodxvmcjs';

async function main() {
  const client = new Client({
    host: 'aws-0-ap-southeast-2.pooler.supabase.com',
    port: 5432,
    user: `postgres.${ref}`,
    password: 'Xq7#mK2$vL9pR4@nW8yT3bJ!zQ6cF5',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  await client.connect();
  console.log('Connected');

  const before = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('users','videos','clips')
    ORDER BY table_name, ordinal_position;`);
  console.log('=== BEFORE ===');
  const grp = {};
  for (const r of before.rows) {
    grp[r.table_name] = grp[r.table_name] || [];
    grp[r.table_name].push(`${r.column_name}:${r.data_type}`);
    ` `;
  }
  for (const t of Object.keys(grp)) console.log(t + ' => ' + grp[t].join(', '));

  const sql = `
    -- USERS
    alter table public.users add column if not exists clips_this_month integer not null default 0;
    alter table public.users add column if not exists last_reset timestamptz default now();
    -- VIDEOS
    alter table public.videos add column if not exists file_key text;
    alter table public.videos add column if not exists original_name text;
    alter table public.videos add column if not exists youtube_url text;
    alter table public.videos add column if not exists clips_count integer default 0;
    alter table public.videos add column if not exists error text;
    -- CLIPS
    alter table public.clips add column if not exists file_key text;
    alter table public.clips add column if not exists title text;
    alter table public.clips add column if not exists start_time double precision;
    alter table public.clips add column if not exists end_time double precision;
    alter table public.clips add column if not exists virality_score integer default 0;
    alter table public.clips add column if not exists duration double precision;
    -- indexes
    create index if not exists clips_video_idx on public.clips (video_id);
    create index if not exists videos_user_idx on public.videos (user_id, created_at);
    create index if not exists clips_user_idx on public.clips (user_id, created_at);
  `;
  await client.query(sql);
  console.log('=== ALTERS APPLIED ===');

  const after = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('users','videos','clips')
    ORDER BY table_name, ordinal_position;`);
  const grp2 = {};
  for (const r of after.rows) {
    grp2[r.table_name] = grp2[r.table_name] || [];
    grp2[r.table_name].push(r.column_name);
  }
  console.log('=== AFTER ===');
  for (const t of Object.keys(grp2)) console.log(t + ' => ' + grp2[t].join(', '));

  // Ensure every logged-in user has defaults
  await client.query(`update public.users set clips_this_month = coalesce(clips_this_month, 0), last_reset = coalesce(last_reset, now());`);
  const counts = await client.query(`select (select count(*) from users) as users, (select count(*) from videos) as videos, (select count(*) from clips) as clips;`);
  console.log('ROW COUNTS:', counts.rows[0]);
  const u = await client.query(`select id, email, clips_this_month from users limit 5;`);
  console.log('USERS SAMPLE:', JSON.stringify(u.rows));
  await client.end();
}

main().catch((e) => { console.error('DB ERROR:', e.message); process.exit(1); });
