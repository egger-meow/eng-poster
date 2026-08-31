import { describe, expect, it } from 'vitest';
import { determineAssetSource } from '../src/media/ingest.js';
import type { AssetRecord } from '../src/types.js';

describe('asset usage accounting, classification, and cooldowns', () => {
  it('correctly classifies asset sources based on path conventions', () => {
    expect(determineAssetSource('assets/fallback/emergency-01.png')).toBe('fallback');
    expect(determineAssetSource('assets/manual/product/vocab-card.png')).toBe('screenshot');
    expect(determineAssetSource('assets/manual/lifestyle/sports.jpg')).toBe('manual');
    expect(determineAssetSource('assets/manual/evergreen/reading.webp')).toBe('manual');
  });

  it('filters out non-reusable assets once used', () => {
    const assets: AssetRecord[] = [
      {
        id: '1',
        source: 'manual',
        contentHash: 'h1',
        storagePath: 'p1',
        publicUrl: 'u1',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['reading'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: false,
        priority: 0,
        usageCount: 1,
        lastUsedAt: '2026-08-01T00:00:00Z',
      },
      {
        id: '2',
        source: 'manual',
        contentHash: 'h2',
        storagePath: 'p2',
        publicUrl: 'u2',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['reading'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: true,
        priority: 0,
        usageCount: 3,
        lastUsedAt: '2026-07-01T00:00:00Z',
      },
    ];

    const available = assets.filter((a) => a.reuse || a.usageCount === 0);
    expect(available).toHaveLength(1);
    expect(available[0]?.id).toBe('2');
  });

  it('sorts and prioritizes assets based on topics, concept freshness, and source rank', () => {
    const rank = { manual: 0, screenshot: 1, template: 2, ai_generated: 3, fallback: 4 };
    const recentConcepts = ['basketball_analytics'];

    const assets: AssetRecord[] = [
      {
        id: 'fallback_1',
        source: 'fallback',
        contentHash: 'f1',
        storagePath: 'p1',
        publicUrl: 'u1',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['general'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: true,
        priority: -10,
        concept: 'generic_illustration',
        usageCount: 0,
        lastUsedAt: null,
      },
      {
        id: 'manual_recent_concept',
        source: 'manual',
        contentHash: 'm1',
        storagePath: 'p2',
        publicUrl: 'u2',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['basketball', 'sports'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: true,
        priority: 0,
        concept: 'basketball_analytics',
        usageCount: 1,
        lastUsedAt: '2026-08-20T00:00:00Z',
      },
      {
        id: 'manual_fresh_concept',
        source: 'manual',
        contentHash: 'm2',
        storagePath: 'p3',
        publicUrl: 'u3',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['basketball', 'sports'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: true,
        priority: 0,
        concept: 'court_diagram',
        usageCount: 0,
        lastUsedAt: null,
      },
    ];

    const sorted = [...assets].sort((a, b) => {
      const aTopics = a.topics.filter((t) => ['basketball', 'sports'].includes(t)).length;
      const bTopics = b.topics.filter((t) => ['basketball', 'sports'].includes(t)).length;
      if (bTopics !== aTopics) return bTopics - aTopics;

      const aRecent = a.concept && recentConcepts.includes(a.concept) ? 1 : 0;
      const bRecent = b.concept && recentConcepts.includes(b.concept) ? 1 : 0;
      if (aRecent !== bRecent) return aRecent - bRecent;

      if (rank[a.source] !== rank[b.source]) return rank[a.source] - rank[b.source];
      return a.usageCount - b.usageCount;
    });

    // Fresh concept should beat recent concept
    expect(sorted[0]?.id).toBe('manual_fresh_concept');
    expect(sorted[1]?.id).toBe('manual_recent_concept');
    expect(sorted[2]?.id).toBe('fallback_1');
  });
});
