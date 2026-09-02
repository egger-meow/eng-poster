import { getSupabase } from '../src/db/client.js';
import { DateTime } from 'luxon';

async function main() {
  const db = getSupabase();
  const now = DateTime.now().setZone('Asia/Taipei');
  const todayStr = now.toISODate()!;
  const past14Str = now.minus({ days: 14 }).toISODate()!;

  console.log('--- Current Time ---');
  console.log('Now:', now.toISO());
  console.log('Today:', todayStr);

  console.log('\n--- All Marketing Assets ---');
  const { data: assets, error: assetsErr } = await db
    .from('marketing_assets')
    .select('id, source, concept, priority, usage_count, last_used_at, topics, allowed_platforms')
    .order('priority', { ascending: false });
  if (assetsErr) console.error('Assets error:', assetsErr);
  else console.table(assets);

  console.log('--- Marketing Content Plans (Past 14 days) ---');
  const { data: plans, error: plansErr } = await db
    .from('marketing_content_plans')
    .select('id, plan_date, archetype, topic, audience, campaign_slug, provenance, created_at')
    .gte('plan_date', past14Str)
    .order('plan_date', { ascending: false });
  if (plansErr) console.error('Plans error:', plansErr);
  else console.log(JSON.stringify(plans, null, 2));

  console.log('\n--- Marketing Posts (Since 2026-09-01) ---');
  const { data: posts, error: postsErr } = await db
    .from('marketing_posts')
    .select('id, platform, asset_mode, scheduled_for, status, idempotency_key, media_asset_id, copy_text')
    .gte('scheduled_for', '2026-09-01T00:00:00+08:00')
    .order('scheduled_for', { ascending: true });
  if (postsErr) console.error('Posts error:', postsErr);
  else console.log(JSON.stringify(posts, null, 2));
}

main().catch(console.error);
