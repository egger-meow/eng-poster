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

  it('distinguishes waiting_to_submit, provider_scheduled, and stale posts', async () => {
    const mockRepo = {
      countPostsForDateRange: async () => 1,
      getNextScheduledPost: async () => '2026-09-02T12:00:00+08:00',
      getQueueHealthBreakdown: async () => ({
        waitingToSubmit: 1,
        providerScheduled: 2,
        published: 0,
        retryableFailed: 0,
        permanentlyFailed: 0,
        nextLocalScheduledPostAt: '2026-09-02T12:00:00+08:00',
        nextProviderScheduledPublishAt: '2026-09-01T20:15:00+08:00',
        staleLocalCount: 0,
        staleProviderScheduledCount: 1,
      }),
    } as unknown as MarketingRepository;

    const report = await checkQueueHealth(48, mockRepo);
    expect(report.healthy).toBe(true);
    expect(report.totalUpcoming).toBe(3);
    expect(report.waitingToSubmit).toBe(1);
    expect(report.providerScheduled).toBe(2);
    expect(report.nextLocalScheduledPostAt).toBe('2026-09-02T12:00:00+08:00');
    expect(report.nextProviderScheduledPublishAt).toBe('2026-09-01T20:15:00+08:00');
    expect(report.staleProviderScheduledCount).toBe(1);
    expect(report.message).toContain('1 waiting to submit, 2 scheduled with provider');
    expect(report.message).toContain('provider-scheduled posts awaiting reconciliation');
  });

  it('flags unhealthy when stale local posts exist', async () => {
    const mockRepo = {
      countPostsForDateRange: async () => 1,
      getNextScheduledPost: async () => '2026-09-02T12:00:00+08:00',
      getQueueHealthBreakdown: async () => ({
        waitingToSubmit: 1,
        providerScheduled: 0,
        published: 0,
        retryableFailed: 0,
        permanentlyFailed: 0,
        nextLocalScheduledPostAt: '2026-09-02T12:00:00+08:00',
        nextProviderScheduledPublishAt: null,
        staleLocalCount: 2,
        staleProviderScheduledCount: 0,
      }),
    } as unknown as MarketingRepository;

    const report = await checkQueueHealth(48, mockRepo);
    expect(report.healthy).toBe(false);
    expect(report.staleLocalCount).toBe(2);
    expect(report.message).toContain('WARNING: 2 local scheduled posts are overdue/stale');
  });

  it('defaults to 336 hours (14-day stockpile horizon)', async () => {
    const mockRepo = {
      countPostsForDateRange: async () => 1,
      getNextScheduledPost: async () => '2026-09-02T12:00:00+08:00',
    } as unknown as MarketingRepository;

    const report = await checkQueueHealth(undefined, mockRepo);
    expect(report.upcomingHours).toBe(336);
    expect(report.message).toContain('336h');
  });
});


