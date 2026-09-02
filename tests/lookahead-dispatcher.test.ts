import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDue } from '../src/orchestration/dispatch-due.js';
import { env } from '../src/env.js';
import { attributedUrl } from '../src/content/utm.js';
import type { Platform } from '../src/types.js';

describe('look-ahead Buffer scheduling and reconciliation in dispatcher', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...env };

  beforeEach(() => {
    env.DRY_RUN = false;
    env.PAUSE_ALL_POSTING = false;
    env.FACEBOOK_ENABLED = true;
    env.INSTAGRAM_ENABLED = true;
    env.THREADS_ENABLED = true;
    process.env.BUFFER_API_KEY = 'test_key';
    process.env.BUFFER_FACEBOOK_CHANNEL_ID = 'ch_fb';
    process.env.BUFFER_INSTAGRAM_CHANNEL_ID = 'ch_ig';
    process.env.BUFFER_THREADS_CHANNEL_ID = 'ch_th';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.assign(env, originalEnv);
    vi.restoreAllMocks();
  });

  function createMockRepo(overrides: Partial<{
    posts: any[];
    attempts: any[];
    claimedIds: string[];
    providerScheduledIds: string[];
    completedIds: string[];
    failedIds: string[];
  }> = {}) {
    const defaultState = {
      posts: [] as any[],
      attempts: [] as any[],
      claimedIds: [] as string[],
      providerScheduledIds: [] as string[],
      completedIds: [] as string[],
      failedIds: [] as string[],
    };

    const state = { ...defaultState, ...overrides };
    state.posts = state.posts.map((p: any) => ({
      ...p,
      destination_url:
        p.destination_url === undefined || p.destination_url === null
          ? (p.platform === 'instagram' ? null : attributedUrl('https://paperbond.jjmowlab.com', p.platform ?? 'threads', 'always-on', p.id ?? 'p1'))
          : p.destination_url,
    }));

    const repo = {
      state,
      claimDue: vi.fn(async (limit: number, leaseMinutes: number, platforms?: Platform[], lookaheadHours = 24) => {
        const now = new Date();
        const lookaheadHorizon = new Date(now.getTime() + lookaheadHours * 3600 * 1000);

        const eligible = state.posts.filter((p: any) => {
          if (p.status !== 'scheduled' && p.status !== 'retryable_failed') return false;
          if (platforms && !platforms.includes(p.platform)) return false;
          const sched = new Date(p.scheduled_for);
          return sched <= lookaheadHorizon;
        }).slice(0, limit);

        for (const p of eligible) {
          p.status = 'claimed';
          p.attempt_count = (p.attempt_count ?? 0) + 1;
          state.claimedIds.push(p.id);
        }
        return eligible;
      }),

      releaseClaim: vi.fn(async (postId: string) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) post.status = 'scheduled';
      }),

      markProviderScheduled: vi.fn(async (postId: string, result: any) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) {
          post.status = 'provider_scheduled';
          post.platform_post_id = result.platformPostId;
          post.platform_post_url = result.platformPostUrl ?? null;
          post.provider_status = result.providerStatus ?? 'scheduled';
          state.providerScheduledIds.push(postId);
        }
      }),

      getProviderScheduledPosts: vi.fn(async (beforeIso: string) => {
        const before = new Date(beforeIso);
        return state.posts.filter((p: any) => {
          if (p.status !== 'provider_scheduled') return false;
          return new Date(p.scheduled_for) <= before;
        });
      }),

      reconcilePublished: vi.fn(async (postId: string, result: any) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) {
          post.status = 'published';
          post.platform_post_id = result.platformPostId;
          post.platform_post_url = result.platformPostUrl ?? null;
          post.provider_status = 'sent';
          post.published_at = result.sentAt;
          state.completedIds.push(postId);
        }
      }),

      reconcileFailed: vi.fn(async (postId: string, retryable: boolean, msg: string) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) {
          post.status = retryable ? 'retryable_failed' : 'permanently_failed';
          post.last_error = msg;
          state.failedIds.push(postId);
        }
      }),

      updateProviderStatus: vi.fn(async (postId: string, providerStatus: string) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) post.provider_status = providerStatus;
      }),

      complete: vi.fn(async (postId: string, result: any) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) {
          post.status = 'published';
          post.platform_post_id = result.platformPostId;
          post.platform_post_url = result.platformPostUrl ?? null;
          post.provider_status = 'sent';
          state.completedIds.push(postId);
        }
      }),

      fail: vi.fn(async (postId: string, retryable: boolean, msg: string) => {
        const post = state.posts.find((p: any) => p.id === postId);
        if (post) {
          post.status = retryable ? 'retryable_failed' : 'permanently_failed';
          post.last_error = msg;
          state.failedIds.push(postId);
        }
      }),

      recordAttempt: vi.fn(async (attempt: any) => {
        state.attempts.push(attempt);
      }),

      assetUrl: vi.fn(async (id: string | null) => {
        return id ? `https://storage.supabase.co/marketing-media/${id}.png` : null;
      }),
    };

    return repo;
  }

  function mockBufferGraphQL(handlers: {
    createPost?: (input: any) => any;
    getPost?: (input: any) => any;
    getChannelPosts?: (input: any) => any;
  }) {
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({ data: { account: { organizations: [{ id: 'org_1', name: 'Paper English' }] } } }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
        return new Response(
          JSON.stringify({
            data: {
              channels: [
                { id: 'ch_fb', name: 'FB Page', service: 'facebook' },
                { id: 'ch_ig', name: 'IG Page', service: 'instagram' },
                { id: 'ch_th', name: 'Threads Page', service: 'threads' },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('CreatePost') && handlers.createPost) {
        const post = handlers.createPost(body.variables.input);
        return new Response(JSON.stringify({ data: { createPost: { post } } }), { status: 200 });
      }
      if (body.query.includes('GetPost') && handlers.getPost) {
        const post = handlers.getPost(body.variables.input);
        return new Response(JSON.stringify({ data: { post } }), { status: 200 });
      }
      if (body.query.includes('GetChannelPosts') && handlers.getChannelPosts) {
        const edges = handlers.getChannelPosts(body.variables.input);
        return new Response(JSON.stringify({ data: { posts: { edges } } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
  }

  it('submits future Facebook post to Buffer with customScheduled mode, exact dueAt, and transitions to provider_scheduled', async () => {
    let capturedCreateInput: any;
    const futureIso = new Date(Date.now() + 4 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: (input) => {
        capturedCreateInput = input;
        return {
          id: 'buf_fb_123',
          status: 'scheduled',
          dueAt: futureIso,
          sentAt: null,
          sharedNow: false,
          externalLink: null,
          channelId: 'ch_fb',
          channelService: 'facebook',
          text: input.text,
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_fb_1',
          content_plan_id: 'plan_1',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'FB future post text',
          destination_url: null,
          media_asset_id: null,
          scheduled_for: futureIso,
          idempotency_key: '2026-09-01:facebook:1',
          status: 'scheduled',
          attempt_count: 0,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.scheduledToProvider).toBe(1);
    expect(result.published).toBe(0);
    expect(capturedCreateInput.mode).toBe('customScheduled');
    expect(capturedCreateInput.dueAt).toBe(futureIso);
    expect(repo.state.providerScheduledIds).toContain('p_fb_1');
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
    expect(repo.state.posts[0].platform_post_id).toBe('buf_fb_123');
  });

  it('submits future Threads post to Buffer early with customScheduled and dueAt', async () => {
    let capturedCreateInput: any;
    const futureIso = new Date(Date.now() + 6 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: (input) => {
        capturedCreateInput = input;
        return {
          id: 'buf_th_123',
          status: 'scheduled',
          dueAt: futureIso,
          sentAt: null,
          sharedNow: false,
          externalLink: null,
          channelId: 'ch_th',
          channelService: 'threads',
          text: input.text,
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_th_1',
          content_plan_id: 'plan_1',
          platform: 'threads',
          asset_mode: 'text_only',
          copy_text: 'Threads future text',
          destination_url: null,
          media_asset_id: null,
          scheduled_for: futureIso,
          idempotency_key: '2026-09-01:threads:1',
          status: 'scheduled',
          attempt_count: 0,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.scheduledToProvider).toBe(1);
    expect(capturedCreateInput.mode).toBe('customScheduled');
    expect(capturedCreateInput.dueAt).toBe(futureIso);
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
  });

  it('submits future Instagram image post to Buffer with customScheduled and media asset', async () => {
    let capturedCreateInput: any;
    const futureIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: (input) => {
        capturedCreateInput = input;
        return {
          id: 'buf_ig_123',
          status: 'scheduled',
          dueAt: futureIso,
          sentAt: null,
          sharedNow: false,
          externalLink: null,
          channelId: 'ch_ig',
          channelService: 'instagram',
          text: input.text,
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_ig_1',
          content_plan_id: 'plan_1',
          platform: 'instagram',
          asset_mode: 'image_post',
          copy_text: 'Instagram caption with media',
          destination_url: null,
          media_asset_id: 'asset_1',
          scheduled_for: futureIso,
          idempotency_key: '2026-09-01:instagram:1',
          status: 'scheduled',
          attempt_count: 0,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.scheduledToProvider).toBe(1);
    expect(capturedCreateInput.mode).toBe('customScheduled');
    expect(capturedCreateInput.dueAt).toBe(futureIso);
    expect(capturedCreateInput.assets).toBeDefined();
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
  });

  it('publishes overdue post immediately with mode: shareNow and marks published', async () => {
    let capturedCreateInput: any;
    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: (input) => {
        capturedCreateInput = input;
        return {
          id: 'buf_overdue_999',
          status: 'sent',
          dueAt: pastIso,
          sentAt: new Date().toISOString(),
          sharedNow: true,
          externalLink: 'https://facebook.com/posts/999',
          channelId: 'ch_fb',
          channelService: 'facebook',
          text: input.text,
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_overdue_1',
          content_plan_id: 'plan_1',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'Overdue post published immediately',
          destination_url: null,
          media_asset_id: null,
          scheduled_for: pastIso,
          idempotency_key: '2026-09-01:facebook:overdue',
          status: 'scheduled',
          attempt_count: 0,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.published).toBe(1);
    expect(result.scheduledToProvider).toBe(0);
    expect(capturedCreateInput.mode).toBe('shareNow');
    expect(capturedCreateInput.dueAt).toBeUndefined();
    expect(repo.state.posts[0].status).toBe('published');
    expect(repo.state.completedIds).toContain('p_overdue_1');
  });

  it('does not re-claim provider_scheduled posts during dispatch schedule pass', async () => {
    mockBufferGraphQL({});
    const futureIso = new Date(Date.now() + 5 * 3600 * 1000).toISOString();

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_already_scheduled',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'Already in Buffer',
          scheduled_for: futureIso,
          status: 'provider_scheduled',
          platform_post_id: 'buf_existing_1',
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.scheduledToProvider).toBe(0);
    expect(result.published).toBe(0);
    expect(repo.state.claimedIds).not.toContain('p_already_scheduled');
  });

  it('reconciles provider_scheduled post that Buffer confirmed sent', async () => {
    const pastScheduleIso = new Date(Date.now() - 600 * 1000).toISOString();

    mockBufferGraphQL({
      getPost: (input) => {
        expect(input.id).toBe('buf_reconcile_1');
        return {
          id: 'buf_reconcile_1',
          status: 'sent',
          dueAt: pastScheduleIso,
          sentAt: pastScheduleIso,
          externalLink: 'https://threads.net/p/rec_1',
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_reconcile_1',
          platform: 'threads',
          asset_mode: 'text_only',
          copy_text: 'Reconciled post',
          scheduled_for: pastScheduleIso,
          status: 'provider_scheduled',
          platform_post_id: 'buf_reconcile_1',
          provider_status: 'scheduled',
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.reconciled).toBe(1);
    expect(repo.state.completedIds).toContain('p_reconcile_1');
    expect(repo.state.posts[0].status).toBe('published');
    expect(repo.state.posts[0].platform_post_url).toBe('https://threads.net/p/rec_1');
  });

  it('leaves post in provider_scheduled when Buffer reports still scheduled', async () => {
    const nearScheduleIso = new Date(Date.now() + 120 * 1000).toISOString();

    mockBufferGraphQL({
      getPost: () => ({
        id: 'buf_still_pending',
        status: 'scheduled',
        dueAt: nearScheduleIso,
        sentAt: null,
        externalLink: null,
      }),
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_pending_1',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'Still pending',
          scheduled_for: nearScheduleIso,
          status: 'provider_scheduled',
          platform_post_id: 'buf_still_pending',
          provider_status: 'scheduled',
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.reconciled).toBe(0);
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
  });

  it('marks permanently_failed if Buffer reconciliation confirms post failed', async () => {
    const pastScheduleIso = new Date(Date.now() - 300 * 1000).toISOString();

    mockBufferGraphQL({
      getPost: () => ({
        id: 'buf_failed_1',
        status: 'failed',
        dueAt: pastScheduleIso,
        sentAt: null,
        externalLink: null,
      }),
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_fail_1',
          platform: 'instagram',
          asset_mode: 'image_post',
          copy_text: 'Failed post',
          scheduled_for: pastScheduleIso,
          status: 'provider_scheduled',
          platform_post_id: 'buf_failed_1',
          provider_status: 'scheduled',
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(result.failed).toBe(1);
    expect(repo.state.posts[0].status).toBe('permanently_failed');
  });

  it('prevents duplicate post if post already has platform_post_id from previous attempt', async () => {
    let createPostCalled = false;
    const futureIso = new Date(Date.now() + 10 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: () => {
        createPostCalled = true;
        return { id: 'buf_duplicate_id' };
      },
      getPost: (input) => {
        expect(input.id).toBe('buf_preexisting_id');
        return {
          id: 'buf_preexisting_id',
          status: 'scheduled',
          dueAt: futureIso,
          externalLink: null,
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_retry_1',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'Retry post',
          scheduled_for: futureIso,
          status: 'retryable_failed',
          platform_post_id: 'buf_preexisting_id',
          attempt_count: 1,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(createPostCalled).toBe(false);
    expect(result.scheduledToProvider).toBe(1);
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
  });

  it('searches channel posts and avoids duplicate creation after ambiguous network timeout', async () => {
    let createPostCalled = false;
    const futureIso = new Date(Date.now() + 15 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: () => {
        createPostCalled = true;
        return { id: 'buf_should_not_be_called' };
      },
      getChannelPosts: () => [
        {
          node: {
            id: 'buf_matched_channel_post',
            status: 'scheduled',
            dueAt: futureIso,
            text: 'Ambiguous retry text',
            externalLink: null,
          },
        },
      ],
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_ambiguous_retry',
          platform: 'threads',
          asset_mode: 'text_only',
          copy_text: 'Ambiguous retry text',
          scheduled_for: futureIso,
          status: 'retryable_failed',
          platform_post_id: null, // Lost due to timeout
          attempt_count: 1,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any });

    expect(createPostCalled).toBe(false);
    expect(result.scheduledToProvider).toBe(1);
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
    expect(repo.state.posts[0].platform_post_id).toBe('buf_matched_channel_post');
  });

  it('respects 24h lookahead boundary: schedules posts within 24h, leaves >24h untouched', async () => {
    const within24h = new Date(Date.now() + 18 * 3600 * 1000).toISOString();
    const beyond24h = new Date(Date.now() + 36 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: (input) => ({
        id: 'buf_within_24h',
        status: 'scheduled',
        dueAt: input.dueAt,
        text: input.text,
      }),
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_near',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'Within 24h',
          scheduled_for: within24h,
          status: 'scheduled',
          attempt_count: 0,
        },
        {
          id: 'p_far',
          platform: 'facebook',
          asset_mode: 'text_only',
          copy_text: 'Beyond 24h',
          scheduled_for: beyond24h,
          status: 'scheduled',
          attempt_count: 0,
        },
      ],
    });

    const result = await dispatchDue({ repo: repo as any, lookaheadHours: 24 });

    expect(result.scheduledToProvider).toBe(1);
    expect(repo.state.providerScheduledIds).toContain('p_near');
    expect(repo.state.providerScheduledIds).not.toContain('p_far');
    expect(repo.state.posts[0].status).toBe('provider_scheduled');
    expect(repo.state.posts[1].status).toBe('scheduled');
  });

  it('can run dispatcher multiple times idempotently with zero duplicate Buffer posts', async () => {
    let createPostCount = 0;
    const futureIso = new Date(Date.now() + 10 * 3600 * 1000).toISOString();

    mockBufferGraphQL({
      createPost: () => {
        createPostCount++;
        return {
          id: 'buf_idempotent_post',
          status: 'scheduled',
          dueAt: futureIso,
          text: 'Idempotency test text',
        };
      },
    });

    const repo = createMockRepo({
      posts: [
        {
          id: 'p_idem_1',
          platform: 'threads',
          asset_mode: 'text_only',
          copy_text: 'Idempotency test text',
          scheduled_for: futureIso,
          status: 'scheduled',
          attempt_count: 0,
        },
      ],
    });

    // Run 1: Claims post and submits to Buffer
    const run1 = await dispatchDue({ repo: repo as any });
    expect(run1.scheduledToProvider).toBe(1);
    expect(createPostCount).toBe(1);
    expect(repo.state.posts[0].status).toBe('provider_scheduled');

    // Run 2: Does not claim or create post again
    const run2 = await dispatchDue({ repo: repo as any });
    expect(run2.scheduledToProvider).toBe(0);
    expect(run2.published).toBe(0);
    expect(createPostCount).toBe(1); // Still exactly 1!
  });
});
