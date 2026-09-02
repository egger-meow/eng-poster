import { describe, expect, it } from 'vitest';
import { enqueuePlanSchema } from '../src/orchestration/enqueue-plan.js';
import { selectCopyLengthMode } from '../src/content/selection.js';
import {
  validatePreparedPost,
  formatPublishCopyText,
  formatFirstComment,
  formatThreadsReply,
} from '../src/content/gates.js';
import { attributedUrl } from '../src/content/utm.js';
import { findNextQueueGap } from '../src/orchestration/next-queue-gap.js';
import type { CopyLengthMode, Platform, PreparedPost } from '../src/types.js';
import type { MarketingRepository } from '../src/db/repository.js';
import type { AppConfig } from '../src/config.js';

const buildPost = (over: Partial<PreparedPost> = {}): PreparedPost => {
  const platform = over.platform ?? 'threads';
  const assetMode =
    over.assetMode ??
    (platform === 'instagram'
      ? 'image_post'
      : over.mediaUrl
        ? 'image_post'
        : over.destinationUrl === null
          ? 'text_only'
          : 'link_preview');

  return {
    id: 'test-post-uuid',
    contentPlanId: 'test-plan-uuid',
    platform,
    assetMode,
    copyLengthMode: over.copyLengthMode ?? 'short',
    copyText: over.copyText ?? '不敢挑戰孩子英文 A++？😈',
    destinationUrl:
      over.destinationUrl === null
        ? null
        : (over.destinationUrl ?? attributedUrl('https://paperbond.jjmowlab.com', platform, 'always-on', 'test-post-uuid')),
    scheduledFor: new Date().toISOString(),
    idempotencyKey: '2026-09-05:threads:1',
    campaignSlug: 'always-on',
    claimManifest: [],
    ...over,
  };
};

