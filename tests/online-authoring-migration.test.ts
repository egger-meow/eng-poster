import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const path = 'supabase/migrations/20260904070000_online_authoring_bridge.sql';

describe('online authoring bridge migration', () => {
  it('creates a service-role-only staging queue and explicit RPC surface', async () => {
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    for (const required of [
      'create table public.marketing_authoring_submissions',
      "status text not null default 'pending'",
      "check (status in ('pending', 'claimed', 'accepted', 'rejected', 'failed'))",
      'enable row level security',
      'chatgpt_submit_marketing_plan',
      'chatgpt_get_marketing_submission',
      'claim_marketing_authoring_submissions',
      'for update skip locked',
      'lease_expires_at',
      'attempt_count',
    ]) expect(sql).toContain(required);

    expect(sql).toContain('revoke all on table public.marketing_authoring_submissions from public, anon, authenticated');
    expect(sql).toContain('grant all on table public.marketing_authoring_submissions to service_role');
    expect(sql).toContain('revoke all on function public.chatgpt_submit_marketing_plan(jsonb, text) from public, anon, authenticated');
    expect(sql).toContain('revoke all on function public.chatgpt_get_marketing_submission(uuid) from public, anon, authenticated');
    expect(sql).toContain('revoke all on function private_generation.claim_marketing_authoring_submissions(text, integer, integer) from public, anon, authenticated');
  });

  it('stages only and never mutates the production post queue', async () => {
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    expect(sql).not.toMatch(/insert\s+into\s+public\.marketing_posts/);
    expect(sql).not.toMatch(/update\s+public\.marketing_posts/);
    expect(sql).not.toMatch(/delete\s+from\s+public\.marketing_posts/);
  });

  it('bounds payloads, validates git SHA, and derives idempotency server-side', async () => {
    const sql = (await readFile(path, 'utf8')).toLowerCase();
    expect(sql).toContain("jsonb_typeof(p_payload) <> 'object'");
    expect(sql).toContain('octet_length(p_payload::text)');
    expect(sql).toContain("lower(p_expected_git_sha) !~ '^[0-9a-f]{40}$'");
    expect(sql).toContain('submission_key');
    expect(sql).toContain('md5(');
    expect(sql).toContain('on conflict (submission_key) do nothing');
  });
});
