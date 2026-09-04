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

const offerSql = await readFile('supabase/migrations/20260903064118_marketing_offer_gate.sql', 'utf8');
for (const required of [
  "add column offer_gate text", "offer_gate = 'free_pilot_active'", 'add column first_comment_text text',
  'cancel_marketing_offer_post', 'security invoker', "status = 'cancelled'", ":cancelled:",
  "status in ('scheduled', 'claimed', 'retryable_failed', 'provider_scheduled')",
  'revoke all on function public.cancel_marketing_offer_post(uuid, text) from public, anon, authenticated;',
]) {
  if (!offerSql.includes(required)) throw new Error(`Offer migration missing ${required}`);
}
if (/enrollment_settings|historical_pilot_admissions|free_pilot_ended_at/i.test(offerSql)) {
  throw new Error('Marketing migration must not modify enrollment authority');
}
console.log('Offer gate and cancellation migration contract verified.');

const onlineSql = await readFile('supabase/migrations/20260904070000_online_authoring_bridge.sql', 'utf8');
for (const required of [
  'create table public.marketing_authoring_submissions',
  'chatgpt_submit_marketing_plan',
  'chatgpt_get_marketing_submission',
  'claim_marketing_authoring_submissions',
  'worker_claim_marketing_authoring_submissions',
  'for update skip locked',
  'enable row level security',
  'grant all on table public.marketing_authoring_submissions to service_role;',
  'revoke all on function public.chatgpt_submit_marketing_plan(jsonb, text) from public, anon, authenticated;',
]) {
  if (!onlineSql.toLowerCase().includes(required.toLowerCase())) {
    throw new Error(`Online authoring migration missing ${required}`);
  }
}
if (/insert\s+into\s+public\.marketing_posts|update\s+public\.marketing_posts|delete\s+from\s+public\.marketing_posts/i.test(onlineSql)) {
  throw new Error('Online submission RPC migration must never write marketing_posts');
}
console.log('Online authoring bridge migration contract verified.');
