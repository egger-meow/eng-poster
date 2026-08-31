import { readFile } from 'node:fs/promises';
const sql = await readFile('supabase/migrations/20260831000000_marketing_engine.sql', 'utf8');

if (sql.includes('on all tables in schema public')) {
  throw new Error('Migration must never blanket revoke privileges on all public tables');
}

for (const table of ['marketing_content_plans', 'marketing_posts', 'marketing_assets', 'marketing_publish_attempts', 'marketing_token_health']) {
  if (!sql.includes(`revoke all on table public.${table} from anon, authenticated;`)) {
    throw new Error(`Migration missing explicit revoke for ${table}`);
  }
}

for (const required of ['claim_marketing_posts', 'enable row level security', 'marketing-media']) {
  if (!sql.includes(required)) throw new Error(`Migration missing ${required}`);
}

console.log('Migration contract verified.');

