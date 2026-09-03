import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDue } from '../src/orchestration/dispatch-due.js';
import { env } from '../src/env.js';
import { mapEnrollmentState } from '../src/offer/state.js';
import { attributedUrl } from '../src/content/utm.js';
import { BufferClient } from '../src/platforms/buffer.js';

const active = mapEnrollmentState([{ status: 'open', free_pilot_active: true, free_pilot_admissions: 4, free_pilot_limit: 100, remaining: 96 }]);
const paid = { ...active, offerPhase: 'standard_paid' as const, freePilotActive: false };
function row(overrides: Record<string, unknown> = {}) {
  return { id: 'p1', platform: 'threads', asset_mode: 'text_only', copy_text: '100 位學員以前，每週專屬教材免費。', offer_gate: 'free_pilot_active',
    status: 'scheduled', scheduled_for: new Date(Date.now() + 3600_000).toISOString(), idempotency_key: '2026-09-05:threads:1',
    destination_url: attributedUrl('https://paperbond.jjmowlab.com', 'threads', 'always-on', 'p1'), attempt_count: 0, claim_manifest: [], ...overrides };
}
function fixture(post = row()) {
  const repo = {
    getProviderScheduledPosts: vi.fn(async () => post.status === 'provider_scheduled' ? [post] : []),
    claimDue: vi.fn(async () => { if (post.status !== 'scheduled') return []; post.status = 'claimed'; post.attempt_count++; return [post]; }),
    assetUrl: vi.fn(async () => null), releaseClaim: vi.fn(async (_id: string, count?: number) => { post.status = 'scheduled'; if (count !== undefined) post.attempt_count = Math.max(0, count - 1); }),
    holdOfferSubmission: vi.fn(async (_id: string, _message: string, providerId?: string) => { post.status = 'provider_scheduled'; if (providerId) Object.assign(post, { platform_post_id: providerId }); }),
    cancelOfferPost: vi.fn(async () => { post.status = 'cancelled'; }), recordOfferIssue: vi.fn(async () => {}),
    markProviderScheduled: vi.fn(async () => { post.status = 'provider_scheduled'; }),
    complete: vi.fn(async () => { post.status = 'published'; }), reconcilePublished: vi.fn(async () => { post.status = 'published'; }),
    reconcileFailed: vi.fn(async () => {}), updateProviderStatus: vi.fn(async () => {}), fail: vi.fn(async (_id: string, retryable: boolean, message: string) => { post.status = retryable ? 'scheduled' : 'permanently_failed'; Object.assign(post, { last_error: message }); }), recordAttempt: vi.fn(async () => {}),
  };
  return { post, repo, asRepo: repo as any };
}
describe('offer gates across dispatch and provider reconciliation', () => {
  const oldEnv = { ...env };
  beforeEach(() => {
    env.DRY_RUN = false; env.PAUSE_ALL_POSTING = false; env.THREADS_ENABLED = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('BUFFER_API_KEY', 'mock-only'); vi.stubEnv('BUFFER_THREADS_CHANNEL_ID', 'ch');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network call'); }));
  });
  afterEach(() => { Object.assign(env, oldEnv); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('allows active gated submission with evergreen lookahead unchanged', async () => {
    const { repo, asRepo } = fixture();
    const fetcher = vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body).query).toContain('CreatePost');
      return new Response(JSON.stringify({ data: { createPost: { post: { id: 'buffer-1', status: 'scheduled' } } } }));
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await dispatchDue({ repo: asRepo, getOffer: async () => active });
    expect(result.scheduledToProvider).toBe(1); expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.claimDue).toHaveBeenCalledWith(20, expect.any(Number), expect.any(Array), 24);
  });
  it.each([true, false])('blocks expired local copy, including legacy ungated copy (%s)', async (explicit) => {
    const { post, repo, asRepo } = fixture(row({ offer_gate: explicit ? 'free_pilot_active' : null }));
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(post.status).toBe('cancelled'); expect(fetch).not.toHaveBeenCalled(); expect(repo.complete).not.toHaveBeenCalled();
  });
  it('blocks unknown live state without cancelling or publishing', async () => {
    const { post, repo, asRepo } = fixture();
    await dispatchDue({ repo: asRepo, getOffer: async () => { throw new Error('RPC unavailable'); } });
    expect(post.status).toBe('scheduled'); expect(repo.recordOfferIssue).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('never trusts internal terms even while active', async () => {
    const { post, asRepo } = fixture(row({ copy_text: '免費公測' }));
    await dispatchDue({ repo: asRepo, getOffer: async () => active });
    expect(post.status).toBe('cancelled'); expect(fetch).not.toHaveBeenCalled();
  });
  it('revalidates far-future provider schedules and deletes using the documented union', async () => {
    const { post, repo, asRepo } = fixture(row({ status: 'provider_scheduled', platform_post_id: 'buffer-1', scheduled_for: new Date(Date.now() + 172800_000).toISOString() }));
    const queries: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body); queries.push(query);
      expect(variables).toEqual({ input: { id: 'buffer-1' } });
      return new Response(JSON.stringify({ data: query.includes('DeletePost') ? { deletePost: { __typename: 'DeletePostSuccess', id: 'buffer-1' } } : { post: { id: 'buffer-1', status: 'scheduled' } } }));
    }));
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(queries).toHaveLength(2); expect(queries[1]).toContain('DeletePostInput!');
    expect(post.status).toBe('cancelled'); expect(repo.reconcilePublished).not.toHaveBeenCalled();
  });
  it('recovers idempotently after remote deletion succeeds and the local write fails', async () => {
    const { post, repo, asRepo } = fixture(row({ status: 'provider_scheduled', platform_post_id: 'buffer-1' }));
    let remoteExists = true;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { query } = JSON.parse(init.body);
      if (query.includes('DeletePost')) { remoteExists = false; return new Response(JSON.stringify({ data: { deletePost: { __typename: 'DeletePostSuccess', id: 'buffer-1' } } })); }
      return new Response(JSON.stringify({ data: { post: remoteExists ? { id: 'buffer-1', status: 'scheduled' } : null } }));
    }));
    repo.cancelOfferPost.mockRejectedValueOnce(new Error('database disconnected'));
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(post.status).toBe('provider_scheduled');
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(post.status).toBe('cancelled'); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(['mutation_error', 'already_sent', 'malformed_lookup', 'offline'])('preserves unresolved provider row and records an actionable error: %s', async (failure) => {
    const { post, repo, asRepo } = fixture(row({ status: 'provider_scheduled', platform_post_id: 'buffer-1' }));
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { query } = JSON.parse(init.body);
      if (failure === 'offline') throw new Error('offline');
      const data = failure === 'malformed_lookup' ? {} : query.includes('DeletePost') ? { deletePost: { __typename: 'VoidMutationError', message: 'denied' } } : { post: { id: 'buffer-1', status: failure === 'already_sent' ? 'sent' : 'scheduled' } };
      return new Response(JSON.stringify({ data }));
    }));
    const result = await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(result.failed).toBe(1); expect(post.status).toBe('provider_scheduled'); expect(repo.cancelOfferPost).not.toHaveBeenCalled();
    expect(repo.reconcilePublished).not.toHaveBeenCalled(); expect(repo.recordOfferIssue).toHaveBeenCalled();
  });
  it('never republishes an ambiguous sensitive retry when channel lookup fails', async () => {
    const { repo, asRepo } = fixture(row({ attempt_count: 2, last_error: 'AMBIGUOUS: previous timeout' }));
    await dispatchDue({ repo: asRepo, getOffer: async () => active });
    expect(repo.markProviderScheduled).not.toHaveBeenCalled(); expect(repo.complete).not.toHaveBeenCalled();
  });
  it('evergreen posts do not depend on live offer availability', async () => {
    const { asRepo } = fixture(row({ copy_text: '孩子看到長文就靈魂出竅', offer_gate: null }));
    const getOffer = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { createPost: { post: { id: 'b', status: 'scheduled' } } } }))));
    expect((await dispatchDue({ repo: asRepo, getOffer })).scheduledToProvider).toBe(1);
    expect(getOffer).not.toHaveBeenCalled();
  });
  it('dry-run leaves both provider and local state untouched', async () => {
    env.DRY_RUN = true;
    const { asRepo, repo } = fixture(); const getOffer = vi.fn(async () => paid);
    await dispatchDue({ repo: asRepo, getOffer });
    expect(getOffer).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(repo.claimDue).not.toHaveBeenCalled();
  });
  it.each([1, 2])('recovers from an offer outage at live read %s without manufacturing ambiguity', async (failedRead) => {
    const { post, asRepo } = fixture(); let reads = 0;
    const getOffer = async () => { if (++reads === failedRead) throw new Error('RPC outage'); return active; };
    await dispatchDue({ repo: asRepo, getOffer });
    expect(post.attempt_count).toBe(0); expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      expect(JSON.parse(init.body).query).toContain('CreatePost');
      return new Response(JSON.stringify({ data: { createPost: { post: { id: 'b', status: 'scheduled' } } } }));
    }));
    expect((await dispatchDue({ repo: asRepo, getOffer })).scheduledToProvider).toBe(1);
  });
  it('keeps true ambiguous submissions reconcilable past retry exhaustion and cancels after expiry', async () => {
    const { post, repo, asRepo } = fixture(row({ attempt_count: 9, last_error: 'AMBIGUOUS: previous timeout' }));
    await dispatchDue({ repo: asRepo, getOffer: async () => active });
    expect(post.status).toBe('provider_scheduled'); expect(repo.fail).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { query } = JSON.parse(init.body);
      const providerPost = { id: 'recovered', status: 'scheduled', text: post.copy_text };
      const data = query.includes('GetChannelPosts') ? { posts: { edges: [{ node: providerPost }] } }
        : query.includes('DeletePost') ? { deletePost: { __typename: 'DeletePostSuccess', id: 'recovered' } } : { post: providerPost };
      return new Response(JSON.stringify({ data }));
    }));
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(post.status).toBe('cancelled'); expect(repo.reconcilePublished).not.toHaveBeenCalled();
  });
  it('does not select the first of multiple matching provider posts while active', async () => {
    const { post, repo, asRepo } = fixture(row({ attempt_count: 2, last_error: 'AMBIGUOUS: previous timeout' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { posts: { edges: ['b1', 'b2'].map(id => ({ node: { id, status: 'scheduled', text: post.copy_text } })) } } }))));
    await dispatchDue({ repo: asRepo, getOffer: async () => active });
    expect(repo.holdOfferSubmission).toHaveBeenCalled(); expect(repo.markProviderScheduled).not.toHaveBeenCalled();
  });
  it('cancels expired provider offers even with all new-submission platforms disabled', async () => {
    env.FACEBOOK_ENABLED = false; env.INSTAGRAM_ENABLED = false; env.THREADS_ENABLED = false;
    const { post, asRepo, repo } = fixture(row({ status: 'provider_scheduled', platform_post_id: 'b' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { post: null } }))));
    await dispatchDue({ repo: asRepo, getOffer: async () => paid });
    expect(post.status).toBe('cancelled'); expect(repo.claimDue).not.toHaveBeenCalled();
  });
  it('retries an explicit rate-limit rejection without inventing provider ambiguity', async () => {
    const { post, repo, asRepo } = fixture();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { createPost: { post: { id: 'accepted', status: 'scheduled' } } } })));
    vi.stubGlobal('fetch', fetcher);
    await dispatchDue({ repo: asRepo, getOffer: async () => active });
    expect(post.status).toBe('scheduled'); expect(repo.holdOfferSubmission).not.toHaveBeenCalled();
    expect((await dispatchDue({ repo: asRepo, getOffer: async () => active })).scheduledToProvider).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not mistake empty delete payloads for confirmed deletion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { deletePost: {} } }))));
    await expect(new BufferClient().deletePost('buffer-1')).rejects.toThrow('unconfirmed');
  });
});
