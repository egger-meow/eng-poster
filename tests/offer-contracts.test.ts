import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MarketingRepository } from '../src/db/repository.js';
import { inspectOfferSensitiveQueue } from '../src/offer/queue.js';
import { mapEnrollmentState } from '../src/offer/state.js';

describe('durable offer migration and scheduler contracts', () => {
  it('atomically releases cadence once, preserves history, and grants only service_role', async () => {
    const sql = await readFile('supabase/migrations/20260903064118_marketing_offer_gate.sql', 'utf8');
    expect(sql).toContain("idempotency_key = idempotency_key || ':cancelled:' || id::text");
    expect(sql).toContain("where id = p_post_id and status in ('scheduled', 'claimed', 'retryable_failed', 'provider_scheduled')");
    expect(sql).toContain('security invoker');
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).not.toMatch(/delete from|update public.enrollment|historical_pilot_admissions/i);
    const calls: unknown[] = [];
    const repo = new MarketingRepository({ rpc: async (...args: unknown[]) => { calls.push(args); return { error: null }; } } as any);
    await repo.cancelOfferPost('p', 'expired');
    expect(calls).toEqual([['cancel_marketing_offer_post', { p_post_id: 'p', p_reason: 'expired' }]]);
  });
  it('authoritative workflow has 16 ordered steps and live state before authoring', async () => {
    const prompt = await readFile('docs/CHATGPT_SCHEDULER_PROMPT.md', 'utf8');
    expect([...prompt.matchAll(/^### Step (\d+):/gm)].map(m => Number(m[1]))).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(prompt).toContain('### Step 4: Mandatory Live Offer State');
    expect(prompt).toContain('### Step 13: Validate Offer-Dependent Claims');
    expect(prompt).toContain('Expired offer facts are NEVER transferable winning signals');
  });
  it('reports ungated legacy, explicit gates, and excludes evergreen without mutation', async () => {
    const rows = [{ id: 'old', copy_text: '目前免費', status: 'provider_scheduled' }, { id: 'gated', copy_text: '先拿教材看看', offer_gate: 'free_pilot_active' }, { id: 'evergreen', copy_text: '孩子需要閱讀' }];
    const original = JSON.stringify(rows);
    const repo = { getOfferSensitiveQueueRows: async () => rows } as unknown as MarketingRepository;
    const state = mapEnrollmentState([{ status: 'open', free_pilot_active: true, free_pilot_limit: 100, remaining: 96 }]);
    const report = await inspectOfferSensitiveQueue(repo, async () => state);
    expect(report.posts.map(p => p.id)).toEqual(['old', 'gated']);
    expect(report.posts[0]?.reviewReasons.join()).toContain('requires offerGate');
    expect(JSON.stringify(rows)).toBe(original);
  });
});
