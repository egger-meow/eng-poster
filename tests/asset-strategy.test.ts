import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attributedUrl } from '../src/content/utm.js';
import { validatePreparedPost, formatPublishCopyText, formatFirstComment, formatThreadsReply } from '../src/content/gates.js';
import { BufferPublisher } from '../src/platforms/buffer.js';
import type { PreparedPost } from '../src/types.js';

describe('post asset strategy and first-comment/reply modeling', () => {
  const basePost = (over: Partial<PreparedPost> = {}): PreparedPost => {
    const platform = over.platform ?? 'facebook';
    return {
      id: 'post_strat_1',
      contentPlanId: 'plan_strat_1',
      platform,
      assetMode: over.assetMode ?? 'image_post',
      copyText: '孩子背了就忘，其實問題在於學習材料缺少真實興趣連結。',
      destinationUrl: attributedUrl('https://paperbond.jjmowlab.com', platform, 'always-on', 'post_strat_1'),
      mediaUrl: 'https://supabase.co/storage/v1/object/public/marketing-media/manual/sample.png',
      mediaAssetId: 'a1b2c3d4-e5f6-4a5b-8c7d-9e0f1a2b3c4d',
      scheduledFor: '2026-09-01T12:00:00Z',
      idempotencyKey: '2026-09-01:facebook:strategy:1',
      campaignSlug: 'always-on',
      claimManifest: [],
      ctaMode: 'soft',
      ...over,
    };
  };

  describe('deterministic gate validations across platforms', () => {
    // Facebook
    it('accepts valid Facebook link_preview post with canonical URL and no media', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
      });
      expect(validatePreparedPost(post).valid).toBe(true);
    });

    it('rejects Facebook link_preview post when media asset is attached', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        mediaUrl: 'https://example.com/img.png',
      });
      const result = validatePreparedPost(post);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('facebook link_preview must not have an attached media asset');
    });

    it('rejects Facebook link_preview post without canonical destination URL', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
        destinationUrl: null,
      });
      const result = validatePreparedPost(post);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('facebook link_preview requires a canonical destination URL');
    });

    it('accepts valid Facebook image_post with media and clean body', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
      });
      expect(validatePreparedPost(post).valid).toBe(true);
    });

    it('rejects Facebook image_post when body includes raw URL by default', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
        copyText: '查看最新進度：https://paperbond.jjmowlab.com 了解詳情。',
      });
      const result = validatePreparedPost(post);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('facebook image_post must not include raw URL in body by default');
    });

    it('accepts valid Facebook text_only post with no media and no canonical URL', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'text_only',
        mediaUrl: null,
        mediaAssetId: null,
        destinationUrl: null,
      });
      expect(validatePreparedPost(post).valid).toBe(true);
    });

    it('rejects Facebook text_only post when destination URL is attached', () => {
      const post = basePost({
        platform: 'facebook',
        assetMode: 'text_only',
        mediaUrl: null,
        mediaAssetId: null,
      });
      const result = validatePreparedPost(post);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('facebook text_only must not have a canonical destination URL');
    });

    // Threads
    it('accepts valid Threads text_only, image_post, and link_preview modes', () => {
      const textOnly = basePost({
        platform: 'threads',
        assetMode: 'text_only',
        mediaUrl: null,
        mediaAssetId: null,
        destinationUrl: null,
      });
      expect(validatePreparedPost(textOnly).valid).toBe(true);

      const imagePost = basePost({
        platform: 'threads',
        assetMode: 'image_post',
      });
      expect(validatePreparedPost(imagePost).valid).toBe(true);

      const linkPreview = basePost({
        platform: 'threads',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
      });
      expect(validatePreparedPost(linkPreview).valid).toBe(true);
    });

    it('rejects Threads image_post when raw URL is embedded in body', () => {
      const post = basePost({
        platform: 'threads',
        assetMode: 'image_post',
        copyText: '點擊體驗 paperbond.jjmowlab.com 來看看',
      });
      const result = validatePreparedPost(post);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('threads image_post must not include raw URL in body by default');
    });

    it('rejects Threads link_preview post with multiple URLs in body', () => {
      const post = basePost({
        platform: 'threads',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
        copyText: '請參考 https://paperbond.jjmowlab.com 與 https://me.jjmowlab.com 兩篇說明',
      });
      const result = validatePreparedPost(post);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('threads link_preview allows at most one canonical URL in body');
    });

    // Instagram
    it('accepts Instagram image_post with media and clean caption', () => {
      const post = basePost({
        platform: 'instagram',
        assetMode: 'image_post',
      });
      expect(validatePreparedPost(post).valid).toBe(true);
    });

    it('rejects Instagram text_only and link_preview modes', () => {
      const textOnly = basePost({
        platform: 'instagram',
        assetMode: 'text_only',
        mediaUrl: null,
        mediaAssetId: null,
        destinationUrl: null,
      });
      expect(validatePreparedPost(textOnly).errors).toContain('instagram only supports image_post mode');

      const linkPreview = basePost({
        platform: 'instagram',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
      });
      expect(validatePreparedPost(linkPreview).errors).toContain('instagram only supports image_post mode');
    });

    it('rejects Instagram post when media is missing', () => {
      const post = basePost({
        platform: 'instagram',
        assetMode: 'image_post',
        mediaUrl: null,
        mediaAssetId: null,
      });
      expect(validatePreparedPost(post).errors).toContain('instagram requires media');
    });
  });

  describe('attribution and formatting helpers', () => {
    it('formatPublishCopyText appends canonical URL only when link_preview and not already present', () => {
      const linkPost = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        copyText: 'Check our blog',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      });
      expect(formatPublishCopyText(linkPost)).toBe('Check our blog\n\nhttps://paperbond.jjmowlab.com/?utm_source=facebook');

      const alreadyHasUrl = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        copyText: 'Visit https://paperbond.jjmowlab.com/?utm_source=facebook now',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      });
      expect(formatPublishCopyText(alreadyHasUrl)).toBe('Visit https://paperbond.jjmowlab.com/?utm_source=facebook now');

      const imagePost = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
        copyText: 'Clean image copy',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      });
      expect(formatPublishCopyText(imagePost)).toBe('Clean image copy');
    });

    it('formatFirstComment creates comment text only for image_post when ctaMode is not none', () => {
      const imagePost = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
        ctaMode: 'soft',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      });
      expect(formatFirstComment(imagePost)).toContain('https://paperbond.jjmowlab.com/?utm_source=facebook');

      const ctaNone = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
        ctaMode: 'none',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      });
      expect(formatFirstComment(ctaNone)).toBeNull();

      const linkPreview = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      });
      expect(formatFirstComment(linkPreview)).toBeNull();
    });

    it('formatThreadsReply creates thread reply text only for threads image_post when ctaMode is not none', () => {
      const thImage = basePost({
        platform: 'threads',
        assetMode: 'image_post',
        ctaMode: 'soft',
        destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=threads',
      });
      expect(formatThreadsReply(thImage)).toContain('https://paperbond.jjmowlab.com/?utm_source=threads');

      const thNone = basePost({
        platform: 'threads',
        assetMode: 'image_post',
        ctaMode: 'none',
      });
      expect(formatThreadsReply(thNone)).toBeNull();

      const fbImage = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
      });
      expect(formatThreadsReply(fbImage)).toBeNull();
    });
  });

  describe('Buffer publishing payload dispatch & attribution strategy', () => {
    let originalFetch: typeof globalThis.fetch;
    let interceptedInput: any;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      process.env.BUFFER_API_KEY = 'test_buffer_api_key';
      interceptedInput = null;

      const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.query?.includes('GetOrganizations')) {
          return new Response(
            JSON.stringify({ data: { account: { organizations: [{ id: 'org_1', name: 'Paper English' }] } } }),
            { status: 200 }
          );
        }
        if (body.query?.includes('GetChannels')) {
          return new Response(
            JSON.stringify({
              data: {
                channels: [
                  { id: 'ch_fb_1', name: 'Paper English FB', service: 'facebook' },
                  { id: 'ch_ig_1', name: 'Paper English IG', service: 'instagram' },
                  { id: 'ch_th_1', name: 'Paper English Threads', service: 'threads' },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (body.query?.includes('CreatePost')) {
          interceptedInput = body.variables.input;
          return new Response(
            JSON.stringify({
              data: {
                createPost: {
                  post: {
                    id: 'post_published_ok',
                    status: 'sent',
                    externalLink: 'https://example.com/live',
                  },
                },
              },
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 404 });
      });
      globalThis.fetch = fetchMock;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('FB image + CTA => media on main post, URL only in firstComment', async () => {
      const fbPost = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
        ctaMode: 'soft',
      });
      const publisher = new BufferPublisher('facebook');
      await publisher.publish(fbPost);

      // Main post has media asset
      expect(interceptedInput.assets).toEqual([
        { image: { url: fbPost.mediaUrl } },
      ]);
      // Main text contains clean copy without raw URL
      expect(interceptedInput.text).toBe(fbPost.copyText);
      expect(interceptedInput.text).not.toContain('https://');
      // URL is positioned strictly in metadata.facebook.firstComment
      expect(interceptedInput.metadata?.facebook?.type).toBe('post');
      expect(interceptedInput.metadata?.facebook?.firstComment).toContain(fbPost.destinationUrl);
    });

    it('IG image + CTA => media on main post, URL only in firstComment', async () => {
      const igPost = basePost({
        platform: 'instagram',
        assetMode: 'image_post',
        ctaMode: 'direct',
      });
      const publisher = new BufferPublisher('instagram');
      await publisher.publish(igPost);

      // Main post has media asset
      expect(interceptedInput.assets).toEqual([
        { image: { url: igPost.mediaUrl } },
      ]);
      // Caption is clean without raw URL
      expect(interceptedInput.text).toBe(igPost.copyText);
      expect(interceptedInput.text).not.toContain('https://');
      // URL is placed in metadata.instagram.firstComment
      expect(interceptedInput.metadata?.instagram?.type).toBe('post');
      expect(interceptedInput.metadata?.instagram?.shouldShareToFeed).toBe(true);
      expect(interceptedInput.metadata?.instagram?.firstComment).toContain(igPost.destinationUrl);
    });

    it('Threads image + CTA => URL only in second thread item', async () => {
      const thPost = basePost({
        platform: 'threads',
        assetMode: 'image_post',
        ctaMode: 'soft',
      });
      const publisher = new BufferPublisher('threads');
      await publisher.publish(thPost);

      // Main post has media asset
      expect(interceptedInput.assets).toEqual([
        { image: { url: thPost.mediaUrl } },
      ]);
      // Top-level text is clean copy without URL
      expect(interceptedInput.text).toBe(thPost.copyText);
      expect(interceptedInput.text).not.toContain('https://');
      // Threads metadata contains 2-item thread array
      expect(interceptedInput.metadata?.threads?.thread).toHaveLength(2);
      expect(interceptedInput.metadata.threads.thread[0].text).toBe(thPost.copyText);
      expect(interceptedInput.metadata.threads.thread[1].text).toContain(thPost.destinationUrl);
    });

    it('CTA none => no automatic first comment or reply', async () => {
      // FB image + CTA none
      const fbNone = basePost({
        platform: 'facebook',
        assetMode: 'image_post',
        ctaMode: 'none',
        destinationUrl: null,
      });
      const fbPub = new BufferPublisher('facebook');
      await fbPub.publish(fbNone);
      expect(interceptedInput.metadata?.facebook?.firstComment).toBeUndefined();

      // IG image + CTA none
      const igNone = basePost({
        platform: 'instagram',
        assetMode: 'image_post',
        ctaMode: 'none',
        destinationUrl: null,
      });
      const igPub = new BufferPublisher('instagram');
      await igPub.publish(igNone);
      expect(interceptedInput.metadata?.instagram?.firstComment).toBeUndefined();

      // Threads image + CTA none
      const thNone = basePost({
        platform: 'threads',
        assetMode: 'image_post',
        ctaMode: 'none',
        destinationUrl: null,
      });
      const thPub = new BufferPublisher('threads');
      await thPub.publish(thNone);
      expect(interceptedInput.metadata?.threads?.thread).toBeUndefined();
    });

    it('link_preview => canonical URL in main post body, no duplicate comment or reply, no attached media', async () => {
      // FB link_preview
      const fbLink = basePost({
        platform: 'facebook',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
      });
      const fbPub = new BufferPublisher('facebook');
      await fbPub.publish(fbLink);
      expect(interceptedInput.assets).toBeUndefined();
      expect(interceptedInput.text).toContain(fbLink.destinationUrl);
      expect(interceptedInput.metadata?.facebook?.firstComment).toBeUndefined();

      // Threads link_preview
      const thLink = basePost({
        platform: 'threads',
        assetMode: 'link_preview',
        mediaUrl: null,
        mediaAssetId: null,
      });
      const thPub = new BufferPublisher('threads');
      await thPub.publish(thLink);
      expect(interceptedInput.assets).toBeUndefined();
      expect(interceptedInput.text).toContain(thLink.destinationUrl);
      expect(interceptedInput.metadata?.threads?.thread).toBeUndefined();
    });
  });
});
