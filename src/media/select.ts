import { DateTime } from 'luxon';
import { MarketingRepository } from '../db/repository.js';
import type { AssetRecord, Platform } from '../types.js';

export async function selectAsset(
  platform: Platform,
  topics: string[],
  exactCooldownDays: number,
  visualConceptCooldownDays = 7,
  recentConcepts: string[] = [],
  excludedAssetIds: Set<string> | string[] = []
): Promise<AssetRecord | undefined> {
  const cooldownStart = DateTime.utc().minus({ days: exactCooldownDays }).toISO()!;
  const assets = await new MarketingRepository().availableAssets(platform, cooldownStart);
  if (assets.length === 0) return undefined;

  const excluded = excludedAssetIds instanceof Set ? excludedAssetIds : new Set(excludedAssetIds);
  const conceptCooldownActive = visualConceptCooldownDays > 0;
  const filtered = assets.filter((a) => {
    if (excluded.has(a.id)) return false;
    if (!a.reuse && a.usageCount > 0) return false;
    return true;
  });
  if (filtered.length === 0) return undefined;


  const rank: Record<AssetRecord['source'], number> = {
    manual: 0,
    screenshot: 1,
    template: 2,
    ai_generated: 3,
    fallback: 4,
  };

  const sorted = [...filtered].sort((a, b) => {
    const aTopics = a.topics.filter((t) => topics.includes(t)).length;
    const bTopics = b.topics.filter((t) => topics.includes(t)).length;
    if (bTopics !== aTopics) return bTopics - aTopics;

    const aRecent = a.concept && conceptCooldownActive && recentConcepts.includes(a.concept) ? 1 : 0;
    const bRecent = b.concept && conceptCooldownActive && recentConcepts.includes(b.concept) ? 1 : 0;
    if (aRecent !== bRecent) return aRecent - bRecent;

    if (rank[a.source] !== rank[b.source]) return rank[a.source] - rank[b.source];
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.usageCount - b.usageCount;
  });

  return sorted[0];
}
