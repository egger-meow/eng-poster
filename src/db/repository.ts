import { DateTime } from 'luxon';
import type {
  AssetRecord,
  CopyLengthMode,
  Platform,
  PostFeedbackRecord,
  PreparedPost,
  PublishedPostWithFeedback,
  ResearchSnapshot,
  TokenHealth,
  WinnerPostContext,
} from '../types.js';
import { classifyCopyLengthMode } from '../content/ranges.js';
import { getSupabase } from './client.js';


function checked<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export class MarketingRepository {
  constructor(private readonly db = getSupabase()) {}

  async createPlan(input: {
    planDate: string;
    archetype: string;
    topic: string;
    audience: string;
    campaignSlug: string;
    research: ResearchSnapshot;
    provenance: Record<string, unknown>;
  }): Promise<string> {
    const { data, error } = await this.db
      .from('marketing_content_plans')
      .insert({
        plan_date: input.planDate,
        archetype: input.archetype,
        topic: input.topic,
        audience: input.audience,
        campaign_slug: input.campaignSlug,
        research_snapshot: input.research,
        provenance: input.provenance,
      })
      .select('id')
      .single();
    return checked(data, error).id as string;
  }

  async findPlan(planDate: string, archetype: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('marketing_content_plans')
      .select('id')
      .eq('plan_date', planDate)
      .eq('archetype', archetype)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }

  async schedule(post: PreparedPost, contentHash: string): Promise<void> {
    const payload: Record<string, unknown> = {
      id: post.id,
      content_plan_id: post.contentPlanId,
      platform: post.platform,
      asset_mode: post.assetMode,
      copy_text: post.copyText,
      destination_url: post.destinationUrl,
      media_asset_id: post.mediaAssetId,
      scheduled_for: post.scheduledFor,
      idempotency_key: post.idempotencyKey,
      content_hash: contentHash,
      claim_manifest: post.claimManifest,
    };
    if (post.copyLengthMode) {
      payload.copy_length_mode = post.copyLengthMode;
    }

    const { error } = await this.db.from('marketing_posts').upsert(
      payload,
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    );
    if (
      error &&
      (error.code === 'PGRST204' ||
        error.message?.includes('copy_length_mode') ||
        error.message?.includes('does not exist'))
    ) {
      delete payload.copy_length_mode;
      const { error: retryErr } = await this.db.from('marketing_posts').upsert(
        payload,
        { onConflict: 'idempotency_key', ignoreDuplicates: true }
      );
      checked(true, retryErr);
      return;
    }
    checked(true, error);
  }

  async claimDue(
    limit: number,
    leaseMinutes: number,
    platforms?: Platform[],
    lookaheadHours = 24
  ): Promise<any[]> {
    const { data, error } = await this.db.rpc('claim_marketing_posts', {
      p_limit: limit,
      p_lease_minutes: leaseMinutes,
      p_platforms: platforms && platforms.length > 0 ? platforms : null,
      p_lookahead_hours: lookaheadHours,
    });

    if (
      error &&
      (error.code === 'PGRST202' ||
        error.message?.includes('p_lookahead_hours') ||
        error.message?.includes('does not exist'))
    ) {
      console.warn(
        'claim_marketing_posts 4-arg RPC not found on Supabase; falling back to 3-arg legacy signature (migration pending)'
      );
      const { data: fallbackData, error: fallbackError } = await this.db.rpc('claim_marketing_posts', {
        p_limit: limit,
        p_lease_minutes: leaseMinutes,
        p_platforms: platforms && platforms.length > 0 ? platforms : null,
      });
      return checked(fallbackData, fallbackError) ?? [];
    }

    return checked(data, error) ?? [];
  }

  async releaseClaim(postId: string): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        status: 'scheduled',
        lease_token: null,
        lease_expires_at: null,
      })
      .eq('id', postId)
      .eq('status', 'claimed');
    checked(true, error);
  }

  async markProviderScheduled(
    postId: string,
    result: {
      platformPostId: string;
      platformPostUrl?: string | null | undefined;
      providerStatus?: string | null | undefined;
    }
  ): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        status: 'provider_scheduled',
        platform_post_id: result.platformPostId,
        platform_post_url: result.platformPostUrl ?? null,
        provider_scheduled_at: new Date().toISOString(),
        provider_status: result.providerStatus ?? 'scheduled',
        lease_token: null,
        lease_expires_at: null,
        last_error: null,
      })
      .eq('id', postId)
      .eq('status', 'claimed');
    checked(true, error);
  }

  async getProviderScheduledPosts(beforeIso: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('marketing_posts')
      .select('*')
      .eq('status', 'provider_scheduled')
      .lte('scheduled_for', beforeIso)
      .order('scheduled_for', { ascending: true });
    return checked(data, error) ?? [];
  }

  async reconcilePublished(
    postId: string,
    result: {
      platformPostId: string;
      platformPostUrl?: string | null | undefined;
      sentAt?: string | null | undefined;
      providerStatus?: string | null | undefined;
    },
    mediaAssetId?: string | null | undefined
  ): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        status: 'published',
        platform_post_id: result.platformPostId,
        platform_post_url: result.platformPostUrl ?? null,
        provider_status: result.providerStatus ?? 'sent',
        published_at: result.sentAt ?? new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_error: null,
      })
      .eq('id', postId)
      .in('status', ['provider_scheduled', 'claimed']);
    checked(true, error);

    if (mediaAssetId) {
      await this.recordAssetUsage(mediaAssetId);
    }
  }

  async reconcileFailed(
    postId: string,
    retryable: boolean,
    message: string
  ): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        status: retryable ? 'retryable_failed' : 'permanently_failed',
        provider_status: 'failed',
        last_error: message.slice(0, 1000),
        lease_token: null,
        lease_expires_at: null,
      })
      .eq('id', postId)
      .eq('status', 'provider_scheduled');
    checked(true, error);
  }

  async updateProviderStatus(postId: string, providerStatus: string): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        provider_status: providerStatus,
      })
      .eq('id', postId)
      .eq('status', 'provider_scheduled');
    checked(true, error);
  }

  async complete(
    postId: string,
    result: { platformPostId: string; platformPostUrl?: string | null | undefined },
    mediaAssetId?: string | null | undefined
  ): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        status: 'published',
        platform_post_id: result.platformPostId,
        platform_post_url: result.platformPostUrl ?? null,
        provider_status: 'sent',
        published_at: new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_error: null,
      })
      .eq('id', postId)
      .eq('status', 'claimed');
    checked(true, error);

    if (mediaAssetId) {
      await this.recordAssetUsage(mediaAssetId);
    }
  }

  async recordAssetUsage(assetId: string): Promise<void> {
    const { data: asset, error: fetchErr } = await this.db
      .from('marketing_assets')
      .select('usage_count')
      .eq('id', assetId)
      .maybeSingle();
    if (fetchErr || !asset) return;

    const { error } = await this.db
      .from('marketing_assets')
      .update({
        usage_count: (asset.usage_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', assetId);
    checked(true, error);
  }

  async fail(postId: string, retryable: boolean, message: string): Promise<void> {
    const { error } = await this.db
      .from('marketing_posts')
      .update({
        status: retryable ? 'retryable_failed' : 'permanently_failed',
        last_error: message.slice(0, 1000),
        lease_token: null,
      })
      .eq('id', postId)
      .eq('status', 'claimed');
    checked(true, error);
  }

  async recordAttempt(row: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from('marketing_publish_attempts').insert(row);
    checked(true, error);
  }

  async recordHealth(health: TokenHealth): Promise<void> {
    const { error } = await this.db.from('marketing_token_health').insert({
      platform: health.platform,
      valid: health.valid,
      expiry_timestamp: health.expiresAt ?? null,
      granted_scopes: health.grantedScopes,
      diagnostic_message: health.diagnostic,
    });
    checked(true, error);
  }

  async upsertAsset(asset: AssetRecord): Promise<void> {
    const { data: existing } = await this.db
      .from('marketing_assets')
      .select('id, usage_count, last_used_at')
      .eq('content_hash', asset.contentHash)
      .maybeSingle();

    if (existing) {
      const { error } = await this.db
        .from('marketing_assets')
        .update({
          source: asset.source,
          storage_path: asset.storagePath,
          public_url: asset.publicUrl,
          width: asset.width,
          height: asset.height,
          format: asset.format,
          topics: asset.topics,
          audience: asset.audience,
          allowed_platforms: asset.allowedPlatforms,
          reuse: asset.reuse,
          priority: asset.priority,
          concept: asset.concept ?? null,
          expires_at: asset.expiresAt ?? null,
        })
        .eq('id', existing.id);
      checked(true, error);
      return;
    }

    const { error } = await this.db.from('marketing_assets').insert({
      id: asset.id,
      source: asset.source,
      content_hash: asset.contentHash,
      storage_path: asset.storagePath,
      public_url: asset.publicUrl,
      width: asset.width,
      height: asset.height,
      format: asset.format,
      topics: asset.topics,
      audience: asset.audience,
      allowed_platforms: asset.allowedPlatforms,
      reuse: asset.reuse,
      priority: asset.priority,
      concept: asset.concept ?? null,
      expires_at: asset.expiresAt ?? null,
      usage_count: asset.usageCount ?? 0,
      last_used_at: asset.lastUsedAt ?? null,
    });
    checked(true, error);
  }

  async getRecentArchetypes(beforeDate: string, days = 30): Promise<string[]> {
    const startDate = DateTime.fromISO(beforeDate).minus({ days }).toISODate()!;
    const { data, error } = await this.db
      .from('marketing_content_plans')
      .select('archetype')
      .lt('plan_date', beforeDate)
      .gte('plan_date', startDate)
      .order('plan_date', { ascending: true })
      .order('created_at', { ascending: true });

    const raw = checked(data, error) ?? [];
    return raw.map((r: any) => r.archetype).filter(Boolean);
  }

  async getRecentCtaModes(beforeDate: string, days = 30): Promise<Array<'none' | 'soft' | 'direct'>> {
    const startDate = DateTime.fromISO(beforeDate).minus({ days }).toISODate()!;
    const { data, error } = await this.db
      .from('marketing_content_plans')
      .select('provenance')
      .lt('plan_date', beforeDate)
      .gte('plan_date', startDate)
      .order('plan_date', { ascending: true })
      .order('created_at', { ascending: true });

    const raw = checked(data, error) ?? [];
    const modes: Array<'none' | 'soft' | 'direct'> = [];
    for (const r of raw) {
      const mode = r.provenance?.ctaMode;
      if (mode === 'none' || mode === 'soft' || mode === 'direct') {
        modes.push(mode);
      }
    }
    return modes;
  }

  async getRecentVisualConcepts(beforeDate: string, days = 7): Promise<string[]> {
    const startDate = DateTime.fromISO(beforeDate).minus({ days }).toISO()!;
    const { data: posts, error: postErr } = await this.db
      .from('marketing_posts')
      .select('media_asset_id')
      .lt('scheduled_for', beforeDate)
      .gte('scheduled_for', startDate)
      .not('media_asset_id', 'is', null);

    const postRows = checked(posts, postErr) ?? [];
    const assetIds = postRows.map((p: any) => p.media_asset_id).filter(Boolean);
    if (assetIds.length === 0) return [];

    const { data: assets, error: assetErr } = await this.db
      .from('marketing_assets')
      .select('concept')
      .in('id', assetIds)
      .not('concept', 'is', null);

    const assetRows = checked(assets, assetErr) ?? [];
    return assetRows.map((a: any) => a.concept).filter(Boolean);
  }

  async getRecentCopyLengthModes(
    platform?: Platform,
    limit = 20
  ): Promise<CopyLengthMode[]> {
    let query = this.db
      .from('marketing_posts')
      .select('copy_text, platform, scheduled_for, status')
      .in('status', ['scheduled', 'claimed', 'provider_scheduled', 'published'])
      .order('scheduled_for', { ascending: false })
      .limit(limit);

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;
    const rows = checked(data, error) ?? [];

    return rows.map((r: any) => classifyCopyLengthMode(r.copy_text, r.platform));
  }

  async getNextScheduledPost(fromIso: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('marketing_posts')
      .select('scheduled_for')
      .in('status', ['scheduled', 'claimed'])
      .gte('scheduled_for', fromIso)
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();

    const row = checked(data, error);
    return row?.scheduled_for ?? null;
  }



  async availableAssets(
    platform: Platform,
    cooldownStart: string
  ): Promise<AssetRecord[]> {
    const { data, error } = await this.db
      .from('marketing_assets')
      .select('*')
      .contains('allowed_platforms', [platform])
      .or(`last_used_at.is.null,last_used_at.lt.${cooldownStart}`)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('priority', { ascending: false });

    const raw = checked(data, error) ?? [];
    return raw
      .map((a: any) => ({
        id: a.id,
        source: a.source,
        contentHash: a.content_hash,
        storagePath: a.storage_path,
        publicUrl: a.public_url,
        width: a.width,
        height: a.height,
        format: a.format,
        topics: a.topics,
        audience: a.audience,
        allowedPlatforms: a.allowed_platforms,
        reuse: a.reuse,
        priority: a.priority,
        concept: a.concept,
        expiresAt: a.expires_at,
        usageCount: a.usage_count,
        lastUsedAt: a.last_used_at,
      }))
      .filter((a) => {
        if (!a.reuse && a.usageCount > 0) return false;
        return true;
      });
  }

  async assetUrl(id: string | null): Promise<string | null> {
    if (!id) return null;
    const { data, error } = await this.db.from('marketing_assets').select('public_url').eq('id', id).single();
    return checked(data, error).public_url as string;
  }

  async countPostsForDateRange(
    platform: Platform,
    startIso: string,
    endIso: string
  ): Promise<number> {
    const { count, error } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('platform', platform)
      .neq('status', 'cancelled')
      .gte('scheduled_for', startIso)
      .lte('scheduled_for', endIso);
    checked(true, error);
    return count ?? 0;
  }

  async getExistingPostsForDate(
    date: string,
    platform: Platform
  ): Promise<Array<{ id: string; idempotency_key: string; status: string }>> {
    const { data, error } = await this.db
      .from('marketing_posts')
      .select('id, idempotency_key, status')
      .eq('platform', platform)
      .neq('status', 'cancelled')
      .like('idempotency_key', `${date}:${platform}:%`);
    return checked(data, error) ?? [];
  }

  async countPublished(platform: Platform, since: string): Promise<number> {
    const { count, error } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('platform', platform)
      .gte('published_at', since);
    checked(true, error);
    return count ?? 0;
  }

  async getQueueHealthBreakdown(sinceIso: string, untilIso: string): Promise<{
    waitingToSubmit: number;
    providerScheduled: number;
    published: number;
    retryableFailed: number;
    permanentlyFailed: number;
    nextLocalScheduledPostAt: string | null;
    nextProviderScheduledPublishAt: string | null;
    staleLocalCount: number;
    staleProviderScheduledCount: number;
  }> {
    const { count: waitingCount, error: err1 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .in('status', ['scheduled', 'claimed'])
      .gte('scheduled_for', sinceIso)
      .lte('scheduled_for', untilIso);
    checked(true, err1);

    const { count: providerCount, error: err2 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'provider_scheduled')
      .gte('scheduled_for', sinceIso)
      .lte('scheduled_for', untilIso);
    checked(true, err2);

    const { count: publishedCount, error: err3 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gte('scheduled_for', sinceIso)
      .lte('scheduled_for', untilIso);
    checked(true, err3);

    const { count: retryableCount, error: err4 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'retryable_failed');
    checked(true, err4);

    const { count: permanentCount, error: err5 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'permanently_failed');
    checked(true, err5);

    const { data: nextLocal, error: err6 } = await this.db
      .from('marketing_posts')
      .select('scheduled_for')
      .in('status', ['scheduled', 'claimed'])
      .gte('scheduled_for', sinceIso)
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();
    checked(true, err6);

    const { data: nextProvider, error: err7 } = await this.db
      .from('marketing_posts')
      .select('scheduled_for')
      .eq('status', 'provider_scheduled')
      .gte('scheduled_for', sinceIso)
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();
    checked(true, err7);

    const { count: staleLocal, error: err8 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .in('status', ['scheduled', 'claimed'])
      .lt('scheduled_for', sinceIso);
    checked(true, err8);

    const { count: staleProvider, error: err9 } = await this.db
      .from('marketing_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'provider_scheduled')
      .lt('scheduled_for', sinceIso);
    checked(true, err9);

    return {
      waitingToSubmit: waitingCount ?? 0,
      providerScheduled: providerCount ?? 0,
      published: publishedCount ?? 0,
      retryableFailed: retryableCount ?? 0,
      permanentlyFailed: permanentCount ?? 0,
      nextLocalScheduledPostAt: nextLocal?.scheduled_for ?? null,
      nextProviderScheduledPublishAt: nextProvider?.scheduled_for ?? null,
      staleLocalCount: staleLocal ?? 0,
      staleProviderScheduledCount: staleProvider ?? 0,
    };
  }

  async upsertPostFeedback(input: {
    postId: string;
    isWinner: boolean;
    observedViews?: number | null | undefined;
    observedLikes?: number | null | undefined;
    observedComments?: number | null | undefined;
    observedShares?: number | null | undefined;
    operatorNote?: string | null | undefined;
  }): Promise<PostFeedbackRecord> {
    if (
      (input.observedViews !== undefined && input.observedViews !== null && input.observedViews < 0) ||
      (input.observedLikes !== undefined && input.observedLikes !== null && input.observedLikes < 0) ||
      (input.observedComments !== undefined && input.observedComments !== null && input.observedComments < 0) ||
      (input.observedShares !== undefined && input.observedShares !== null && input.observedShares < 0)
    ) {
      throw new Error('Observed metrics must be non-negative');
    }

    const { data: existing, error: existingErr } = await this.db
      .from('marketing_post_feedback')
      .select('*')
      .eq('post_id', input.postId)
      .maybeSingle();
    checked(true, existingErr);

    const now = new Date().toISOString();
    let markedAt = existing?.marked_at ?? null;
    if (input.isWinner && !markedAt) {
      markedAt = now;
    }

    const payload = {
      post_id: input.postId,
      is_winner: input.isWinner,
      observed_views: input.observedViews !== undefined ? input.observedViews : (existing?.observed_views ?? null),
      observed_likes: input.observedLikes !== undefined ? input.observedLikes : (existing?.observed_likes ?? null),
      observed_comments: input.observedComments !== undefined ? input.observedComments : (existing?.observed_comments ?? null),
      observed_shares: input.observedShares !== undefined ? input.observedShares : (existing?.observed_shares ?? null),
      operator_note: input.operatorNote !== undefined ? input.operatorNote : (existing?.operator_note ?? null),
      marked_at: markedAt,
      updated_at: now,
    };

    const { data, error } = await this.db
      .from('marketing_post_feedback')
      .upsert(payload, { onConflict: 'post_id' })
      .select('*')
      .single();

    const row = checked(data, error);
    return {
      postId: row.post_id,
      isWinner: row.is_winner,
      observedViews: row.observed_views !== null ? Number(row.observed_views) : null,
      observedLikes: row.observed_likes !== null ? Number(row.observed_likes) : null,
      observedComments: row.observed_comments !== null ? Number(row.observed_comments) : null,
      observedShares: row.observed_shares !== null ? Number(row.observed_shares) : null,
      operatorNote: row.operator_note ?? null,
      markedAt: row.marked_at ?? null,
      updatedAt: row.updated_at,
    };
  }

  async getPublishedPostsWithFeedback(options?: {
    platform?: Platform;
    winnersOnly?: boolean;
    limit?: number;
  }): Promise<PublishedPostWithFeedback[]> {
    const limit = options?.limit ?? 50;

    let targetPostIds: string[] | null = null;
    const feedbackByPostId = new Map<string, any>();

    if (options?.winnersOnly) {
      const { data: feedbackRows, error: feedbackErr } = await this.db
        .from('marketing_post_feedback')
        .select('*')
        .eq('is_winner', true)
        .order('marked_at', { ascending: false });
      const rawFeedback = checked(feedbackRows, feedbackErr) ?? [];
      if (rawFeedback.length === 0) return [];
      targetPostIds = rawFeedback.map((f: any) => f.post_id);
      for (const f of rawFeedback) {
        feedbackByPostId.set(f.post_id, f);
      }
    }

    let postsQuery = this.db
      .from('marketing_posts')
      .select('*')
      .eq('status', 'published');

    if (options?.platform) {
      postsQuery = postsQuery.eq('platform', options.platform);
    }
    if (targetPostIds) {
      postsQuery = postsQuery.in('id', targetPostIds);
    }

    postsQuery = postsQuery
      .order('published_at', { ascending: false })
      .limit(limit);

    const { data: postRows, error: postsErr } = await postsQuery;
    const posts = checked(postRows, postsErr) ?? [];
    if (posts.length === 0) return [];

    const postIds = posts.map((p: any) => p.id);

    if (!options?.winnersOnly) {
      const { data: feedbackRows, error: feedbackErr } = await this.db
        .from('marketing_post_feedback')
        .select('*')
        .in('post_id', postIds);
      const rawFeedback = checked(feedbackRows, feedbackErr) ?? [];
      for (const f of rawFeedback) {
        feedbackByPostId.set(f.post_id, f);
      }
    }

    const planIds = [...new Set(posts.map((p: any) => p.content_plan_id).filter(Boolean))];
    const assetIds = [...new Set(posts.map((p: any) => p.media_asset_id).filter(Boolean))];

    const planMap = new Map<string, { archetype: string; topic: string }>();
    if (planIds.length > 0) {
      const { data: plans, error: planErr } = await this.db
        .from('marketing_content_plans')
        .select('id, archetype, topic')
        .in('id', planIds);
      const planRows = checked(plans, planErr) ?? [];
      for (const p of planRows) {
        planMap.set(p.id, { archetype: p.archetype, topic: p.topic });
      }
    }

    const assetMap = new Map<string, { concept?: string | null }>();
    if (assetIds.length > 0) {
      const { data: assets, error: assetErr } = await this.db
        .from('marketing_assets')
        .select('id, concept')
        .in('id', assetIds);
      const assetRows = checked(assets, assetErr) ?? [];
      for (const a of assetRows) {
        assetMap.set(a.id, { concept: a.concept });
      }
    }

    return posts.map((p: any) => {
      const fb = feedbackByPostId.get(p.id);
      const plan = p.content_plan_id ? planMap.get(p.content_plan_id) : undefined;
      const asset = p.media_asset_id ? assetMap.get(p.media_asset_id) : undefined;
      const copyLengthMode: CopyLengthMode =
        p.copy_length_mode ?? classifyCopyLengthMode(p.copy_text, p.platform);

      return {
        id: p.id,
        platform: p.platform,
        assetMode: p.asset_mode,
        copyLengthMode,
        copyText: p.copy_text,
        destinationUrl: p.destination_url ?? null,
        publishedAt: p.published_at ?? null,
        scheduledFor: p.scheduled_for,
        platformPostUrl: p.platform_post_url ?? null,
        contentPlanId: p.content_plan_id ?? null,
        mediaAssetId: p.media_asset_id ?? null,
        archetype: plan?.archetype ?? null,
        topic: plan?.topic ?? null,
        visualConcept: asset?.concept ?? null,
        feedback: fb
          ? {
              postId: fb.post_id,
              isWinner: fb.is_winner,
              observedViews: fb.observed_views !== null ? Number(fb.observed_views) : null,
              observedLikes: fb.observed_likes !== null ? Number(fb.observed_likes) : null,
              observedComments: fb.observed_comments !== null ? Number(fb.observed_comments) : null,
              observedShares: fb.observed_shares !== null ? Number(fb.observed_shares) : null,
              operatorNote: fb.operator_note ?? null,
              markedAt: fb.marked_at ?? null,
              updatedAt: fb.updated_at,
            }
          : null,
      };
    });
  }

  async getWinnerPosts(options?: {
    platform?: Platform;
    limit?: number;
  }): Promise<WinnerPostContext[]> {
    const limit = options?.limit ?? 50;

    let feedbackQuery = this.db
      .from('marketing_post_feedback')
      .select('*')
      .eq('is_winner', true)
      .order('marked_at', { ascending: false });

    if (options?.limit) {
      feedbackQuery = feedbackQuery.limit(limit);
    }

    const { data: feedbackRows, error: fbErr } = await feedbackQuery;
    const rawFeedback = checked(feedbackRows, fbErr) ?? [];
    if (rawFeedback.length === 0) return [];

    const postIds = rawFeedback.map((f: any) => f.post_id);
    const feedbackMap = new Map<string, any>(rawFeedback.map((f: any) => [f.post_id, f]));

    let postsQuery = this.db
      .from('marketing_posts')
      .select('*')
      .in('id', postIds);

    if (options?.platform) {
      postsQuery = postsQuery.eq('platform', options.platform);
    }

    const { data: postRows, error: postsErr } = await postsQuery;
    const posts = checked(postRows, postsErr) ?? [];
    if (posts.length === 0) return [];

    const planIds = [...new Set(posts.map((p: any) => p.content_plan_id).filter(Boolean))];
    const assetIds = [...new Set(posts.map((p: any) => p.media_asset_id).filter(Boolean))];

    const planMap = new Map<string, { archetype: string; topic: string }>();
    if (planIds.length > 0) {
      const { data: plans, error: planErr } = await this.db
        .from('marketing_content_plans')
        .select('id, archetype, topic')
        .in('id', planIds);
      const planRows = checked(plans, planErr) ?? [];
      for (const p of planRows) {
        planMap.set(p.id, { archetype: p.archetype, topic: p.topic });
      }
    }

    const assetMap = new Map<string, { concept?: string | null }>();
    if (assetIds.length > 0) {
      const { data: assets, error: assetErr } = await this.db
        .from('marketing_assets')
        .select('id, concept')
        .in('id', assetIds);
      const assetRows = checked(assets, assetErr) ?? [];
      for (const a of assetRows) {
        assetMap.set(a.id, { concept: a.concept });
      }
    }

    const winners: WinnerPostContext[] = posts.map((p: any) => {
      const fb = feedbackMap.get(p.id)!;
      const plan = p.content_plan_id ? planMap.get(p.content_plan_id) : undefined;
      const asset = p.media_asset_id ? assetMap.get(p.media_asset_id) : undefined;
      const copyLengthMode: CopyLengthMode =
        p.copy_length_mode ?? classifyCopyLengthMode(p.copy_text, p.platform);
      const copyPreview =
        p.copy_text.length > 80 ? `${p.copy_text.slice(0, 80).trim()}...` : p.copy_text;

      return {
        postId: p.id,
        platform: p.platform,
        copyText: p.copy_text,
        copyPreview,
        assetMode: p.asset_mode,
        copyLengthMode,
        hasDestinationUrl: Boolean(p.destination_url && p.destination_url.length > 0),
        destinationUrl: p.destination_url ?? null,
        publishedAt: p.published_at ?? null,
        platformPostUrl: p.platform_post_url ?? null,
        archetype: plan?.archetype ?? null,
        topic: plan?.topic ?? null,
        visualConcept: asset?.concept ?? null,
        isWinner: fb.is_winner,
        observedViews: fb.observed_views !== null ? Number(fb.observed_views) : null,
        observedLikes: fb.observed_likes !== null ? Number(fb.observed_likes) : null,
        observedComments: fb.observed_comments !== null ? Number(fb.observed_comments) : null,
        observedShares: fb.observed_shares !== null ? Number(fb.observed_shares) : null,
        operatorNote: fb.operator_note ?? null,
        markedAt: fb.marked_at ?? null,
        updatedAt: fb.updated_at,
      };
    });

    winners.sort((a, b) => {
      const aTime = a.markedAt ?? a.publishedAt ?? '';
      const bTime = b.markedAt ?? b.publishedAt ?? '';
      return bTime.localeCompare(aTime);
    });

    return winners;
  }
}


