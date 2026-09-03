import type { OfferState } from '../src/offer/state.js';
const getTestOffer = async (): Promise<OfferState> => ({ offerPhase: 'standard_paid', freePilotActive: false, freePilotAdmissions: 100, freePilotLimit: 100, capacityRemaining: 1, status: 'open', checkedAt: '2026-09-03T00:00:00.000Z' });
import { describe, expect, it } from 'vitest';
import {
  validatePreparedPost,
  formatPublishCopyText,
  formatFirstComment,
  formatThreadsReply,
  CANONICAL_BASE_URL,
} from '../src/content/gates.js';
import { attributedUrl } from '../src/content/utm.js';
import { enqueuePlan } from '../src/orchestration/enqueue-plan.js';
import type { PreparedPost } from '../src/types.js';

describe('Mandatory Main-Body Link Invariant for Facebook & Threads', () => {
  const buildPost = (over: Partial<PreparedPost> = {}): PreparedPost => {
    const platform = over.platform ?? 'threads';
    return {
      id: 'test-post-1',
      contentPlanId: 'test-plan-1',
      platform,
      assetMode: over.assetMode ?? 'text_only',
      copyLengthMode: over.copyLengthMode ?? 'short',
      copyText: over.copyText ?? '會考英文不是單字比賽。💀',
      destinationUrl:
        over.destinationUrl !== undefined
          ? over.destinationUrl
          : attributedUrl(CANONICAL_BASE_URL, platform, 'always-on', 'test-post-1'),
      scheduledFor: '2026-09-05T12:00:00Z',
      idempotencyKey: `2026-09-05:${platform}:1`,
      campaignSlug: 'always-on',
      claimManifest: [],
      ctaMode: over.ctaMode ?? 'none',
      ...over,
    };
  };

  it('Threads text_only automatically gets main-body destination URL in formatted copy', () => {
    const post = buildPost({
      platform: 'threads',
      assetMode: 'text_only',
      copyText: '會考英文不是單字比賽。💀',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('會考英文不是單字比賽。💀');
    expect(formatted).toContain(post.destinationUrl!);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('Threads image_post gets main-body destination URL in formatted copy', () => {
    const post = buildPost({
      platform: 'threads',
      assetMode: 'image_post',
      mediaUrl: 'https://example.com/asset.png',
      copyText: '孩子的英文教材，由他的興趣決定。⚡️',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('孩子的英文教材，由他的興趣決定。⚡️');
    expect(formatted).toContain(post.destinationUrl!);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('Threads link_preview gets main-body destination URL', () => {
    const post = buildPost({
      platform: 'threads',
      assetMode: 'link_preview',
      copyText: '真正卡死孩子的是看完整篇還抓不到重點。',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('真正卡死孩子的是看完整篇還抓不到重點。');
    expect(formatted).toContain(post.destinationUrl!);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('Facebook text_only gets main-body destination URL', () => {
    const post = buildPost({
      platform: 'facebook',
      assetMode: 'text_only',
      copyText: '英文閱讀真正難的不是單字。是孩子看到整篇時，不知道哪一句重要。🧠',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('英文閱讀真正難的不是單字。');
    expect(formatted).toContain(post.destinationUrl!);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('Facebook image_post gets main-body destination URL', () => {
    const post = buildPost({
      platform: 'facebook',
      assetMode: 'image_post',
      mediaUrl: 'https://example.com/asset.png',
      copyText: '英文閱讀不用死背單字，從孩子感興趣的主題開始建立語感。🔥',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('英文閱讀不用死背單字');
    expect(formatted).toContain(post.destinationUrl!);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('Facebook link_preview gets main-body destination URL', () => {
    const post = buildPost({
      platform: 'facebook',
      assetMode: 'link_preview',
      copyText: '【為什麼補習三年，英文閱讀還是卡關？】',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('【為什麼補習三年，英文閱讀還是卡關？】');
    expect(formatted).toContain(post.destinationUrl!);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('ctaMode=none STILL gets URL in main body and satisfies NO CTA != NO LINK', () => {
    const post = buildPost({
      platform: 'threads',
      assetMode: 'text_only',
      ctaMode: 'none',
      copyText: '英文閱讀真正難的不是單字。是孩子看到整篇時，不知道哪一句重要。🧠',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain('https://paperbond.jjmowlab.com');
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('short copy retains URL without filler', () => {
    const post = buildPost({
      platform: 'threads',
      copyLengthMode: 'short',
      copyText: '嚇到了嗎 😳',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toBe(`嚇到了嗎 😳\n\n${post.destinationUrl}`);
    const validation = validatePreparedPost(post);
    expect(validation.valid).toBe(true);
  });

  it('long copy retains URL cleanly at the end without generic boilerplate', () => {
    const longText = '這是一篇關於英文閱讀深度解析的長文內容。重點在於語塊與閱讀策略，而不是單純的單字背誦。'.repeat(3);
    const post = buildPost({
      platform: 'threads',
      copyLengthMode: 'long',
      copyText: longText,
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted.endsWith(post.destinationUrl!)).toBe(true);
    expect(validatePreparedPost(post).valid).toBe(true);
  });

  it('URL has correct platform UTM attribution', () => {
    const thPost = buildPost({ platform: 'threads' });
    expect(thPost.destinationUrl).toContain('utm_source=threads');
    expect(thPost.destinationUrl).toContain('utm_medium=organic_social');
    expect(thPost.destinationUrl).toContain('utm_campaign=always-on');

    const fbPost = buildPost({ platform: 'facebook' });
    expect(fbPost.destinationUrl).toContain('utm_source=facebook');
    expect(fbPost.destinationUrl).toContain('utm_medium=organic_social');
  });

  it('final publish body cannot contain zero Paper English links', () => {
    // Missing destinationUrl on Threads
    const missingDestPost = buildPost({
      platform: 'threads',
      destinationUrl: null,
    });
    const validation = validatePreparedPost(missingDestPost);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes('canonical Paper English destination URL'))).toBe(true);

    // Foreign non-Paper English URL
    const foreignPost = buildPost({
      platform: 'facebook',
      destinationUrl: 'https://other-site.com/?utm_source=facebook&utm_medium=organic_social&utm_campaign=c&utm_content=1',
    });
    const foreignValidation = validatePreparedPost(foreignPost);
    expect(foreignValidation.valid).toBe(false);
    expect(foreignValidation.errors.some((e) => e.includes('canonical Paper English URL'))).toBe(true);
  });

  it('no duplicate URL if copy already contains canonical destination', () => {
    const postWithUrl = buildPost({
      platform: 'threads',
      copyText: `你不敢點啦 👀🔥\n\nhttps://paperbond.jjmowlab.com/?utm_source=threads&utm_medium=organic_social&utm_campaign=always-on&utm_content=test-post-1`,
    });
    const formatted = formatPublishCopyText(postWithUrl);
    const matches = formatted.match(/paperbond\.jjmowlab\.com/g);
    expect(matches).toHaveLength(1);
    expect(formatted).toBe(postWithUrl.copyText);
  });

  it('normalizes bare canonical URL in copy to attributed URL without duplication', () => {
    const postWithBare = buildPost({
      platform: 'threads',
      copyText: '你不敢點啦 👀🔥\nhttps://paperbond.jjmowlab.com',
    });
    const formatted = formatPublishCopyText(postWithBare);
    const matches = formatted.match(/paperbond\.jjmowlab\.com/g);
    expect(matches).toHaveLength(1);
    expect(formatted).toContain('utm_source=threads');
  });

  it('Instagram behavior remains unchanged (image-first, no mandatory caption URL)', () => {
    const igPost = buildPost({
      platform: 'instagram',
      assetMode: 'image_post',
      mediaUrl: 'https://example.com/ig.png',
      destinationUrl: null,
      ctaMode: 'none',
      copyText: 'IG 貼文注重視覺與教材試閱，內文無點擊連結。',
    });
    const formatted = formatPublishCopyText(igPost);
    expect(formatted).toBe('IG 貼文注重視覺與教材試閱，內文無點擊連結。');
    expect(validatePreparedPost(igPost).valid).toBe(true);
    expect(formatFirstComment(igPost)).toBeNull();
  });

  it('first comment / Threads reply does not substitute for required main-body URL', () => {
    // If post has firstCommentText or secondary reply, it STILL must have destinationUrl in main body
    const post = buildPost({
      platform: 'threads',
      assetMode: 'image_post',
      mediaUrl: 'https://example.com/asset.png',
      ctaMode: 'soft',
      firstCommentText: '🔗 了解更多與教材試閱：https://paperbond.jjmowlab.com',
    });
    const formatted = formatPublishCopyText(post);
    expect(formatted).toContain(post.destinationUrl!);

    const reply = formatThreadsReply(post);
    expect(reply).toBe('🔗 了解更多與教材試閱：https://paperbond.jjmowlab.com');

    // Without destinationUrl in post, having a reply is NOT enough to pass validation
    const invalidPost = buildPost({
      platform: 'threads',
      destinationUrl: null,
      firstCommentText: '🔗 了解更多：https://paperbond.jjmowlab.com',
    });
    expect(validatePreparedPost(invalidPost).valid).toBe(false);
  });

  it('enqueuePlan automatically assigns canonical attributed destinationUrl to Threads and Facebook text_only and ctaMode=none posts', async () => {
    const scheduledPosts: any[] = [];
    const mockRepo = {
      getRecentVisualConcepts: async () => [],
      findPlan: async () => 'plan-auto-url',
      getExistingPostsForDate: async () => [],
      countPostsForDateRange: async () => 0,
      schedule: async (p: any) => {
        scheduledPosts.push(p);
      },
    } as any;

    const payload = {
      planDate: '2026-09-07',
      archetype: 'pain_point',
      topic: '背單字卡關',
      posts: [
        {
          platform: 'threads' as const,
          assetMode: 'text_only' as const,
          ctaMode: 'none' as const,
          copyText: '會考英文不是單字比賽。💀',
          // Note: destinationUrl intentionally omitted by author
        },
        {
          platform: 'facebook' as const,
          assetMode: 'image_post' as const,
          mediaUrl: 'https://example.com/asset.png',
          ctaMode: 'none' as const,
          copyText: '真正卡死孩子的是看完整篇還抓不到重點。',
          // destinationUrl omitted
        },
      ],
    };

    const result = await enqueuePlan(payload, mockRepo, getTestOffer);
    expect(result.enqueued).toBe(2);
    expect(scheduledPosts).toHaveLength(2);

    const thPost = scheduledPosts[0];
    expect(thPost.destinationUrl).toBeTruthy();
    expect(thPost.destinationUrl).toContain('https://paperbond.jjmowlab.com');
    expect(thPost.destinationUrl).toContain('utm_source=threads');

    const fbPost = scheduledPosts[1];
    expect(fbPost.destinationUrl).toBeTruthy();
    expect(fbPost.destinationUrl).toContain('https://paperbond.jjmowlab.com');
    expect(fbPost.destinationUrl).toContain('utm_source=facebook');
  });
});
