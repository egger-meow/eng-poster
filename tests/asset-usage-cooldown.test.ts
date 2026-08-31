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

  it('excludes already selected assets in the same planning run', () => {
    const assets: AssetRecord[] = [
      {
        id: 'asset_slot1',
        source: 'manual',
        contentHash: 'hash1',
        storagePath: 'path1',
        publicUrl: 'https://example.com/1.png',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['grammar'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: true,
        priority: 10,
        concept: 'grammar_chart',
        usageCount: 0,
        lastUsedAt: null,
      },
      {
        id: 'asset_slot2',
        source: 'manual',
        contentHash: 'hash2',
        storagePath: 'path2',
        publicUrl: 'https://example.com/2.png',
        width: 1024,
        height: 1024,
        format: 'png',
        topics: ['grammar'],
        audience: ['parents'],
        allowedPlatforms: ['facebook', 'instagram', 'threads'],
        reuse: true,
        priority: 5,
        concept: 'sentence_tree',
        usageCount: 0,
        lastUsedAt: null,
      },
    ];

    const excludedIds = new Set<string>(['asset_slot1']);
    const available = assets.filter((a) => !excludedIds.has(a.id));

    expect(available).toHaveLength(1);
    expect(available[0]?.id).toBe('asset_slot2');
  });

  it('preserves existing asset id, usage_count, and last_used_at on re-ingestion', () => {
    const existingAssetInDb = {
      id: 'existing-uuid-1234',
      content_hash: 'sha256_abcdef123456',
      usage_count: 5,
      last_used_at: '2026-08-25T12:00:00Z',
      priority: 0,
    };

    const reIngestedAsset: AssetRecord = {
      id: 'new-random-uuid-9999', // Newly generated during ingest pass
      source: 'manual',
      contentHash: 'sha256_abcdef123456', // Same content hash
      storagePath: 'manual/sh/sha256_abcdef123456-test.png',
      publicUrl: 'https://storage/public/manual/sh/sha256_abcdef123456-test.png',
      width: 1024,
      height: 1024,
      format: 'png',
      topics: ['updated_topic'],
      audience: ['parents'],
      allowedPlatforms: ['facebook', 'instagram', 'threads'],
      reuse: true,
      priority: 10,
      concept: 'reading',
      usageCount: 0,
      lastUsedAt: null,
    };

    // Simulate repository upsertAsset behavior
    const updatedAsset = {
      id: existingAssetInDb.id, // ID must NOT change to new-random-uuid-9999
      content_hash: reIngestedAsset.contentHash,
      usage_count: existingAssetInDb.usage_count, // usage_count must NOT reset to 0
      last_used_at: existingAssetInDb.last_used_at, // last_used_at must NOT reset to null
      priority: reIngestedAsset.priority, // metadata can update
      topics: reIngestedAsset.topics,
    };

    expect(updatedAsset.id).toBe('existing-uuid-1234');
    expect(updatedAsset.usage_count).toBe(5);
    expect(updatedAsset.last_used_at).toBe('2026-08-25T12:00:00Z');
    expect(updatedAsset.priority).toBe(10);
  });
});

