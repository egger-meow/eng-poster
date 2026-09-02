import { describe, expect, it } from 'vitest';
import { findNextQueueGap } from '../src/orchestration/next-queue-gap.js';
import type { MarketingRepository } from '../src/db/repository.js';
import type { AppConfig } from '../src/config.js';
import type { Platform } from '../src/types.js';

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

describe('next-queue-gap calculation', () => {
  it('identifies earliest gap on day 0 when queue is empty in the morning', async () => {
    // 2026-09-02 is Wednesday.
    // Threads: 2 posts (slots 1, 2)
    // Facebook: Wed is NOT preferred (0 posts)
    // Instagram: Wed IS preferred (slot 1)
    const mockRepo = {
      countPostsForDateRange: async () => 0,
      getExistingPostsForDate: async () => [],
    } as unknown as MarketingRepository;

    const result = await findNextQueueGap(
      { startFrom: '2026-09-02T08:00:00+08:00' },
      mockRepo,
      testConfig
    );

    expect(result.targetDate).toBe('2026-09-02');
    expect(result.queueDaysAhead).toBe(0);
    expect(result.missing).toEqual([
      { platform: 'threads', slot: 1 },
      { platform: 'threads', slot: 2 },
      { platform: 'instagram', slot: 1 },
    ]);
  });

  it('identifies remaining slots when day 0 is partially filled', async () => {
    // 2026-09-02: Threads slot 1 is already filled
    const mockRepo = {
      countPostsForDateRange: async () => 1,
      getExistingPostsForDate: async (_date: string, platform: Platform) => {
        if (platform === 'threads') {
          return [{ id: 'p1', idempotency_key: '2026-09-02:threads:1', status: 'scheduled' }];
        }
        return [];
      },
    } as unknown as MarketingRepository;

    const result = await findNextQueueGap(
      { startFrom: '2026-09-02T08:00:00+08:00' },
      mockRepo,
      testConfig
    );

    expect(result.targetDate).toBe('2026-09-02');
    expect(result.queueDaysAhead).toBe(0);
    expect(result.missing).toEqual([
      { platform: 'threads', slot: 2 },
      { platform: 'instagram', slot: 1 },
    ]);
  });

  it('advances to tomorrow when day 0 is completely filled', async () => {
    // 2026-09-02: Threads slot 1, slot 2, and Instagram slot 1 filled
    // 2026-09-03 is Thursday:
    // Threads: 2 posts (slots 1, 2)
    // Facebook: Thu IS preferred (slot 1)
    // Instagram: Thu NOT preferred
    const mockRepo = {
      countPostsForDateRange: async () => 3,
      getExistingPostsForDate: async (date: string) => {
        if (date === '2026-09-02') {
          return [
            { id: 'p1', idempotency_key: '2026-09-02:threads:1', status: 'scheduled' },
            { id: 'p2', idempotency_key: '2026-09-02:threads:2', status: 'scheduled' },
            { id: 'p3', idempotency_key: '2026-09-02:instagram:1', status: 'scheduled' },
          ];
        }
        return [];
      },
    } as unknown as MarketingRepository;

    const result = await findNextQueueGap(
      { startFrom: '2026-09-02T08:00:00+08:00' },
      mockRepo,
      testConfig
    );

    expect(result.targetDate).toBe('2026-09-03');
    expect(result.queueDaysAhead).toBe(1);
    expect(result.missing).toEqual([
      { platform: 'threads', slot: 1 },
      { platform: 'threads', slot: 2 },
      { platform: 'facebook', slot: 1 },
    ]);
  });

  it('skips expired windows on day 0 if executed late at night', async () => {
    // 2026-09-02 at 22:30: All windows for today have closed (13:30, 21:30, 22:00).
    // It should not schedule into the past for day 0; it should advance to 2026-09-03 (Thursday).
    const mockRepo = {
      countPostsForDateRange: async () => 0,
      getExistingPostsForDate: async () => [],
    } as unknown as MarketingRepository;

    const result = await findNextQueueGap(
      { startFrom: '2026-09-02T22:30:00+08:00' },
      mockRepo,
      testConfig
    );

    expect(result.targetDate).toBe('2026-09-03');
    expect(result.queueDaysAhead).toBe(1);
    expect(result.missing).toEqual([
      { platform: 'threads', slot: 1 },
      { platform: 'threads', slot: 2 },
      { platform: 'facebook', slot: 1 },
    ]);
  });

  it('respects weekly caps when checking preferred days', async () => {
    // 2026-09-05 is Saturday.
    // Facebook preferred days: tue, thu, sat, sun (cap 4/week).
    // If Facebook already has 4 posts this week, it should not appear in missing slots.
    const mockRepo = {
      countPostsForDateRange: async (platform: Platform) => {
        if (platform === 'facebook') return 4; // Already hit weekly cap 4
        return 0;
      },
      getExistingPostsForDate: async () => [],
    } as unknown as MarketingRepository;

    const result = await findNextQueueGap(
      { startFrom: '2026-09-05T08:00:00+08:00' },
      mockRepo,
      testConfig
    );

    expect(result.targetDate).toBe('2026-09-05');
    expect(result.missing).toEqual([
      { platform: 'threads', slot: 1 },
      { platform: 'threads', slot: 2 },
    ]);
    // Facebook not in missing because weeklyCap reached
    expect(result.missing.some((m) => m.platform === 'facebook')).toBe(false);
  });

  it('returns targetDate: null when 14-day horizon is fully stocked', async () => {
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
