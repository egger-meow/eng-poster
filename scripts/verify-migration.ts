import { readFile } from 'node:fs/promises';
const sql = await readFile('supabase/migrations/20260831000000_marketing_engine.sql','utf8');
for (const required of ['marketing_content_plans','marketing_posts','marketing_assets','marketing_publish_attempts','marketing_token_health','claim_marketing_posts','enable row level security','marketing-media']) {
  if (!sql.includes(required)) throw new Error(`Migration missing ${required}`);
}
console.log('Migration contract verified.');
