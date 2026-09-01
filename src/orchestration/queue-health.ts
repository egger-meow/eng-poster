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
  waitingToSubmit: number;
  providerScheduled: number;
  published: number;
  retryableFailed: number;
  permanentlyFailed: number;
  nextScheduledPostAt: string | null;
  nextLocalScheduledPostAt: string | null;
  nextProviderScheduledPublishAt: string | null;
  staleLocalCount: number;
  staleProviderScheduledCount: number;
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

  let breakdown = {
    waitingToSubmit: 0,
    providerScheduled: 0,
    published: 0,
    retryableFailed: 0,
    permanentlyFailed: 0,
    nextLocalScheduledPostAt: nextScheduledPostAt,
    nextProviderScheduledPublishAt: null as string | null,
    staleLocalCount: 0,
    staleProviderScheduledCount: 0,
  };

  if (typeof repo.getQueueHealthBreakdown === 'function') {
    breakdown = await repo.getQueueHealthBreakdown(start, end);
  }

  const healthy = totalUpcoming > 0 && breakdown.staleLocalCount === 0 && breakdown.permanentlyFailed === 0;

  const messages: string[] = [];
  if (totalUpcoming > 0) {
    messages.push(
      `Queue healthy: ${totalUpcoming} posts in next ${hours}h (${breakdown.waitingToSubmit} waiting to submit, ${breakdown.providerScheduled} scheduled with provider).`
    );
  } else {
    messages.push(`Queue empty: 0 posts scheduled in the next ${hours}h. ChatGPT scheduler execution needed.`);
  }

  if (breakdown.staleLocalCount > 0) {
    messages.push(`WARNING: ${breakdown.staleLocalCount} local scheduled posts are overdue/stale.`);
  }
  if (breakdown.staleProviderScheduledCount > 0) {
    messages.push(`NOTE: ${breakdown.staleProviderScheduledCount} provider-scheduled posts awaiting reconciliation.`);
  }
  if (breakdown.permanentlyFailed > 0) {
    messages.push(`ALERT: ${breakdown.permanentlyFailed} permanently failed posts.`);
  }

  return {
    checkedAt: now.toISO()!,
    healthy,
    upcomingHours: hours,
    totalUpcoming,
    byPlatform,
    waitingToSubmit: breakdown.waitingToSubmit,
    providerScheduled: breakdown.providerScheduled,
    published: breakdown.published,
    retryableFailed: breakdown.retryableFailed,
    permanentlyFailed: breakdown.permanentlyFailed,
    nextScheduledPostAt,
    nextLocalScheduledPostAt: breakdown.nextLocalScheduledPostAt,
    nextProviderScheduledPublishAt: breakdown.nextProviderScheduledPublishAt,
    staleLocalCount: breakdown.staleLocalCount,
    staleProviderScheduledCount: breakdown.staleProviderScheduledCount,
    message: messages.join(' '),
  };
}
