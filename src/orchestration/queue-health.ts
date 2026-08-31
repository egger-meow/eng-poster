import { DateTime } from 'luxon';
import { loadConfig } from '../config.js';
import { MarketingRepository } from '../db/repository.js';
import type { Platform } from '../types.js';

export interface QueueHealthReport {
  checkedAt: string;
  healthy: boolean;
  upcomingHours: number;
  totalUpcoming: number;
  byPlatform: Record<Platform, number>;
  nextScheduledPostAt: string | null;
  message: string;
}

export async function checkQueueHealth(
  hours = 48,
  repo = new MarketingRepository()
): Promise<QueueHealthReport> {
  const config = await loadConfig();

  const now = DateTime.now().setZone(config.timezone);

  const start = now.toISO()!;
  const end = now.plus({ hours }).toISO()!;

  const byPlatform: Record<Platform, number> = { facebook: 0, instagram: 0, threads: 0 };
  let totalUpcoming = 0;

  for (const platform of ['facebook', 'instagram', 'threads'] as Platform[]) {
    const count = await repo.countPostsForDateRange(platform, start, end);
    byPlatform[platform] = count;
    totalUpcoming += count;
  }

  const nextScheduledPostAt = await repo.getNextScheduledPost(start);
  const healthy = totalUpcoming > 0;


  return {
    checkedAt: now.toISO()!,
    healthy,
    upcomingHours: hours,
    totalUpcoming,
    byPlatform,
    nextScheduledPostAt,
    message: healthy
      ? `Queue healthy: ${totalUpcoming} posts scheduled in the next ${hours}h across enabled platforms.`
      : `Queue empty: 0 posts scheduled in the next ${hours}h. ChatGPT scheduler execution needed.`,
  };
}
