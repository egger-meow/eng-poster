import type { OfferGate, OfferPhase } from './offer/state.js';
export const platforms = ['facebook', 'instagram', 'threads'] as const;
export type Platform = (typeof platforms)[number];

export const assetModes = ['text_only', 'image_post', 'link_preview'] as const;
export type AssetMode = (typeof assetModes)[number];

export const copyLengthModes = ['short', 'long'] as const;
export type CopyLengthMode = (typeof copyLengthModes)[number];

export const postStatuses = [
  'scheduled',
  'claimed',
  'provider_scheduled',
  'published',
  'retryable_failed',
  'permanently_failed',
  'cancelled',
] as const;
export type PostStatus = (typeof postStatuses)[number];
export type AssetSource = 'manual' | 'screenshot' | 'template' | 'ai_generated' | 'fallback';

export interface SourceRecord { url: string; title: string; retrievedAt: string; notes: string[] }
export interface ResearchSnapshot { query: string; sources: SourceRecord[]; factualNotes: string[] }
export interface Claim { text: string; kind: 'brand_fact' | 'researched_fact' | 'opinion' | 'rhetorical'; sourceUrls: string[] }

export interface PreparedPost {
  offerGate?: OfferGate | undefined;
  id: string;
  contentPlanId: string;
  platform: Platform;
  assetMode: AssetMode;
  copyLengthMode?: CopyLengthMode | undefined;
  copyText: string;
  destinationUrl?: string | null;
  mediaUrl?: string | null;
  mediaAssetId?: string | null;
  scheduledFor: string;
  idempotencyKey: string;
  campaignSlug: string;
  claimManifest: Claim[];
  ctaMode?: 'none' | 'soft' | 'direct' | undefined;
  firstCommentText?: string | null | undefined;
  allowRawUrlOnImagePost?: boolean | undefined;
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
  isScheduled?: boolean;
  providerStatus?: string;
  dueAt?: string | null;
  rawSummary: Record<string, unknown>;
}

export interface SocialPublisher {
  validateCredentials(): Promise<TokenHealth>;
  validatePost(post: PreparedPost): Promise<ValidationResult>;
  publish(post: PreparedPost): Promise<PublishResult>;
}

export interface AssetRecord {
  id: string;
  source: AssetSource;
  contentHash: string;
  storagePath: string;
  publicUrl: string;
  width: number;
  height: number;
  format: string;
  topics: string[];
  audience: string[];
  allowedPlatforms: Platform[];
  reuse: boolean;
  priority: number;
  concept?: string | null;
  expiresAt?: string | null;
  usageCount: number;
  lastUsedAt?: string | null;
}

export interface PostFeedbackRecord {
  postId: string;
  isWinner: boolean;
  observedViews: number | null;
  observedLikes: number | null;
  observedComments: number | null;
  observedShares: number | null;
  operatorNote: string | null;
  markedAt: string | null;
  updatedAt: string;
}

export interface PublishedPostWithFeedback {
  offerPhase?: OfferPhase | null;
  id: string;
  platform: Platform;
  assetMode: AssetMode;
  copyLengthMode: CopyLengthMode;
  copyText: string;
  destinationUrl: string | null;
  publishedAt: string | null;
  scheduledFor: string;
  platformPostUrl: string | null;
  contentPlanId: string | null;
  mediaAssetId: string | null;
  archetype: string | null;
  topic: string | null;
  visualConcept: string | null;
  feedback: PostFeedbackRecord | null;
}

export interface WinnerPostContext {
  offerPhase?: OfferPhase | null;
  offerDependent?: boolean;
  postId: string;
  platform: Platform;
  copyText: string;
  copyPreview: string;
  assetMode: AssetMode;
  copyLengthMode: CopyLengthMode;
  hasDestinationUrl: boolean;
  destinationUrl: string | null;
  publishedAt: string | null;
  platformPostUrl: string | null;
  archetype: string | null;
  topic: string | null;
  visualConcept: string | null;
  isWinner: boolean;
  observedViews: number | null;
  observedLikes: number | null;
  observedComments: number | null;
  observedShares: number | null;
  operatorNote: string | null;
  markedAt: string | null;
  updatedAt: string;
}

export interface WinningSignal {
  sourceOfferPhase?: OfferPhase | null;
  offerDependent?: boolean;
  signal: string;
  evidencePostIds: string[];
  confidence: 'high' | 'medium' | 'low';
  notes?: string | undefined;
}
