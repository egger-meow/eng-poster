import { describe, expect, it } from 'vitest';
import { checkQueueHealth } from '../src/orchestration/queue-health.js';
import type { MarketingRepository } from '../src/db/repository.js';

describe('queue health inspection', () => {
  it('reports healthy status when upcoming posts are queued', async () => {
    const mockRepo = {
      countPostsForDateRange: async () => 2,
      getNextScheduledPost: async () => '2026-09-01T12:00:00+08:00',
    } as unknown as MarketingRepository;

    const report = await checkQueueHealth(48, mockRepo);
    expect(report.healthy).toBe(true);
    expect(report.totalUpcoming).toBe(6); // 2 * 3 platforms
    expect(report.nextScheduledPostAt).toBe('2026-09-01T12:00:00+08:00');
    expect(report.message).toContain('Queue healthy');
  });

  it('reports empty status when zero upcoming posts exist', async () => {
    const mockRepo = {
      countPostsForDateRange: async () => 0,
      getNextScheduledPost: async () => null,
    } as unknown as MarketingRepository;

    const report = await checkQueueHealth(48, mockRepo);
    expect(report.healthy).toBe(false);
    expect(report.totalUpcoming).toBe(0);
    expect(report.nextScheduledPostAt).toBeNull();
    expect(report.message).toContain('Queue empty');
  });
});


