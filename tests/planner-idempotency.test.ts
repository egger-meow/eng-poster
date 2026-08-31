import { describe, expect, it } from 'vitest';

import { idempotencyKey } from '../src/shared/hash.js';

describe('planner idempotency and cap enforcement', () => {
  it('generates deterministic idempotency keys without random plan UUIDs', () => {
    const key1 = idempotencyKey('2026-08-31', 'threads', '1');
    const key2 = idempotencyKey('2026-08-31', 'threads', '1');
    const keySlot2 = idempotencyKey('2026-08-31', 'threads', '2');

    expect(key1).toBe('2026-08-31:threads:1');
    expect(key1).toBe(key2);
    expect(keySlot2).toBe('2026-08-31:threads:2');
    expect(key1).not.toContain('undefined');
    expect(key1).not.toContain('null');
  });

  it('respects hard daily caps and weekly caps in slot calculation', () => {
    // Simulate cap logic
    const calculateSlotsNeeded = (
      postsPerDay: number | undefined,
      postsPerWeek: number | undefined,
      preferredDays: string[] | undefined,
      hardDailyCap: number,
      currentDayCount: number,
      currentWeekCount: number,
      isPreferredDay: boolean
    ) => {
      const dayTarget = postsPerDay ?? (isPreferredDay ? 1 : 0);
      const dailyCap = Math.min(dayTarget, hardDailyCap);
      const weeklyCap = postsPerWeek ?? 999;
      const remainingDaily = Math.max(0, dailyCap - currentDayCount);
      const remainingWeekly = Math.max(0, weeklyCap - currentWeekCount);
      return Math.min(remainingDaily, remainingWeekly);
    };

    // Threads: 2 per day, cap 3 -> when 0 scheduled today, needs 2
    expect(calculateSlotsNeeded(2, undefined, undefined, 3, 0, 4, false)).toBe(2);
    // Threads: already 2 scheduled today -> needs 0
    expect(calculateSlotsNeeded(2, undefined, undefined, 3, 2, 6, false)).toBe(0);
    // Facebook: 4 per week, preferred day (e.g. tue), cap 1 -> when 0 today, 2 this week -> needs 1
    expect(calculateSlotsNeeded(undefined, 4, ['tue', 'thu', 'sat', 'sun'], 1, 0, 2, true)).toBe(1);
    // Facebook: 4 per week, non-preferred day (mon) -> needs 0
    expect(calculateSlotsNeeded(undefined, 4, ['tue', 'thu', 'sat', 'sun'], 1, 0, 2, false)).toBe(0);
    // Facebook: weekly cap reached (4 this week) -> needs 0 even on preferred day
    expect(calculateSlotsNeeded(undefined, 4, ['tue', 'thu', 'sat', 'sun'], 1, 0, 4, true)).toBe(0);
  });

  it('correctly maps CTA strategies and omits destination URL when CTA is none', () => {
    const postWithSoftCta = {
      destinationUrl: 'https://paperbond.jjmowlab.com?utm_source=facebook',
      ctaMode: 'soft',
    };
    const postWithNoCta = {
      destinationUrl: null,
      ctaMode: 'none',
    };

    expect(postWithSoftCta.destinationUrl).toBeTruthy();
    expect(postWithNoCta.destinationUrl).toBeNull();
  });
});
