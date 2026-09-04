import { describe, expect, it, vi } from 'vitest';
import { enqueuePlan } from '../src/orchestration/enqueue-plan.js';
import { MarketingRepository } from '../src/db/repository.js';
import { findNextQueueGap } from '../src/orchestration/next-queue-gap.js';
import { mapEnrollmentState } from '../src/offer/state.js';
import { validateWinningSignals, winnerOfferContext } from '../src/offer/winners.js';
import type { PreparedPost, WinnerPostContext } from '../src/types.js';

const active = mapEnrollmentState([{ status: 'open', free_pilot_active: true, free_pilot_admissions: 4, free_pilot_limit: 100, remaining: 96 }]);
const paid = { ...active, offerPhase: 'standard_paid' as const, freePilotActive: false };
function repoFixture() {
  const posts: PreparedPost[] = [];
  const repo = {
    getRecentVisualConcepts: vi.fn(async () => []), findPlan: vi.fn(async () => null),
    createPlan: vi.fn(async () => 'plan-id'),
    getExistingPostsForDate: vi.fn(async (_date: string, platform: string) => posts.filter(p => p.platform === platform).map(p => ({ id: p.id, idempotency_key: p.idempotencyKey, status: 'scheduled' }))),
    countPostsForDateRange: vi.fn(async (platform: string) => posts.filter(p => p.platform === platform).length),
    releasePermanentlyFailedSlot: vi.fn(async () => false),
    schedule: vi.fn(async (post: PreparedPost) => { posts.push(post); }),
  };
  return { repo, posts, asRepo: repo as unknown as MarketingRepository };
}
function plan(copyText = '100 位學員以前，每週專屬教材免費。', offerGate: 'free_pilot_active' | null = 'free_pilot_active') {
  return { planDate: '2026-09-05', archetype: 'conversion_offer', topic: '每週教材', posts: [{ platform: 'threads', assetMode: 'text_only', copyText, offerGate, claimManifest: [] }] };
}
describe('live enqueue offer contract', () => {
  it('enqueues active gates and stores live provenance instead of caller counts', async () => {
    const { repo, posts, asRepo } = repoFixture();
    const result = await enqueuePlan({ ...plan(), provenance: { offerPhase: 'free_pilot', offerSnapshot: { ...active, freePilotAdmissions: 99 } } }, asRepo, async () => active);
    expect(result.enqueued).toBe(1);
    expect(posts[0]?.offerGate).toBe('free_pilot_active');
    expect(repo.createPlan).toHaveBeenCalledWith(expect.objectContaining({ provenance: expect.objectContaining({ offerPhase: 'free_pilot', offerSnapshot: active }) }));
    expect(repo.findPlan).toHaveBeenCalledWith('2026-09-05', 'conversion_offer', 'free_pilot');
  });
  it.each([['missing gate', null, active], ['expired gate', 'free_pilot_active', paid]] as const)('rejects %s before writes', async (_label, gate, state) => {
    const { repo, asRepo } = repoFixture();
    await expect(enqueuePlan(plan('目前免費開放', gate), asRepo, async () => state)).rejects.toThrow();
    expect(repo.createPlan).not.toHaveBeenCalled(); expect(repo.schedule).not.toHaveBeenCalled();
  });
  it('rechecks before scheduling when state changes during media/planning work', async () => {
    const { repo, asRepo } = repoFixture();
    const getOffer = vi.fn().mockResolvedValueOnce(active).mockResolvedValue(paid);
    await expect(enqueuePlan(plan(), asRepo, getOffer)).rejects.toThrow('does not allow');
    expect(repo.schedule).not.toHaveBeenCalled();
  });
  it('rejects expired authoring phase even for evergreen copy', async () => {
    const { asRepo } = repoFixture();
    await expect(enqueuePlan({ ...plan('孩子需要閱讀', null), provenance: { offerPhase: 'free_pilot' } }, asRepo, async () => paid)).rejects.toThrow('phase expired');
  });
  it('finds and fills a cancelled first cadence with the second cadence still occupied', async () => {
    const { posts, asRepo } = repoFixture();
    posts.push({ id: 'survivor', platform: 'threads', idempotencyKey: '2026-09-05:threads:2' } as PreparedPost);
    const gap = await findNextQueueGap({ startFrom: '2026-09-05T08:00:00+08:00' }, asRepo);
    expect(gap.missing).toContainEqual({ platform: 'threads', slot: 1 });
    await enqueuePlan(plan('孩子看到英文長文就靈魂出竅', null), asRepo, async () => paid);
    expect(posts.at(-1)?.idempotencyKey).toBe('2026-09-05:threads:1');
  });
  it('persists gate and first comment with no unsafe schema fallback', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const db = { from: vi.fn(() => ({ upsert })) };
    const repo = new MarketingRepository(db as any);
    await repo.schedule({ id: 'p', offerGate: 'free_pilot_active', firstCommentText: '免信用卡', ctaMode: 'soft' } as PreparedPost, 'hash');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ offer_gate: 'free_pilot_active', first_comment_text: '免信用卡', cta_mode: 'soft' }), expect.anything());
    upsert.mockResolvedValue({ error: { code: 'PGRST204', message: 'offer_gate missing' } } as any);
    await expect(repo.schedule({ offerGate: 'free_pilot_active' } as PreparedPost, 'hash')).rejects.toThrow('offer_gate');
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
describe('winner offer context and safe transfer', () => {
  it('includes historical phase and forbids expired facts while allowing mechanisms', () => {
    const winner = { offerPhase: 'free_pilot', copyText: '目前免費開放', offerDependent: true } as WinnerPostContext;
    expect(winnerOfferContext(winner, paid)).toMatchObject({ sourceOfferPhase: 'free_pilot', offerDependent: true, offerClaimsReusable: false, allowedCurrentOfferClaims: [] });
    expect(validateWinningSignals(['keep advertising free forever'], paid).length).toBe(1);
    expect(validateWinningSignals([{ signal: 'zero-risk CTA lowers resistance', evidencePostIds: ['p'], confidence: 'medium', sourceOfferPhase: 'free_pilot', offerDependent: true }], paid)).toEqual([]);
  });
  it('keeps unknown legacy history unknown and handles zero/evergreen winners', () => {
    expect(winnerOfferContext({ copyText: '目前免費' } as WinnerPostContext, active).offerClaimsReusable).toBe(false);
    expect(winnerOfferContext({ copyText: '孩子看到長文就害怕' } as WinnerPostContext, paid).offerDependent).toBe(false);
    expect(validateWinningSignals([], paid)).toEqual([]);
  });
  it('rejects an expired offer winning signal at the enqueue boundary', async () => {
    const { asRepo, repo } = repoFixture();
    await expect(enqueuePlan({ ...plan('閱讀有趣的內容', null), provenance: { winningSignalsUsed: ['每週免費教材'] } }, asRepo, async () => paid)).rejects.toThrow('winning signals');
    expect(repo.createPlan).not.toHaveBeenCalled();
  });
});
