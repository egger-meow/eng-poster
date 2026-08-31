export const platforms = ['facebook', 'instagram', 'threads'] as const;
export type Platform = (typeof platforms)[number];
export type PostStatus = 'scheduled' | 'claimed' | 'published' | 'retryable_failed' | 'permanently_failed' | 'cancelled';
export type AssetSource = 'manual' | 'screenshot' | 'template' | 'ai_generated' | 'fallback';

export interface SourceRecord { url: string; title: string; retrievedAt: string; notes: string[] }
export interface ResearchSnapshot { query: string; sources: SourceRecord[]; factualNotes: string[] }
export interface Claim { text: string; kind: 'brand_fact' | 'researched_fact' | 'opinion' | 'rhetorical'; sourceUrls: string[] }
export interface PreparedPost {
  id: string; contentPlanId: string; platform: Platform; copyText: string; destinationUrl?: string | null;
  mediaUrl?: string | null; mediaAssetId?: string | null; scheduledFor: string; idempotencyKey: string;
  campaignSlug: string; claimManifest: Claim[];
}
export interface TokenHealth {
  platform: Platform;
  valid: boolean;
  accountId?: string | null;
  expiresAt?: string | null;
  grantedScopes: string[];
  diagnostic: string;
}
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
export interface PublishResult {
  platformPostId: string;
  platformPostUrl?: string | null;
  rawSummary: Record<string, unknown>;
}

export interface SocialPublisher {
  validateCredentials(): Promise<TokenHealth>;
  validatePost(post: PreparedPost): Promise<ValidationResult>;
  publish(post: PreparedPost): Promise<PublishResult>;
}
export interface AssetRecord {
  id: string; source: AssetSource; contentHash: string; storagePath: string; publicUrl: string;
  width: number; height: number; format: string; topics: string[]; audience: string[];
  allowedPlatforms: Platform[]; reuse: boolean; priority: number; concept?: string | null;
  expiresAt?: string | null; usageCount: number; lastUsedAt?: string | null;
}