describe('Authoritative Copy-Length Contract & 1:1 Mix Tests', () => {
  describe('1. long/short mode schema', () => {
    it('accepts explicit copyLengthMode ("short" and "long")', () => {
      const validShort = enqueuePlanSchema.safeParse({
        planDate: '2026-09-05',
        archetype: 'pain_point',
        topic: '背單字挫折',
        posts: [
          {
            platform: 'threads',
            copyLengthMode: 'short',
            assetMode: 'text_only',
            copyText: '英文還在每天背 20 個單字喔 😭\n那真的有點硬欸。',
          },
        ],
      });
      expect(validShort.success).toBe(true);
      if (validShort.success) {
        expect(validShort.data.posts[0]?.copyLengthMode).toBe('short');
      }

      const validLong = enqueuePlanSchema.safeParse({
        planDate: '2026-09-05',
        archetype: 'educational_value',
        topic: '長文閱讀策略',
        posts: [
          {
            platform: 'threads',
            copyLengthMode: 'long',
            assetMode: 'text_only',
            copyText: '孩子看到英文長文就靈魂出竅？很多時候不是單字量不夠，而是閱讀時沒有建立語意區塊...',
          },
        ],
      });
      expect(validLong.success).toBe(true);
      if (validLong.success) {
        expect(validLong.data.posts[0]?.copyLengthMode).toBe('long');
      }
    });

    it('accepts snake_case copy_length_mode alias', () => {
      const parsed = enqueuePlanSchema.safeParse({
        planDate: '2026-09-05',
        archetype: 'pain_point',
        topic: '測試',
        posts: [
          {
            platform: 'facebook',
            copy_length_mode: 'short',
            assetMode: 'text_only',
            copyText: '短貼文測試🔥',
          },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.posts[0]?.copy_length_mode).toBe('short');
      }
    });

    it('rejects invalid copy length mode value', () => {
      const parsed = enqueuePlanSchema.safeParse({
        planDate: '2026-09-05',
        archetype: 'pain_point',
        topic: '測試',
        posts: [
          {
            platform: 'threads',
            copyLengthMode: 'medium', // Invalid
            copyText: '測試',
          },
        ],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('2. rolling mix selects underrepresented mode', () => {
    it('selects short on empty history', () => {
      expect(selectCopyLengthMode([])).toBe('short');
    });

    it('selects short when long is overrepresented in history', () => {
      const history: CopyLengthMode[] = ['long', 'long', 'short', 'long'];
      expect(selectCopyLengthMode(history)).toBe('short');
    });

    it('selects long when short is overrepresented in history', () => {
      const history: CopyLengthMode[] = ['short', 'short', 'short', 'long'];
      expect(selectCopyLengthMode(history)).toBe('long');
    });

    it('converges to 1:1 balance across sequential selections', () => {
      let history: CopyLengthMode[] = ['long', 'long', 'long', 'long']; // heavily skewed long
      const choices: CopyLengthMode[] = [];

      for (let i = 0; i < 8; i++) {
        const next = selectCopyLengthMode(history);
        choices.push(next);
        history = [...history, next];
      }

      // Since long was overrepresented by 4, the next 4 selections should be 'short'
      expect(choices.slice(0, 4)).toEqual(['short', 'short', 'short', 'short']);
      // Overall counts in history should now be 5 long, 5 short (1:1 target)
      const shortCount = history.filter((m) => m === 'short').length;
      const longCount = history.filter((m) => m === 'long').length;
      expect(shortCount).toBe(longCount);
    });

    it('does not force mechanical strict alternation when naturally balanced', () => {
      // With equal history, tie breaker chooses first key ('short')
      const initial = selectCopyLengthMode(['short', 'long']);
      expect(initial).toBe('short');
    });
  });

  describe('3. short Threads post below old 150-char recommendation is accepted', () => {
    it('accepts short Threads post with 20 characters', () => {
      const post = buildPost({
        platform: 'threads',
        copyLengthMode: 'short',
        assetMode: 'text_only',
        copyText: '不敢挑戰孩子英文 A++？😈',
        destinationUrl: null,
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(post.copyText.length).toBeLessThan(150);
    });
  });

  describe('4. short FB post is accepted', () => {
    it('accepts short Facebook post well under 150 characters', () => {
      const post = buildPost({
        platform: 'facebook',
        copyLengthMode: 'short',
        assetMode: 'text_only',
        copyText: '會考閱讀：\n你以為在考單字？\n它其實在考你到底看不看得懂。💀',
        destinationUrl: null,
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(post.copyText.length).toBeLessThan(150);
    });
  });

  describe('5. short-mode copy can be extremely small', () => {
    it('accepts extremely small punchline copy (e.g. 6-10 characters)', () => {
      const post = buildPost({
        platform: 'threads',
        copyLengthMode: 'short',
        assetMode: 'text_only',
        copyText: '嚇到了... 😳',
        destinationUrl: null,
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(true);
      expect(post.copyText.length).toBe(9);
    });

    it('accepts short post with URL', () => {
      const post = buildPost({
        platform: 'threads',
        copyLengthMode: 'short',
        assetMode: 'link_preview',
        copyText: '你不敢點啦 👀🔥\npaperbond.jjmowlab.com',
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(true);
    });
  });

  describe('6. long-mode and short-mode length bounds enforcement', () => {
    it('rejects post copy exceeding platform hard limit (Threads > 500)', () => {
      const post = buildPost({
        platform: 'threads',
        copyLengthMode: 'long',
        assetMode: 'text_only',
        copyText: '長'.repeat(501),
        destinationUrl: null,
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('exceeds 500 characters');
    });

    it('rejects short mode post exceeding short maximum limit', () => {
      const post = buildPost({
        platform: 'threads',
        copyLengthMode: 'short',
        assetMode: 'text_only',
        copyText: '這是一段聲稱是 short 模式但實際上寫得太冗長的貼文內容'.repeat(5), // ~160 chars
        destinationUrl: null,
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('exceeds maximum limit of 140 characters');
    });
  });

  describe('7. short CTA / link_preview can carry canonical destination URL', () => {
    it('formats link_preview post with canonical destination URL', () => {
      const post = buildPost({
        platform: 'threads',
        copyLengthMode: 'short',
        assetMode: 'link_preview',
        copyText: '不敢挑戰孩子英文 A++？😈',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=threads&utm_medium=organic_social&utm_campaign=always-on&utm_content=test-post-uuid',
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(true);

      const publishedText = formatPublishCopyText(post);
      expect(publishedText).toContain('不敢挑戰孩子英文 A++？😈');
      expect(publishedText).toContain('https://paperbond.jjmowlab.com/?utm_source=threads');
    });
  });

  describe('8. image_post URL hygiene / first-comment behavior remains unchanged', () => {
    it('keeps image_post main body clean and dispatches destination URL in comment/reply', () => {
      const fbPost = buildPost({
        platform: 'facebook',
        assetMode: 'image_post',
        mediaUrl: 'https://example.com/asset.png',
        copyText: '英文閱讀不用死背單字，從孩子感興趣的主題開始建立語感。🔥',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook&utm_medium=organic_social&utm_campaign=always-on&utm_content=p1',
        ctaMode: 'soft',
      });

      expect(validatePreparedPost(fbPost).valid).toBe(true);
      const fbComment = formatFirstComment(fbPost);
      expect(fbComment).toContain('👉 了解詳情與教材試閱：');
      expect(fbComment).toContain('https://paperbond.jjmowlab.com/?utm_source=facebook');

      const threadsPost = buildPost({
        platform: 'threads',
        assetMode: 'image_post',
        mediaUrl: 'https://example.com/asset.png',
        copyText: '孩子的英文教材，由他的興趣決定。⚡️',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=threads&utm_medium=organic_social&utm_campaign=always-on&utm_content=p2',
        ctaMode: 'direct',
      });

      expect(validatePreparedPost(threadsPost).valid).toBe(true);
      const threadsReply = formatThreadsReply(threadsPost);
      expect(threadsReply).toContain('🔗 了解更多與教材試閱：');
      expect(threadsReply).toContain('https://paperbond.jjmowlab.com/?utm_source=threads');
    });

    it('rejects image_post with raw URL in copy text by default', () => {
      const post = buildPost({
        platform: 'facebook',
        assetMode: 'image_post',
        mediaUrl: 'https://example.com/asset.png',
        copyText: '點擊此處報名：https://paperbond.jjmowlab.com',
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('image_post must not include raw URL in body');
    });
  });

  describe('9. text_only URL prohibition remains unchanged', () => {
    it('rejects text_only containing raw URL or destinationUrl', () => {
      const rawUrlPost = buildPost({
        platform: 'threads',
        assetMode: 'text_only',
        copyText: '看這裡 paperbond.jjmowlab.com',
        destinationUrl: null,
      });
      expect(validatePreparedPost(rawUrlPost).valid).toBe(false);

      const destUrlPost = buildPost({
        platform: 'threads',
        assetMode: 'text_only',
        copyText: '純文字貼文',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=threads',
      });
      expect(validatePreparedPost(destUrlPost).valid).toBe(false);
    });
  });

  describe('10. queue-gap behavior and recommendedCopyLengthMode', () => {
    const testConfig: AppConfig = {
      version: 'v0',
      timezone: 'Asia/Taipei',
      websiteBaseUrl: 'https://paperbond.jjmowlab.com',
      platforms: {
        threads: {
          enabled: true,
          postsPerDay: 2,
          windows: ['11:30-13:30', '19:00-22:00'],
          hardDailyCap: 3,
        },
        facebook: {
          enabled: true,
          postsPerWeek: 4,
          preferredDays: ['tue', 'thu', 'sat', 'sun'],
          windows: ['19:00-21:30'],
          hardDailyCap: 1,
        },
        instagram: {
          enabled: true,
          postsPerWeek: 3,
          preferredDays: ['mon', 'wed', 'fri'],
          windows: ['19:00-21:30'],
          hardDailyCap: 1,
        },
      },
      contentMix: {
        painPointOrOpinion: 0.35,
        educationalValue: 0.25,
        productProof: 0.2,
        timelyTopic: 0.1,
        conversion: 0.1,
      },
      cta: { none: 0.5, soft: 0.3, direct: 0.2 },
      media: { exactAssetCooldownDays: 30, visualConceptCooldownDays: 7 },
      retries: { maxPublishAttempts: 4, maxAuthoringRepairs: 1, leaseMinutes: 15 },
      dispatcher: { lookaheadHours: 24 },
      utm: { medium: 'organic_social' },
    };

    it('recommends short when recent history is skewed long', async () => {
      const mockRepo = {
        countPostsForDateRange: async () => 0,
        getExistingPostsForDate: async () => [],
        getRecentCopyLengthModes: async () => ['long', 'long', 'long'] as CopyLengthMode[],
      } as unknown as MarketingRepository;

      const result = await findNextQueueGap(
        { startFrom: '2026-09-05T08:00:00+08:00' },
        mockRepo,
        testConfig
      );

      expect(result.targetDate).toBe('2026-09-05');
      expect(result.recommendedCopyLengthMode).toBe('short');
    });

    it('recommends long when recent history is skewed short', async () => {
      const mockRepo = {
        countPostsForDateRange: async () => 0,
        getExistingPostsForDate: async () => [],
        getRecentCopyLengthModes: async () => ['short', 'short', 'short'] as CopyLengthMode[],
      } as unknown as MarketingRepository;

      const result = await findNextQueueGap(
        { startFrom: '2026-09-05T08:00:00+08:00' },
        mockRepo,
        testConfig
      );

      expect(result.targetDate).toBe('2026-09-05');
      expect(result.recommendedCopyLengthMode).toBe('long');
    });
  });

  describe('11. 14-day stockpile behavior unchanged', () => {
    const testConfig: AppConfig = {
      version: 'v0',
      timezone: 'Asia/Taipei',
      websiteBaseUrl: 'https://paperbond.jjmowlab.com',
      platforms: {
        threads: {
          enabled: true,
          postsPerDay: 2,
          windows: ['11:30-13:30', '19:00-22:00'],
          hardDailyCap: 3,
        },
        facebook: {
          enabled: true,
          postsPerWeek: 4,
          preferredDays: ['tue', 'thu', 'sat', 'sun'],
          windows: ['19:00-21:30'],
          hardDailyCap: 1,
        },
        instagram: {
          enabled: true,
          postsPerWeek: 3,
          preferredDays: ['mon', 'wed', 'fri'],
          windows: ['19:00-21:30'],
          hardDailyCap: 1,
        },
      },
      contentMix: {
        painPointOrOpinion: 0.35,
        educationalValue: 0.25,
        productProof: 0.2,
        timelyTopic: 0.1,
        conversion: 0.1,
      },
      cta: { none: 0.5, soft: 0.3, direct: 0.2 },
      media: { exactAssetCooldownDays: 30, visualConceptCooldownDays: 7 },
      retries: { maxPublishAttempts: 4, maxAuthoringRepairs: 1, leaseMinutes: 15 },
      dispatcher: { lookaheadHours: 24 },
      utm: { medium: 'organic_social' },
    };

    it('returns targetDate: null when 14-day horizon is fully booked', async () => {
      const mockRepo = {
        countPostsForDateRange: async () => 50,
        getExistingPostsForDate: async (date: string, platform: Platform) => {
          if (platform === 'threads') {
            return [
              { id: 'p1', idempotency_key: `${date}:threads:1`, status: 'scheduled' },
              { id: 'p2', idempotency_key: `${date}:threads:2`, status: 'scheduled' },
            ];
          }
          return [{ id: 'p1', idempotency_key: `${date}:${platform}:1`, status: 'scheduled' }];
        },
      } as unknown as MarketingRepository;

      const result = await findNextQueueGap(
        { horizonDays: 14, startFrom: '2026-09-02T08:00:00+08:00' },
        mockRepo,
        testConfig
      );

      expect(result.targetDate).toBeNull();
      expect(result.missing).toEqual([]);
      expect(result.queueDaysAhead).toBe(14);
      expect(result.message).toContain('Queue fully stocked');
    });
  });

  describe('12. claim safety & quality gates', () => {
    it('allows rhetorical provocative hook without factual guarantee', () => {
      const post = buildPost({
        copyText: '不敢挑戰孩子英文 A++？😈',
        claimManifest: [
          {
            text: '不敢挑戰孩子英文 A++？',
            kind: 'rhetorical',
            sourceUrls: [],
          },
        ],
      });

      expect(validatePreparedPost(post).valid).toBe(true);
    });

    it('rejects forbidden score/outcome guarantees without verified sources', () => {
      const post = buildPost({
        copyText: '保證會考英文拿到 A++，保證進步 30 分！',
        claimManifest: [],
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('guaranteed outcome claims are forbidden without verified evidence');
    });

    it('rejects short mode copy containing generic AI intros', () => {
      const post = buildPost({
        copyLengthMode: 'short',
        copyText: '很多家長都會發現，孩子背單字背不起來。😭',
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('short mode copy must not contain generic AI intro phrase');
    });

    it('rejects short mode copy containing conclusion filler', () => {
      const post = buildPost({
        copyLengthMode: 'short',
        copyText: '英文閱讀很有趣。總而言之，選對教材最重要。',
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('short mode copy must not contain conclusion filler');
    });

    it('rejects short mode copy containing multi-item listicles', () => {
      const post = buildPost({
        copyLengthMode: 'short',
        copyText: '三個重點：\n1. 興趣優先\n2. 每天閱讀\n3. 不要死背',
      });

      const validation = validatePreparedPost(post);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain('short mode copy must not contain multi-item listicles');
    });
  });
});
