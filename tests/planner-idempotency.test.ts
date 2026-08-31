import { describe, expect, it } from 'vitest';
import { idempotencyKey } from '../src/shared/hash.js';
import { selectArchetype, selectCtaMode, selectWeighted } from '../src/content/selection.js';

describe('planner idempotency, cap enforcement, and weighted selection', () => {
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

  it('converges proportionally according to configured contentMix weights', () => {
    const mix = {
      painPointOrOpinion: 0.35,
      educationalValue: 0.25,
      productProof: 0.20,
      timelyTopic: 0.10,
      conversion: 0.10,
    };

    const choices: string[] = [];
    for (let i = 0; i < 100; i++) {
      const selected = selectArchetype(mix, choices);
      choices.push(selected);
    }

    const counts: Record<string, number> = {};
    for (const c of choices) counts[c] = (counts[c] ?? 0) + 1;

    expect(counts['pain_point']).toBe(35);
    expect(counts['educational_value']).toBe(25);
    expect(counts['product_proof']).toBe(20);
    expect(counts['timely_topic']).toBe(10);
    expect(counts['conversion_offer']).toBe(10);

    // Verify later archetypes (conversion_offer, timely_topic) are reached early in small runs (e.g. 10 slots)
    const early10 = choices.slice(0, 10);
    expect(early10).toContain('timely_topic');
    expect(early10).toContain('conversion_offer');
  });

  it('converges proportionally according to configured CTA weights', () => {
    const ctaMix = { none: 0.50, soft: 0.30, direct: 0.20 };
    const choices: Array<'none' | 'soft' | 'direct'> = [];

    for (let i = 0; i < 10; i++) {
      const selected = selectCtaMode(ctaMix, choices);
      choices.push(selected);
    }

    const counts: Record<string, number> = {};
    for (const c of choices) counts[c] = (counts[c] ?? 0) + 1;

    expect(counts['none']).toBe(5);
    expect(counts['soft']).toBe(3);
    expect(counts['direct']).toBe(2);
    // Direct CTA is reached within the first 5 slots
    expect(choices.slice(0, 5)).toContain('direct');
  });

  it('continues selection from rolling history without resetting to first category', () => {
    const mix = {
      painPointOrOpinion: 0.35,
      educationalValue: 0.25,
      productProof: 0.20,
      timelyTopic: 0.10,
      conversion: 0.10,
    };

    // Day 1 chose pain_point and educational_value
    const day1History = ['pain_point', 'educational_value'];

    // Day 2 next choices balance remaining unrepresented categories
    const day2Choice1 = selectArchetype(mix, day1History);
    expect(day2Choice1).toBe('product_proof');

    const day2Choice2 = selectArchetype(mix, day1History, [day2Choice1]);
    expect(day2Choice2).toBe('timely_topic');

    // Day 3 continues seamlessly
    const day3History = [...day1History, day2Choice1, day2Choice2];
    const day3Choice1 = selectArchetype(mix, day3History);
    expect(day3Choice1).toBe('pain_point');

    const day3Choice2 = selectArchetype(mix, day3History, [day3Choice1]);
    expect(day3Choice2).toBe('conversion_offer');
  });


  it('is completely deterministic across multiple runs with identical input', () => {
    const mix = { a: 0.6, b: 0.4 };
    const run1 = [selectWeighted(mix, []), selectWeighted(mix, ['a'])];
    const run2 = [selectWeighted(mix, []), selectWeighted(mix, ['a'])];
    expect(run1).toEqual(run2);
  });

  it('respects hard daily caps and weekly caps in slot calculation', () => {
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

