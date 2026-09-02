import { DateTime } from 'luxon';
import { loadConfig, type AppConfig } from '../config.js';
import { MarketingRepository } from '../db/repository.js';
import type { Platform } from '../types.js';

export interface MissingSlot {
  platform: Platform;
  slot: number;
}

export interface NextQueueGapResult {
  targetDate: string | null;
  missing: MissingSlot[];
  queueDaysAhead: number;
  message?: string;
}

export interface NextQueueGapOptions {
  horizonDays?: number;
  startFrom?: string | DateTime;
}

export const PLATFORM_ORDER: Platform[] = ['threads', 'facebook', 'instagram'];

export async function findNextQueueGap(
  options: NextQueueGapOptions = {},
  repo = new MarketingRepository(),
  configOverride?: AppConfig
): Promise<NextQueueGapResult> {
  const config = configOverride ?? (await loadConfig());
  const horizonDays = options.horizonDays ?? 14;

  let baseNow: DateTime;
  if (options.startFrom) {
    if (typeof options.startFrom === 'string') {
      baseNow = DateTime.fromISO(options.startFrom, { zone: config.timezone });
    } else {
      baseNow = options.startFrom.setZone(config.timezone);
    }
  } else {
    baseNow = DateTime.now().setZone(config.timezone);
  }

  if (!baseNow.isValid) {
    throw new Error(`Invalid startFrom date: ${options.startFrom}`);
  }

  const todayDateStr = baseNow.toISODate()!;

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
    const candidateDt = baseNow.plus({ days: dayOffset });
    const dateStr = candidateDt.toISODate()!;
    const weekday = candidateDt.toFormat('ccc').toLowerCase().slice(0, 3);
    const startOfWeek = candidateDt.startOf('week').toISO()!;
    const endOfWeek = candidateDt.endOf('week').toISO()!;

    const missingSlotsForDay: MissingSlot[] = [];

    for (const platform of PLATFORM_ORDER) {
      const platformCfg = config.platforms[platform];
      if (!platformCfg || !platformCfg.enabled) continue;

      const dayTarget =
        platformCfg.postsPerDay ??
        (platformCfg.preferredDays?.includes(weekday) ? 1 : 0);
      const dailyCap = Math.min(dayTarget, platformCfg.hardDailyCap);
      if (dailyCap <= 0) continue;

      // Check weekly cap
      const weeklyCap = platformCfg.postsPerWeek ?? 999;
      const currentWeekCount = await repo.countPostsForDateRange(platform, startOfWeek, endOfWeek);

      // Existing posts for this platform on candidate date
      const existingDayPosts = await repo.getExistingPostsForDate(dateStr, platform);

      // Identify occupied slots from idempotency keys or counts
      const occupiedSlots = new Set<number>();
      for (const p of existingDayPosts) {
        const parts = p.idempotency_key.split(':');
        const slotNum = Number(parts[parts.length - 1]);
        if (!Number.isNaN(slotNum) && slotNum >= 1) {
          occupiedSlots.add(slotNum);
        }
      }
      if (occupiedSlots.size < existingDayPosts.length) {
        for (let i = 1; i <= existingDayPosts.length; i++) {
          occupiedSlots.add(i);
        }
      }

      // Check each expected slot 1..dailyCap
      let remainingWeeklyQuota = Math.max(0, weeklyCap - currentWeekCount);

      for (let slot = 1; slot <= dailyCap; slot++) {
        if (occupiedSlots.has(slot)) {
          // Already filled
          continue;
        }

        // If checking today (dayOffset === 0), verify window hasn't already expired
        if (dateStr === todayDateStr) {
          const windowStr = platformCfg.windows[(slot - 1) % platformCfg.windows.length];
          if (windowStr) {
            const [, end] = windowStr.split('-');
            if (end) {
              const [endHour, endMinute] = end.split(':').map(Number);
              const windowEndTime = candidateDt.set({
                hour: endHour,
                minute: endMinute,
                second: 0,
                millisecond: 0,
              });
              if (baseNow >= windowEndTime) {
                // Window has already ended for today, slot is expired and cannot be scheduled
                continue;
              }
            }
          }
        }

        // Must respect remaining weekly quota
        if (remainingWeeklyQuota > 0) {
          missingSlotsForDay.push({ platform, slot });
          remainingWeeklyQuota--;
        }
      }
    }

    if (missingSlotsForDay.length > 0) {
      return {
        targetDate: dateStr,
        missing: missingSlotsForDay,
        queueDaysAhead: dayOffset,
      };
    }
  }

  return {
    targetDate: null,
    missing: [],
    queueDaysAhead: horizonDays,
    message: `Queue fully stocked across ${horizonDays}-day horizon`,
  };
}
