// Find the Supabase pooler region + attempt connection for this project
const dns = require('dns');
const { Client } = require('pg');

const ref = 'ujibkwqemqeyodxvmcjs';
const PASS_ENC = 'Xq7%23mK2%24vL9pR4%40nW8yT3bJ%21zQ6cF5';
const regions = [
  'us-east-1','us-east-2','us-west-1','us-west-2','ca-central-1',
  'eu-central-1','eu-west-1','eu-west-2','eu-west-3','eu-north-1','eu-south-1',
  'ap-southeast-1','ap-southeast-2','ap-northeast-1','ap-northeast-2','ap-northeast-3',
  'ap-south-1','ap-east-1','sa-east-1','me-south-1','af-south-1','me-central-1','ap-southeast-3'
];
const prefixes = ['aws-0', 'aws-1', 'aws-2'];

async function main() {
  // 1) DNS pass
  const resolvable = [];
  for (const p of prefixes) {
    for (const r of regions) {
      const host = `${p}-${r}.pooler.supabase.com`;
      try {
        await dns.promises.lookup(host);
        resolvable.push(host);
      } catch {}
    }
  }
  console.log('Resolvable pooler hosts:', resolvable.join(', ') || '(none)');

  // 2) Try connecting to each
  for (const host of resolvable) {
    const client = new Client({
      host,
      port: 5432,
      user: `postgres.${ref}`,
      password: 'Xq7#mK2$vL9pR4@nW8yT3bJ!zQ6cF5',
      database: 'postgres',
      'ssl': { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      const { rows } = await client.query('select 1 as ok, current_setting(\'server_version\') as v');
      console.log(`CONNECTED via ${host}:`, rows[0]);
      await client.end();
      console.log('WORKING_POOLER_HOST=' + host);
      return;
    } catch (err) {
      console.log(`${host}: ${err.message.slice(0, 80)}`);
      try { await client.end(); } catch {}
    }
  }
  console.log('NO pooler connection succeeded');
}

main();
