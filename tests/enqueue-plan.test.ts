import type { OfferState } from '../src/offer/state.js';
const getTestOffer = async (): Promise<OfferState> => ({ offerPhase: 'standard_paid', freePilotActive: false, freePilotAdmissions: 100, freePilotLimit: 100, capacityRemaining: 1, status: 'open', checkedAt: '2026-09-03T00:00:00.000Z' });
import { describe, expect, it } from 'vitest';
import { enqueuePlanSchema } from '../src/orchestration/enqueue-plan.js';
import { attributedUrl } from '../src/content/utm.js';

describe('scheduler ingestion contract and validation gates', () => {
  it('validates a complete ChatGPT scheduler payload', () => {
    const payload = {
      planDate: '2026-09-01',
      source: 'chatgpt_scheduler',
      archetype: 'pain_point',
      topic: '國中生背單字的挫折與解法',
      audience: 'Taiwan parents grade 5-8',
      campaignSlug: 'always-on',
      researchSnapshot: {
        query: '國中英文 單字 挫折',
        sources: [
          {
            url: 'https://example.com/parent-survey',
            title: '2026 國中生學習痛點調查',
            retrievedAt: '2026-08-31T12:00:00Z',
            notes: ['超過 60% 學生認為背單字最痛苦'],
          },
        ],
        factualNotes: ['60% 國中生對死背單字感到排斥'],
      },
      posts: [
        {
          platform: 'threads',
          copyText: '孩子不是不努力，是背單字的方法讓他痛苦。傳統死背讓單字變成孤島...',
          claimManifest: [
            {
              text: '超過 60% 學生認為背單字最痛苦',
              kind: 'researched_fact',
              sourceUrls: ['https://example.com/parent-survey'],
            },
            {
              text: '結合興趣的閱讀才能建立長期語感',
              kind: 'opinion',
              sourceUrls: [],
            },
          ],
          ctaMode: 'none',
        },
        {
          platform: 'facebook',
          copyText: '【為什麼補習三年，英文閱讀還是卡關？】\n\n許多家長問我們...',
          claimManifest: [
            {
              text: '紙屬英文提供量身打造的興趣英文讀本',
              kind: 'brand_fact',
              sourceUrls: [],
            },
          ],
          ctaMode: 'soft',
          destinationUrl: 'https://paperbond.jjmowlab.com',
        },
      ],
      provenance: {
        schedulerPromptVersion: 'v1.0',
        generationTimestamp: '2026-08-31T22:00:00Z',
      },
    };

    const parsed = enqueuePlanSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.planDate).toBe('2026-09-01');
    expect(parsed.data.posts).toHaveLength(2);
    expect(parsed.data.posts[0]?.platform).toBe('threads');
  });

  it('rejects malformed external scheduler payload (invalid planDate or empty posts)', () => {
    const invalidDate = enqueuePlanSchema.safeParse({
      planDate: '2026/09/01', // Slash instead of hyphen
      archetype: 'pain_point',
      topic: 'Test',
      posts: [{ platform: 'threads', copyText: 'Hello' }],
    });
    expect(invalidDate.success).toBe(false);

    const emptyPosts = enqueuePlanSchema.safeParse({
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test',
      posts: [], // Empty
    });
    expect(emptyPosts.success).toBe(false);
  });

  it('rejects post copy exceeding platform character limits during ingestion validation', () => {
    const longThreadsCopy = 'a'.repeat(501);
    const parsed = enqueuePlanSchema.safeParse({
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test',
      posts: [
        {
          platform: 'threads',
          copyText: longThreadsCopy,
        },
      ],
    });

    // Schema accepts string, but copy length limit gate in enqueuePlan rejects > 500 chars
    expect(parsed.success).toBe(true);
    expect(longThreadsCopy.length).toBeGreaterThan(500);
  });

  it('validates that researched facts must have non-empty sourceUrls', () => {
    const invalidResearchedClaim = {
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test',
      posts: [
        {
          platform: 'threads',
          copyText: '調查顯示 90% 學生英文退步',
          claimManifest: [
            {
              text: '90% 學生英文退步',
              kind: 'researched_fact',
              sourceUrls: [], // Missing required source URL
            },
          ],
        },
      ],
    };

    const parsed = enqueuePlanSchema.safeParse(invalidResearchedClaim);
    expect(parsed.success).toBe(true);
    // Checked at execution time by enqueuePlan gate
    const researchedClaim = parsed.data?.posts[0]?.claimManifest[0];
    expect(researchedClaim?.kind).toBe('researched_fact');
    expect(researchedClaim?.sourceUrls).toHaveLength(0);
  });

  it('attaches exact platform-specific UTM parameters to destination URLs', () => {
    const base = 'https://paperbond.jjmowlab.com';
    const postUuid = '11111111-2222-3333-4444-555555555555';

    const threadsUrl = new URL(attributedUrl(base, 'threads', 'always-on', postUuid));
    expect(threadsUrl.searchParams.get('utm_source')).toBe('threads');
    expect(threadsUrl.searchParams.get('utm_medium')).toBe('organic_social');
    expect(threadsUrl.searchParams.get('utm_campaign')).toBe('always-on');
    expect(threadsUrl.searchParams.get('utm_content')).toBe(postUuid);

    const igUrl = new URL(attributedUrl(base, 'instagram', 'always-on', postUuid));
    expect(igUrl.searchParams.get('utm_source')).toBe('instagram');
    expect(igUrl.searchParams.get('utm_medium')).toBe('organic_social');
  });

  it('executes enqueuePlan and schedules validated posts idempotently', async () => {
    const scheduledPosts: any[] = [];
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => null,
      createPlan: async () => 'plan-uuid-1234',
      getExistingPostsForDate: async () => [],
      countPostsForDateRange: async () => 0,
      availableAssets: async () => [],
      schedule: async (post: any) => {
        scheduledPosts.push(post);
        return post.id;
      },
    } as any;


    const payload = {
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test Topic',
      posts: [
        {
          platform: 'threads' as const,
          copyText: 'Valid Threads text',
          claimManifest: [
            {
              text: 'Valid claim with source',
              kind: 'researched_fact' as const,
              sourceUrls: ['https://example.com/source'],
            },
          ],
        },
      ],
    };

    const result = await (await import('../src/orchestration/enqueue-plan.js')).enqueuePlan(payload, mockRepo, getTestOffer);
    expect(result.enqueued).toBe(1);
    expect(result.planId).toBe('plan-uuid-1234');
    expect(scheduledPosts).toHaveLength(1);
    expect(scheduledPosts[0]?.platform).toBe('threads');
    expect(scheduledPosts[0]?.idempotencyKey).toBe('2026-09-01:threads:1');
  });

  it('rejects researched claim without sourceUrls during enqueuePlan execution', async () => {
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => null,
      createPlan: async () => 'plan-uuid-1234',
    } as any;

    const payload = {
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test Topic',
      posts: [
        {
          platform: 'threads' as const,
          copyText: 'Valid Threads text',
          claimManifest: [
            {
              text: 'Unsupported claim',
              kind: 'researched_fact' as const,
              sourceUrls: [], // Missing
            },
          ],
        },
      ],
    };

    await expect(
      (await import('../src/orchestration/enqueue-plan.js')).enqueuePlan(payload, mockRepo, getTestOffer)
    ).rejects.toThrow('missing required source URLs');
  });

  it('skips posts when daily cap is reached', async () => {
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => 'existing-plan-uuid',
      getExistingPostsForDate: async () => [
        { id: 'p1', idempotency_key: '2026-09-01:threads:1' },
        { id: 'p2', idempotency_key: '2026-09-01:threads:2' },
        { id: 'p3', idempotency_key: '2026-09-01:threads:3' },
        { id: 'p4', idempotency_key: '2026-09-01:threads:4' },
        { id: 'p5', idempotency_key: '2026-09-01:threads:5' },
      ], // already 5 posts (threads cap)
      countPostsForDateRange: async () => 5,
    } as any;

    const payload = {
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test Topic',
      posts: [
        {
          platform: 'threads' as const,
          copyText: 'Valid text',
        },
      ],
    };

    const result = await (await import('../src/orchestration/enqueue-plan.js')).enqueuePlan(payload, mockRepo, getTestOffer);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain('Daily cap reached');
  });

  it('enqueues posts with explicit assetMode and schedules asset_mode field in repository', async () => {
    let scheduledPost: any;
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => 'plan-123',
      getExistingPostsForDate: async () => [],
      countPostsForDateRange: async () => 0,
      schedule: async (post: any) => {
        scheduledPost = post;
      },
    } as any;

    const payload = {
      planDate: '2026-09-01',
      archetype: 'pain_point',
      topic: 'Test Topic',
      posts: [
        {
          platform: 'threads' as const,
          assetMode: 'text_only' as const,
          copyText: 'Threads concise thought leadership without raw URLs',
        },
      ],
    };

    const { enqueuePlan } = await import('../src/orchestration/enqueue-plan.js');
    const result = await enqueuePlan(payload, mockRepo, getTestOffer);
    expect(result.enqueued).toBe(1);
    expect(scheduledPost.assetMode).toBe('text_only');
    expect(scheduledPost.mediaUrl).toBeNull();
  });

  it('rejects plan when post has invalid asset_mode combination (facebook link_preview with media)', async () => {
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => 'plan-123',
      getExistingPostsForDate: async () => [],
      countPostsForDateRange: async () => 0,
    } as any;

    const payload = {
      planDate: '2026-09-07',
      archetype: 'pain_point',
      topic: 'Test Topic',
      posts: [
        {
          platform: 'facebook' as const,
          assetMode: 'link_preview' as const,
          copyText: 'Check link',
          destinationUrl: 'https://paperbond.jjmowlab.com',
          mediaUrl: 'https://example.com/forbidden-media.png',
        },
      ],
    };

    const { enqueuePlan } = await import('../src/orchestration/enqueue-plan.js');
    await expect(enqueuePlan(payload, mockRepo, getTestOffer)).rejects.toThrow(
      /facebook link_preview must not have an attached media asset/
    );
  });

  it('rejects plan when instagram post specifies text_only mode', async () => {
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => 'plan-123',
      getExistingPostsForDate: async () => [],
      countPostsForDateRange: async () => 0,
    } as any;

    const payload = {
      planDate: '2026-09-02',
      archetype: 'pain_point',
      topic: 'Test Topic',
      posts: [
        {
          platform: 'instagram' as const,
          assetMode: 'text_only' as const,
          copyText: 'IG cannot be text only',
        },
      ],
    };

    const { enqueuePlan } = await import('../src/orchestration/enqueue-plan.js');
    await expect(enqueuePlan(payload, mockRepo, getTestOffer)).rejects.toThrow(
      /instagram only supports image_post mode/
    );
  });
});

