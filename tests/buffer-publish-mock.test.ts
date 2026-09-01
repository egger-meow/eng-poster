import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferClient, BufferPublisher } from '../src/platforms/buffer.js';
import { PlatformError, classifyError } from '../src/platforms/base.js';
import { attributedUrl } from '../src/content/utm.js';
import type { PreparedPost } from '../src/types.js';

describe('Buffer GraphQL publisher with mocked endpoints', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.BUFFER_API_KEY = 'test_buffer_api_key_123';
    delete process.env.BUFFER_FACEBOOK_CHANNEL_ID;
    delete process.env.BUFFER_INSTAGRAM_CHANNEL_ID;
    delete process.env.BUFFER_THREADS_CHANNEL_ID;
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
    destinationUrl: attributedUrl('https://paperbond.jjmowlab.com', 'facebook', 'always-on', 'post_1'),
    mediaUrl: 'https://supabase.co/storage/v1/object/public/marketing-media/manual/sample.png',
    scheduledFor: '2026-08-31T12:00:00Z',
    idempotencyKey: '2026-08-31:facebook:1',
    campaignSlug: 'always-on',
    claimManifest: [],
  };

  it('includes Buffer Authorization: Bearer header on every request', async () => {
    let capturedHeaders: Headers | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          data: {
            account: {
              organizations: [{ id: 'org_1', name: 'Paper English Org' }],
            },
          },
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock;

    const client = new BufferClient();
    const orgs = await client.getOrganizations();

    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.id).toBe('org_1');
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer test_buffer_api_key_123');
    expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
  });

  it('discovers organizations and connected channels', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({
            data: {
              account: {
                organizations: [{ id: 'org_1', name: 'Paper English Org' }],
              },
            },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
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
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const client = new BufferClient();
    const channels = await client.getChannels();

    expect(channels).toHaveLength(3);
    expect(channels.map((c) => c.service)).toEqual(['facebook', 'instagram', 'threads']);
    expect(channels[0]?.organizationId).toBe('org_1');
  });

  it('auto-resolves channel ID when exactly one matching channel exists', async () => {
    const channels = [
      { id: 'ch_fb_1', name: 'Paper English FB', service: 'facebook' },
      { id: 'ch_ig_1', name: 'Paper English IG', service: 'instagram' },
    ];
    const client = new BufferClient();
    const fbId = await client.resolveChannelId('facebook', channels);
    expect(fbId).toBe('ch_fb_1');

    const igId = await client.resolveChannelId('instagram', channels);
    expect(igId).toBe('ch_ig_1');
  });

  it('fails safely when no channel matches the requested service', async () => {
    const channels = [{ id: 'ch_fb_1', name: 'Paper English FB', service: 'facebook' }];
    const client = new BufferClient();

    await expect(client.resolveChannelId('threads', channels)).rejects.toThrow(
      /No connected Buffer channel found for service "threads"/
    );
  });

  it('fails safely when multiple channels match the service without configured override', async () => {
    const channels = [
      { id: 'ch_th_1', name: 'Threads Account A', service: 'threads' },
      { id: 'ch_th_2', name: 'Threads Account B', service: 'threads' },
    ];
    const client = new BufferClient();

    await expect(client.resolveChannelId('threads', channels)).rejects.toThrow(
      /Multiple connected Buffer channels found for service "threads"/
    );
  });

  it('honors explicitly configured channel ID override even when multiple channels exist', async () => {
    process.env.BUFFER_THREADS_CHANNEL_ID = 'ch_th_2';
    const channels = [
      { id: 'ch_th_1', name: 'Threads Account A', service: 'threads' },
      { id: 'ch_th_2', name: 'Threads Account B', service: 'threads' },
    ];
    const client = new BufferClient();
    const resolved = await client.resolveChannelId('threads', channels);
    expect(resolved).toBe('ch_th_2');
  });

  it('publishes Facebook text post via Buffer GraphQL createPost with mode: shareNow', async () => {
    let createPostInput: any;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({
            data: { account: { organizations: [{ id: 'org_1', name: 'Paper English' }] } },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
        return new Response(
          JSON.stringify({
            data: { channels: [{ id: 'ch_fb_1', name: 'Paper English FB', service: 'facebook' }] },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('CreatePost')) {
        createPostInput = body.variables.input;
        return new Response(
          JSON.stringify({
            data: {
              createPost: {
                post: {
                  id: 'buf_post_100',
                  status: 'sent',
                  dueAt: '2026-08-31T12:00:00Z',
                  sentAt: '2026-08-31T12:00:01Z',
                  sharedNow: true,
                  externalLink: 'https://www.facebook.com/paperenglish/posts/100',
                  channelId: 'ch_fb_1',
                  channelService: 'facebook',
                  text: mockPost.copyText,
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

    const fbPost: PreparedPost = { ...mockPost, mediaUrl: null };
    const publisher = new BufferPublisher('facebook');
    const result = await publisher.publish(fbPost);

    expect(result.platformPostId).toBe('buf_post_100');
    expect(result.platformPostUrl).toBe('https://www.facebook.com/paperenglish/posts/100');
    expect(createPostInput.channelId).toBe('ch_fb_1');
    expect(createPostInput.text).toBe(fbPost.copyText);
    expect(createPostInput.mode).toBe('shareNow');
    expect(createPostInput.schedulingType).toBe('automatic');
    expect(createPostInput.assets).toBeUndefined();
  });

  it('publishes Threads text post via Buffer GraphQL createPost with mode: shareNow', async () => {
    let createPostInput: any;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({
            data: { account: { organizations: [{ id: 'org_1', name: 'Paper English' }] } },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
        return new Response(
          JSON.stringify({
            data: { channels: [{ id: 'ch_th_1', name: 'Paper English Threads', service: 'threads' }] },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('CreatePost')) {
        createPostInput = body.variables.input;
        return new Response(
          JSON.stringify({
            data: {
              createPost: {
                post: {
                  id: 'buf_post_200',
                  status: 'sent',
                  dueAt: '2026-08-31T12:00:00Z',
                  sentAt: '2026-08-31T12:00:01Z',
                  sharedNow: true,
                  externalLink: 'https://www.threads.net/@paperenglish/post/200',
                  channelId: 'ch_th_1',
                  channelService: 'threads',
                  text: 'Threads thought leadership copy',
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

    const thPost: PreparedPost = {
      ...mockPost,
      platform: 'threads',
      copyText: 'Threads thought leadership copy',
      destinationUrl: attributedUrl('https://paperbond.jjmowlab.com', 'threads', 'always-on', 'post_1'),
      mediaUrl: null,
    };
    const publisher = new BufferPublisher('threads');
    const result = await publisher.publish(thPost);

    expect(result.platformPostId).toBe('buf_post_200');
    expect(result.platformPostUrl).toBe('https://www.threads.net/@paperenglish/post/200');
    expect(createPostInput.channelId).toBe('ch_th_1');
    expect(createPostInput.mode).toBe('shareNow');
    expect(createPostInput.assets).toBeUndefined();
  });

  it('publishes Instagram image post via Buffer with public media URL in assets', async () => {
    let createPostInput: any;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({
            data: { account: { organizations: [{ id: 'org_1', name: 'Paper English' }] } },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
        return new Response(
          JSON.stringify({
            data: { channels: [{ id: 'ch_ig_1', name: 'Paper English IG', service: 'instagram' }] },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('CreatePost')) {
        createPostInput = body.variables.input;
        return new Response(
          JSON.stringify({
            data: {
              createPost: {
                post: {
                  id: 'buf_post_300',
                  status: 'sent',
                  dueAt: '2026-08-31T12:00:00Z',
                  sentAt: '2026-08-31T12:00:01Z',
                  sharedNow: true,
                  externalLink: 'https://www.instagram.com/p/300/',
                  channelId: 'ch_ig_1',
                  channelService: 'instagram',
                  text: mockPost.copyText,
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

    const igPost: PreparedPost = {
      ...mockPost,
      platform: 'instagram',
      destinationUrl: attributedUrl('https://paperbond.jjmowlab.com', 'instagram', 'always-on', 'post_1'),
      mediaUrl: 'https://supabase.co/storage/v1/object/public/marketing-media/manual/sample.png',
    };
    const publisher = new BufferPublisher('instagram');
    const result = await publisher.publish(igPost);

    expect(result.platformPostId).toBe('buf_post_300');
    expect(result.platformPostUrl).toBe('https://www.instagram.com/p/300/');
    expect(createPostInput.channelId).toBe('ch_ig_1');
    expect(createPostInput.assets).toEqual([
      { image: { url: 'https://supabase.co/storage/v1/object/public/marketing-media/manual/sample.png' } },
    ]);
  });

  it('rejects Instagram post when valid media URL is missing', async () => {
    const igPost: PreparedPost = {
      ...mockPost,
      platform: 'instagram',
      mediaUrl: null,
    };
    const publisher = new BufferPublisher('instagram');
    await expect(publisher.publish(igPost)).rejects.toThrow(/instagram requires media/);
  });

  it('handles GraphQL MutationError union cleanly and classifies as permanent error', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({
            data: { account: { organizations: [{ id: 'org_1', name: 'Paper English' }] } },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
        return new Response(
          JSON.stringify({
            data: { channels: [{ id: 'ch_fb_1', name: 'Paper English FB', service: 'facebook' }] },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('CreatePost')) {
        return new Response(
          JSON.stringify({
            data: {
              createPost: {
                message: 'Channel queue limit reached for this plan',
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const publisher = new BufferPublisher('facebook');
    let thrownError: unknown;
    try {
      await publisher.publish(mockPost);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(PlatformError);
    expect((thrownError as PlatformError).message).toContain('Channel queue limit reached');
    const classification = classifyError(thrownError);
    expect(classification.retryable).toBe(false);
    expect(classification.ambiguous).toBe(false);
  });

  it('handles GraphQL system errors (e.g. UNAUTHORIZED) and classifies as permanent', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: null,
          errors: [
            {
              message: 'Not authorized',
              extensions: { code: 'UNAUTHORIZED' },
            },
          ],
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock;

    const client = new BufferClient();
    let err: unknown;
    try {
      await client.getOrganizations();
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(PlatformError);
    expect((err as PlatformError).code).toBe('UNAUTHORIZED');
    const classification = classifyError(err);
    expect(classification.retryable).toBe(false);
    expect(classification.ambiguous).toBe(false);
  });

  it('handles HTTP 429 rate limits and classifies as retryable', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 });
    });
    globalThis.fetch = fetchMock;

    const client = new BufferClient();
    let err: unknown;
    try {
      await client.getOrganizations();
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(PlatformError);
    expect((err as PlatformError).status).toBe(429);
    const classification = classifyError(err);
    expect(classification.retryable).toBe(true);
    expect(classification.ambiguous).toBe(false);
  });

  it('validates credentials non-destructively without creating posts', async () => {
    let createPostCalled = false;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.query.includes('CreatePost')) {
        createPostCalled = true;
      }
      if (body.query.includes('GetOrganizations')) {
        return new Response(
          JSON.stringify({
            data: { account: { organizations: [{ id: 'org_1', name: 'Paper English Org' }] } },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes('GetChannels')) {
        return new Response(
          JSON.stringify({
            data: {
              channels: [{ id: 'ch_fb_1', name: 'Paper English Page', service: 'facebook' }],
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    globalThis.fetch = fetchMock;

    const fbPublisher = new BufferPublisher('facebook');
    const health = await fbPublisher.validateCredentials();

    expect(createPostCalled).toBe(false);
    expect(health.valid).toBe(true);
    expect(health.accountId).toBe('ch_fb_1');
    expect(health.diagnostic).toContain('Paper English Page');
  });
});
