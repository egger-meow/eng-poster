import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { startWinnerDashboard } from '../src/dashboard/server.js';
import type { MarketingRepository } from '../src/db/repository.js';

describe('Local Winner Dashboard Server', () => {
  let server: http.Server;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  const mockPosts: any[] = [
    {
      id: 'post-101',
      platform: 'threads',
      assetMode: 'text_only',
      copyLengthMode: 'short',
      copyText: '會考英文最殘忍的真相：60 分鐘...',
      destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=threads',
      publishedAt: '2026-09-02T12:00:00Z',
      scheduledFor: '2026-09-02T12:00:00Z',
      platformPostUrl: 'https://threads.net/@paperenglish/post/101',
      archetype: 'pain_point',
      topic: '會考倒數',
      visualConcept: null,
      feedback: null,
    },
    {
      id: 'post-102',
      platform: 'facebook',
      assetMode: 'image_post',
      copyLengthMode: 'long',
      copyText: '英文閱讀的長線佈局方式...',
      destinationUrl: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
      publishedAt: '2026-09-01T12:00:00Z',
      scheduledFor: '2026-09-01T12:00:00Z',
      platformPostUrl: 'https://facebook.com/paperenglish/posts/102',
      archetype: 'educational_value',
      topic: '長文閱讀技巧',
      visualConcept: 'student-reading-pdf',
      feedback: {
        postId: 'post-102',
        isWinner: true,
        observedViews: 3500,
        observedLikes: 120,
        observedComments: 14,
        observedShares: 8,
        operatorNote: 'Great engagement from parents',
        markedAt: '2026-09-01T14:00:00Z',
        updatedAt: '2026-09-01T14:00:00Z',
      },
    },
  ];

  const mockRepo = {
    getPublishedPostsWithFeedback: vi.fn(async (opts?: any) => {
      let filtered = [...mockPosts];
      if (opts?.platform) {
        filtered = filtered.filter((p) => p.platform === opts.platform);
      }
      if (opts?.winnersOnly) {
        filtered = filtered.filter((p) => p.feedback?.isWinner);
      }
      return filtered;
    }),
    upsertPostFeedback: vi.fn(async (input: any) => {
      if (
        (input.observedViews !== undefined && input.observedViews !== null && input.observedViews < 0) ||
        (input.observedLikes !== undefined && input.observedLikes !== null && input.observedLikes < 0)
      ) {
        throw new Error('Observed metrics must be non-negative');
      }
      const record = {
        postId: input.postId,
        isWinner: input.isWinner,
        observedViews: input.observedViews ?? null,
        observedLikes: input.observedLikes ?? null,
        observedComments: input.observedComments ?? null,
        observedShares: input.observedShares ?? null,
        operatorNote: input.operatorNote ?? null,
        markedAt: input.isWinner ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      };
      const post = mockPosts.find((p) => p.id === input.postId);
      if (post) post.feedback = record;
      return record;
    }),
  } as unknown as MarketingRepository;

  beforeAll(async () => {
    // Start on ephemeral port on 127.0.0.1
    const started = await startWinnerDashboard({
      port: 0, // OS assigns random available port
      repo: mockRepo,
    });
    server = started.server;
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    closeServer = started.close;
  });

  afterAll(async () => {
    if (closeServer) await closeServer();
  });

  describe('Security & Loopback Invariants', () => {
    it('binds strictly to 127.0.0.1 and refuses external host configurations', async () => {
      const addr = server.address() as any;
      expect(addr.address).toBe('127.0.0.1');

      await expect(
        startWinnerDashboard({
          host: '0.0.0.0',
          repo: mockRepo,
        })
      ).rejects.toThrow('Winner Dashboard must bind only to 127.0.0.1');

      await expect(
        startWinnerDashboard({
          host: '192.168.1.1',
          repo: mockRepo,
        })
      ).rejects.toThrow('Winner Dashboard must bind only to 127.0.0.1');
    });
  });

  describe('GET / (HTML UI)', () => {
    it('serves lightweight HTML with winner controls and filters', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('Paper English — Winner Posts');
      expect(html).toContain('All Published');
      expect(html).toContain('Winners Only');
      expect(html).toContain('/api/posts');
      expect(html).toContain('/api/feedback');
      expect(html).toContain('Open post ↗');
    });
  });

  describe('GET /api/posts', () => {
    it('returns published posts with feedback', async () => {
      const res = await fetch(`${baseUrl}/api/posts`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data.posts)).toBe(true);
      expect(data.posts.length).toBe(2);
      expect(data.posts[0].id).toBe('post-101');
      expect(data.posts[0].copyText).toContain('會考英文最殘忍的真相');
    });

    it('supports winnersOnly and platform filters', async () => {
      const winnersRes = await fetch(`${baseUrl}/api/posts?winnersOnly=true`);
      const winnersData = await winnersRes.json();
      expect(winnersData.posts.length).toBe(1);
      expect(winnersData.posts[0].id).toBe('post-102');

      const threadsRes = await fetch(`${baseUrl}/api/posts?platform=threads`);
      const threadsData = await threadsRes.json();
      expect(threadsData.posts.length).toBe(1);
      expect(threadsData.posts[0].platform).toBe('threads');
    });
  });

  describe('POST /api/feedback', () => {
    it('saves a winner with ONLY one checkbox (no metrics required)', async () => {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: 'post-101',
          isWinner: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.feedback.isWinner).toBe(true);
      expect(data.feedback.observedViews).toBeNull();
      expect(data.feedback.markedAt).toBeTruthy();
    });

    it('saves winner with observed metrics and operator note', async () => {
      const res = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: 'post-101',
          isWinner: true,
          observedViews: 881,
          observedLikes: 5,
          observedComments: 2,
          observedShares: 0,
          operatorNote: 'Sharp opening line drove attention',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.feedback.observedViews).toBe(881);
      expect(data.feedback.observedLikes).toBe(5);
      expect(data.feedback.operatorNote).toBe('Sharp opening line drove attention');
    });

    it('rejects malformed or negative metrics with HTTP 400', async () => {
      const negRes = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: 'post-101',
          isWinner: true,
          observedViews: -5,
        }),
      });
      expect(negRes.status).toBe(400);
      const negData = await negRes.json();
      expect(negData.error).toContain('cannot be negative');

      const nonIntRes = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: 'post-101',
          isWinner: true,
          observedViews: 'invalid-number',
        }),
      });
      expect(nonIntRes.status).toBe(400);
    });

    it('rejects missing postId or isWinner with HTTP 400', async () => {
      const res1 = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isWinner: true,
        }),
      });
      expect(res1.status).toBe(400);

      const res2 = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: 'post-101',
        }),
      });
      expect(res2.status).toBe(400);
    });
  });

  describe('Non-existent routes', () => {
    it('returns 404 for unknown paths', async () => {
      const res = await fetch(`${baseUrl}/unknown-path`);
      expect(res.status).toBe(404);
    });
  });
});
