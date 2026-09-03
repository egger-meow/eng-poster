import { describe, expect, it, vi } from 'vitest';
import { MarketingRepository } from '../src/db/repository.js';

describe('MarketingRepository - Winner Feedback API', () => {
  function createMockDb(initialState: {
    feedback?: any[];
    posts?: any[];
    plans?: any[];
    assets?: any[];
  } = {}) {
    const feedbackRows = [...(initialState.feedback ?? [])];
    const postRows = [...(initialState.posts ?? [])];
    const planRows = [...(initialState.plans ?? [])];
    const assetRows = [...(initialState.assets ?? [])];

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'marketing_post_feedback') {
          return {
            select: vi.fn((_cols: string) => {
              const chain: any = {
                eq: vi.fn((col: string, val: any) => {
                  chain._filtered = (chain._filtered ?? feedbackRows).filter((r: any) => r[col] === val);
                  return chain;
                }),
                in: vi.fn((col: string, vals: any[]) => {
                  chain._filtered = (chain._filtered ?? feedbackRows).filter((r: any) => vals.includes(r[col]));
                  return chain;
                }),
                order: vi.fn((col: string, { ascending }: { ascending: boolean }) => {
                  chain._filtered = [...(chain._filtered ?? feedbackRows)].sort((a: any, b: any) => {
                    const aVal = a[col] ?? '';
                    const bVal = b[col] ?? '';
                    return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                  });
                  return chain;
                }),
                limit: vi.fn((lim: number) => {
                  chain._filtered = (chain._filtered ?? feedbackRows).slice(0, lim);
                  return chain;
                }),
                maybeSingle: vi.fn(async () => {
                  const res = (chain._filtered ?? feedbackRows)[0] ?? null;
                  return { data: res, error: null };
                }),
                then: (resolve: any) => resolve({ data: chain._filtered ?? feedbackRows, error: null }),
              };
              return chain;
            }),
            upsert: vi.fn((payload: any) => {
              const idx = feedbackRows.findIndex((r) => r.post_id === payload.post_id);
              if (idx >= 0) {
                feedbackRows[idx] = { ...feedbackRows[idx], ...payload };
              } else {
                feedbackRows.push(payload);
              }
              const row = idx >= 0 ? feedbackRows[idx] : payload;
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: row, error: null })),
                })),
              };
            }),
          };
        }

        if (table === 'marketing_posts') {
          return {
            select: vi.fn((_cols: string) => {
              const chain: any = {
                eq: vi.fn((col: string, val: any) => {
                  chain._filtered = (chain._filtered ?? postRows).filter((r: any) => r[col] === val);
                  return chain;
                }),
                in: vi.fn((col: string, vals: any[]) => {
                  chain._filtered = (chain._filtered ?? postRows).filter((r: any) => vals.includes(r[col]));
                  return chain;
                }),
                order: vi.fn((col: string, { ascending }: { ascending: boolean }) => {
                  chain._filtered = [...(chain._filtered ?? postRows)].sort((a: any, b: any) => {
                    const aVal = a[col] ?? '';
                    const bVal = b[col] ?? '';
                    return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                  });
                  return chain;
                }),
                limit: vi.fn((lim: number) => {
                  chain._filtered = (chain._filtered ?? postRows).slice(0, lim);
                  return chain;
                }),
                then: (resolve: any) => resolve({ data: chain._filtered ?? postRows, error: null }),
              };
              return chain;
            }),
          };
        }

        if (table === 'marketing_content_plans') {
          return {
            select: vi.fn((_cols: string) => ({
              in: vi.fn(async (col: string, vals: any[]) => ({
                data: planRows.filter((r) => vals.includes(r[col])),
                error: null,
              })),
            })),
          };
        }

        if (table === 'marketing_assets') {
          return {
            select: vi.fn((_cols: string) => ({
              in: vi.fn(async (col: string, vals: any[]) => ({
                data: assetRows.filter((r) => vals.includes(r[col])),
                error: null,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    return { db: db as any, feedbackRows, postRows };
  }

  describe('upsertPostFeedback', () => {
    it('marks a post as winner without any metrics', async () => {
      const { db } = createMockDb();
      const repo = new MarketingRepository(db);

      const res = await repo.upsertPostFeedback({
        postId: 'post-1',
        isWinner: true,
      });

      expect(res.postId).toBe('post-1');
      expect(res.isWinner).toBe(true);
      expect(res.observedViews).toBeNull();
      expect(res.observedLikes).toBeNull();
      expect(res.markedAt).toBeTruthy();
    });

    it('rejects negative metrics with an explicit error', async () => {
      const { db } = createMockDb();
      const repo = new MarketingRepository(db);

      await expect(
        repo.upsertPostFeedback({
          postId: 'post-1',
          isWinner: true,
          observedViews: -10,
        })
      ).rejects.toThrow('Observed metrics must be non-negative');

      await expect(
        repo.upsertPostFeedback({
          postId: 'post-1',
          isWinner: true,
          observedLikes: -1,
        })
      ).rejects.toThrow('Observed metrics must be non-negative');
    });

    it('records and updates observed metrics and operator note', async () => {
      const { db } = createMockDb({
        feedback: [
          {
            post_id: 'post-1',
            is_winner: true,
            observed_views: 500,
            observed_likes: 20,
            observed_comments: 5,
            observed_shares: 2,
            operator_note: 'Initial note',
            marked_at: '2026-09-01T10:00:00Z',
            updated_at: '2026-09-01T10:00:00Z',
          },
        ],
      });
      const repo = new MarketingRepository(db);

      const res = await repo.upsertPostFeedback({
        postId: 'post-1',
        isWinner: true,
        observedViews: 1200,
        operatorNote: 'Updated performance surge',
      });

      expect(res.isWinner).toBe(true);
      expect(res.observedViews).toBe(1200);
      expect(res.observedLikes).toBe(20); // preserved existing
      expect(res.operatorNote).toBe('Updated performance surge');
      expect(res.markedAt).toBe('2026-09-01T10:00:00Z'); // preserved original marked_at
    });

    it('allows unmarking a winner', async () => {
      const { db } = createMockDb({
        feedback: [
          {
            post_id: 'post-1',
            is_winner: true,
            observed_views: 100,
            marked_at: '2026-09-01T10:00:00Z',
            updated_at: '2026-09-01T10:00:00Z',
          },
        ],
      });
      const repo = new MarketingRepository(db);

      const res = await repo.upsertPostFeedback({
        postId: 'post-1',
        isWinner: false,
      });

      expect(res.isWinner).toBe(false);
    });
  });

  describe('getPublishedPostsWithFeedback', () => {
    it('returns published posts sorted newest first with associated feedback, plan archetype/topic, and asset concept', async () => {
      const { db } = createMockDb({
        posts: [
          {
            id: 'post-1',
            platform: 'threads',
            status: 'published',
            copy_text: '會考英文最殘忍的真相：60 分鐘...',
            asset_mode: 'text_only',
            copy_length_mode: 'short',
            published_at: '2026-09-01T12:00:00Z',
            scheduled_for: '2026-09-01T12:00:00Z',
            destination_url: 'https://paperbond.jjmowlab.com/?utm_source=threads',
            platform_post_url: 'https://threads.net/@paperenglish/post/1',
            content_plan_id: 'plan-1',
            media_asset_id: null,
          },
          {
            id: 'post-2',
            platform: 'facebook',
            status: 'published',
            copy_text: '英文閱讀的長線佈局方式...',
            asset_mode: 'image_post',
            copy_length_mode: 'long',
            published_at: '2026-09-02T12:00:00Z',
            scheduled_for: '2026-09-02T12:00:00Z',
            destination_url: 'https://paperbond.jjmowlab.com/?utm_source=facebook',
            platform_post_url: 'https://facebook.com/paperenglish/posts/2',
            content_plan_id: 'plan-2',
            media_asset_id: 'asset-1',
          },
        ],
        feedback: [
          {
            post_id: 'post-1',
            is_winner: true,
            observed_views: 881,
            observed_likes: 5,
            observed_comments: 2,
            observed_shares: 0,
            operator_note: 'Sharp hook worked',
            marked_at: '2026-09-02T00:00:00Z',
            updated_at: '2026-09-02T00:00:00Z',
          },
        ],
        plans: [
          { id: 'plan-1', archetype: 'pain_point', topic: '會考倒數' },
          { id: 'plan-2', archetype: 'educational_value', topic: '長文閱讀技巧' },
        ],
        assets: [{ id: 'asset-1', concept: 'student-reading-pdf' }],
      });

      const repo = new MarketingRepository(db);
      const posts = await repo.getPublishedPostsWithFeedback();

      expect(posts.length).toBe(2);
      // Newest published first: post-2 (Sep 2) then post-1 (Sep 1)
      expect(posts[0]!.id).toBe('post-2');
      expect(posts[0]!.archetype).toBe('educational_value');
      expect(posts[0]!.visualConcept).toBe('student-reading-pdf');
      expect(posts[0]!.feedback).toBeNull();

      expect(posts[1]!.id).toBe('post-1');
      expect(posts[1]!.archetype).toBe('pain_point');
      expect(posts[1]!.feedback?.isWinner).toBe(true);
      expect(posts[1]!.feedback?.observedViews).toBe(881);
    });

    it('filters winners only when winnersOnly: true', async () => {
      const { db } = createMockDb({
        posts: [
          {
            id: 'post-1',
            platform: 'threads',
            status: 'published',
            copy_text: 'Post 1 winner',
            asset_mode: 'text_only',
            published_at: '2026-09-01T12:00:00Z',
            scheduled_for: '2026-09-01T12:00:00Z',
          },
          {
            id: 'post-2',
            platform: 'facebook',
            status: 'published',
            copy_text: 'Post 2 regular',
            asset_mode: 'text_only',
            published_at: '2026-09-02T12:00:00Z',
            scheduled_for: '2026-09-02T12:00:00Z',
          },
        ],
        feedback: [
          {
            post_id: 'post-1',
            is_winner: true,
            observed_views: 350,
            marked_at: '2026-09-02T00:00:00Z',
            updated_at: '2026-09-02T00:00:00Z',
          },
        ],
      });

      const repo = new MarketingRepository(db);
      const winners = await repo.getPublishedPostsWithFeedback({ winnersOnly: true });

      expect(winners.length).toBe(1);
      expect(winners[0]!.id).toBe('post-1');
      expect(winners[0]!.feedback?.isWinner).toBe(true);
    });
  });

  describe('getWinnerPosts', () => {
    it('returns full winner post context for authoring analysis', async () => {
      const { db } = createMockDb({
        posts: [
          {
            id: 'post-1',
            platform: 'threads',
            status: 'published',
            copy_text: '不敢挑戰孩子英文 A++？😈\nhttps://paperbond.jjmowlab.com',
            asset_mode: 'text_only',
            copy_length_mode: 'short',
            published_at: '2026-09-01T12:00:00Z',
            scheduled_for: '2026-09-01T12:00:00Z',
            destination_url: 'https://paperbond.jjmowlab.com/?utm_source=threads',
            platform_post_url: 'https://threads.net/@paperenglish/post/1',
            content_plan_id: 'plan-1',
            media_asset_id: null,
          },
        ],
        feedback: [
          {
            post_id: 'post-1',
            is_winner: true,
            observed_views: 2400,
            observed_likes: 88,
            observed_comments: 12,
            observed_shares: 4,
            operator_note: 'Rhetorical question drove high clickthrough',
            marked_at: '2026-09-02T10:00:00Z',
            updated_at: '2026-09-02T10:00:00Z',
          },
        ],
        plans: [
          { id: 'plan-1', archetype: 'pain_point', topic: 'A++挑戰' },
        ],
      });

      const repo = new MarketingRepository(db);
      const winners = await repo.getWinnerPosts();

      expect(winners.length).toBe(1);
      const w = winners[0]!;
      expect(w.postId).toBe('post-1');
      expect(w.platform).toBe('threads');
      expect(w.copyText).toContain('不敢挑戰孩子英文 A++？😈');
      expect(w.copyPreview).toBeTruthy();
      expect(w.hasDestinationUrl).toBe(true);
      expect(w.assetMode).toBe('text_only');
      expect(w.copyLengthMode).toBe('short');
      expect(w.isWinner).toBe(true);
      expect(w.observedViews).toBe(2400);
      expect(w.observedLikes).toBe(88);
      expect(w.operatorNote).toBe('Rhetorical question drove high clickthrough');
      expect(w.topic).toBe('A++挑戰');
      expect(w.archetype).toBe('pain_point');
    });

    it('returns empty array when zero winners exist', async () => {
      const { db } = createMockDb();
      const repo = new MarketingRepository(db);

      const winners = await repo.getWinnerPosts();
      expect(winners).toEqual([]);
    });
  });
});
