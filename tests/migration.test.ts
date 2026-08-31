import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('database lease and security contract', () => {
  it('uses row locks, skip locked, and a unique idempotency key', () => {
    const sql = readFileSync('supabase/migrations/20260831000000_marketing_engine.sql', 'utf8').toLowerCase();
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('idempotency_key text not null unique');
    expect(sql).toContain("status = 'claimed'");
  });

  it('revokes permissions strictly from engine-owned tables and not blanket public schema', () => {
    const sql = readFileSync('supabase/migrations/20260831000000_marketing_engine.sql', 'utf8');
    expect(sql).not.toContain('on all tables in schema public');
    expect(sql).toContain('revoke all on table public.marketing_content_plans from anon, authenticated;');
    expect(sql).toContain('revoke all on table public.marketing_posts from anon, authenticated;');
    expect(sql).toContain('revoke all on table public.marketing_assets from anon, authenticated;');
    expect(sql).toContain('revoke all on table public.marketing_publish_attempts from anon, authenticated;');
    expect(sql).toContain('revoke all on table public.marketing_token_health from anon, authenticated;');
  });
});

