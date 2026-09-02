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
    expect(sql).toContain('revoke all on table public.marketing_token_health from anon, authenticated;');
  });

  it('enforces asset_mode check constraint in forward migration', () => {
    const baseSql = readFileSync('supabase/migrations/20260831000000_marketing_engine.sql', 'utf8').toLowerCase();
    expect(baseSql).not.toContain('asset_mode');

    const alterSql = readFileSync('supabase/migrations/20260901010000_post_asset_mode.sql', 'utf8').toLowerCase();
    expect(alterSql).toContain("asset_mode in ('text_only', 'image_post', 'link_preview')");
  });

  it('enforces provider_scheduled lifecycle and lookahead claiming in forward migration', () => {
    const baseSql = readFileSync('supabase/migrations/20260831000000_marketing_engine.sql', 'utf8').toLowerCase();
    expect(baseSql).not.toContain('provider_scheduled');
    expect(baseSql).not.toContain('p_lookahead_hours');

    const alterSql = readFileSync('supabase/migrations/20260901020000_provider_scheduled_lifecycle.sql', 'utf8').toLowerCase();
    expect(alterSql).toContain("'provider_scheduled'");
    expect(alterSql).toContain('drop function if exists public.claim_marketing_posts(integer, integer, text[]);');
    expect(alterSql).toContain('p_lookahead_hours integer default 24');
    expect(alterSql).toContain('provider_scheduled_at timestamptz');
    expect(alterSql).toContain('provider_status text');
  });

  it('enforces copy_length_mode check constraint in forward migration', () => {
    const baseSql = readFileSync('supabase/migrations/20260831000000_marketing_engine.sql', 'utf8').toLowerCase();
    expect(baseSql).not.toContain('copy_length_mode');

    const alterSql = readFileSync('supabase/migrations/20260902010000_copy_length_mode.sql', 'utf8').toLowerCase();
    expect(alterSql).toContain("copy_length_mode in ('short', 'long')");
  });
});


