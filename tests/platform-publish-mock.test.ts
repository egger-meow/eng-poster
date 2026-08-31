import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacebookPublisher, facebookPayload } from '../src/platforms/facebook.js';
import { InstagramPublisher, instagramContainerPayload } from '../src/platforms/instagram.js';
import { ThreadsPublisher, threadsContainerPayload } from '../src/platforms/threads.js';
import type { PreparedPost } from '../src/types.js';

describe('platform publishers with mocked Meta API endpoints', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.META_GRAPH_VERSION = 'v22.0';
    process.env.FACEBOOK_PAGE_ID = 'page_123';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'fb_token_xyz';
    process.env.INSTAGRAM_USER_ID = 'ig_user_456';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'ig_token_xyz';
    process.env.THREADS_USER_ID = 'threads_user_789';
    process.env.THREADS_ACCESS_TOKEN = 'th_token_xyz';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const mockPost: PreparedPost = {
    id: 'post_1',
    contentPlanId: 'plan_1',
    platform: 'facebook',
    copyText: '孩子不是討厭英文，他只是需要感興趣的教材。',
    destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
    mediaUrl: 'https://supabase.co/storage/v1/object/public/marketing-media/manual/sample.png',
    scheduledFor: '2026-08-31T12:00:00Z',
    idempotencyKey: '2026-08-31:facebook:1',
    campaignSlug: 'always-on',
    claimManifest: [],
  };

  it('builds valid Facebook, Instagram, and Threads payloads', () => {
    const fbPayload = facebookPayload(mockPost);
    expect(fbPayload.get('message')).toBe(mockPost.copyText);
    expect(fbPayload.get('link')).toBe(mockPost.destinationUrl);
    expect(fbPayload.get('url')).toBe(mockPost.mediaUrl);
    expect(fbPayload.get('access_token')).toBe('fb_token_xyz');

    const igPayload = instagramContainerPayload({ ...mockPost, platform: 'instagram' });
    expect(igPayload.get('image_url')).toBe(mockPost.mediaUrl);
    expect(igPayload.get('caption')).toBe(mockPost.copyText);

    const thPayload = threadsContainerPayload({ ...mockPost, platform: 'threads', mediaUrl: null });
    expect(thPayload.get('media_type')).toBe('TEXT');
    expect(thPayload.get('text')).toBe(mockPost.copyText);
  });

  it('publishes to Facebook and retrieves real permalink_url', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/photos')) {
        return new Response(JSON.stringify({ id: 'photo_100', post_id: 'page_123_photo_100' }), { status: 200 });
      }

      if (url.includes('/page_123_photo_100')) {
        return new Response(
          JSON.stringify({
            id: 'page_123_photo_100',
            permalink_url: 'https://www.facebook.com/paperenglish/posts/100',
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const fb = new FacebookPublisher();
    const result = await fb.publish(mockPost);

    expect(result.platformPostId).toBe('page_123_photo_100');
    expect(result.platformPostUrl).toBe('https://www.facebook.com/paperenglish/posts/100');
  });

  it('publishes to Instagram and polls container status before publishing and fetching permalink', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/media_publish') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ig_media_888' }), { status: 200 });
      }
      if (url.includes('/ig_user_456/media') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'container_999' }), { status: 200 });
      }
      if (url.includes('/container_999')) {
        return new Response(JSON.stringify({ id: 'container_999', status_code: 'FINISHED' }), { status: 200 });
      }
      if (url.includes('/ig_media_888')) {
        return new Response(
          JSON.stringify({
            id: 'ig_media_888',
            permalink: 'https://www.instagram.com/p/DFxyz123/',
            shortcode: 'DFxyz123',
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const igPost: PreparedPost = { ...mockPost, platform: 'instagram' };
    const ig = new InstagramPublisher();
    const result = await ig.publish(igPost);

    expect(result.platformPostId).toBe('ig_media_888');
    expect(result.platformPostUrl).toBe('https://www.instagram.com/p/DFxyz123/');
  });

  it('publishes to Threads and retrieves real official permalink', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/me/threads_publish') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'th_post_222' }), { status: 200 });
      }
      if (url.includes('/me/threads') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'th_container_111' }), { status: 200 });
      }
      if (url.includes('/th_post_222')) {
        return new Response(
          JSON.stringify({
            id: 'th_post_222',
            permalink: 'https://www.threads.net/@paperenglish/post/DFabc789',
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const thPost: PreparedPost = { ...mockPost, platform: 'threads', mediaUrl: null };
    const th = new ThreadsPublisher();
    const result = await th.publish(thPost);

    expect(result.platformPostId).toBe('th_post_222');
    expect(result.platformPostUrl).toBe('https://www.threads.net/@paperenglish/post/DFabc789');
  });


  it('refreshes Threads token and returns new access token with expiry', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/refresh_access_token')) {
        return new Response(
          JSON.stringify({
            access_token: 'th_new_refreshed_token',
            token_type: 'bearer',
            expires_in: 5184000,
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const th = new ThreadsPublisher();
    const refresh = await th.refreshToken();

    expect(refresh.accessToken).toBe('th_new_refreshed_token');
    expect(refresh.expiresIn).toBe(5184000);
    expect(refresh.expiresAt).toBeTruthy();
  });

  it('validates Facebook credentials and observes real granted scopes and expiry from debug_token', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/page_123?fields=id,name')) {
        return new Response(JSON.stringify({ id: 'page_123', name: 'Paper English' }), { status: 200 });
      }
      if (url.includes('/debug_token')) {
        return new Response(
          JSON.stringify({
            data: {
              app_id: '123456',
              scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
              is_valid: true,
              expires_at: 1788134400,
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const fb = new FacebookPublisher();
    const health = await fb.validateCredentials();

    expect(health.valid).toBe(true);
    expect(health.accountId).toBe('page_123');
    expect(health.grantedScopes).toEqual(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']);
    expect(health.expiresAt).toBeTruthy();
    expect(health.diagnostic).toContain('scopes: [pages_show_list, pages_read_engagement, pages_manage_posts]');
  });

  it('reports empty scopes and uninspected status when debug_token is unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/me?fields=id,username,threads_profile_picture_url')) {
        return new Response(JSON.stringify({ id: 'threads_user_789', username: 'paperenglish' }), { status: 200 });
      }
      if (url.includes('/me?fields=id,username,account_type')) {
        return new Response(JSON.stringify({ id: 'ig_user_456', username: 'paperenglish' }), { status: 200 });
      }
      // Debug token endpoint fails / unavailable
      if (url.includes('/debug_token')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const th = new ThreadsPublisher();
    const thHealth = await th.validateCredentials();
    expect(thHealth.valid).toBe(true);
    expect(thHealth.grantedScopes).toEqual([]); // NEVER fabricated!
    expect(thHealth.diagnostic).toContain('[scopes: uninspected]');

    const ig = new InstagramPublisher();
    const igHealth = await ig.validateCredentials();
    expect(igHealth.valid).toBe(true);
    expect(igHealth.grantedScopes).toEqual([]); // NEVER fabricated!
    expect(igHealth.diagnostic).toContain('[scopes: uninspected]');
  });
});

