import { loadConfig } from '../config.js';
import { publishingAllowed } from '../content/gates.js';
import { MarketingRepository } from '../db/repository.js';
import { env } from '../env.js';
import { classifyError } from '../platforms/base.js';
import { publisherFor } from '../platforms/index.js';
import { redact } from '../shared/redact.js';
import type { Platform, PreparedPost } from '../types.js';

function fromRow(row: any, mediaUrl: string | null): PreparedPost {
  return {
    id: row.id,
    contentPlanId: row.content_plan_id ?? row.contentPlanId,
    platform: row.platform,
    assetMode: row.asset_mode ?? row.assetMode ?? (row.media_asset_id || row.mediaAssetId ? 'image_post' : (row.destination_url || row.destinationUrl ? 'link_preview' : 'text_only')),
    copyText: row.copy_text ?? row.copyText ?? '',
    destinationUrl: row.destination_url ?? row.destinationUrl ?? null,
    mediaAssetId: row.media_asset_id ?? row.mediaAssetId ?? null,
    mediaUrl,
    scheduledFor: row.scheduled_for ?? row.scheduledFor,
    idempotencyKey: row.idempotency_key ?? row.idempotencyKey,
    campaignSlug: 'always-on',
    claimManifest: row.claim_manifest ?? row.claimManifest ?? [],
  };
}

export interface DispatchDueResult {
  scheduledToProvider: number;
  published: number;
  reconciled: number;
  failed: number;
  skipped: number;
}

export async function dispatchDue(options?: {
  repo?: MarketingRepository;
  lookaheadHours?: number;
  now?: Date;
}): Promise<DispatchDueResult> {
  if (env.DRY_RUN || env.PAUSE_ALL_POSTING) {
    return { scheduledToProvider: 0, published: 0, reconciled: 0, failed: 0, skipped: 0 };
  }

  const config = await loadConfig();
  const repo = options?.repo ?? new MarketingRepository();
  const now = options?.now ?? new Date();

  const enabledPlatforms: Platform[] = [];
  if (env.FACEBOOK_ENABLED && config.platforms.facebook.enabled) enabledPlatforms.push('facebook');
  if (env.INSTAGRAM_ENABLED && config.platforms.instagram.enabled) enabledPlatforms.push('instagram');
  if (env.THREADS_ENABLED && config.platforms.threads.enabled) enabledPlatforms.push('threads');

  if (enabledPlatforms.length === 0) {
    return { scheduledToProvider: 0, published: 0, reconciled: 0, failed: 0, skipped: 0 };
  }

  let scheduledToProvider = 0;
  let published = 0;
  let reconciled = 0;
  let failed = 0;
  let skipped = 0;

  // 1. Reconciliation Pass: reconcile provider_scheduled posts near or past due time
  const reconcileThreshold = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  try {
    const providerPosts = await repo.getProviderScheduledPosts(reconcileThreshold);
    for (const postRow of providerPosts) {
      if (!enabledPlatforms.includes(postRow.platform)) continue;
      if (!postRow.platform_post_id) continue;

      try {
        const publisher = publisherFor(postRow.platform);
        const bufferPost = await publisher.getPost(postRow.platform_post_id);
        if (bufferPost) {
          if (bufferPost.status === 'sent') {
            await repo.reconcilePublished(
              postRow.id,
              {
                platformPostId: bufferPost.id,
                platformPostUrl: bufferPost.externalLink ?? null,
                sentAt: bufferPost.sentAt ?? new Date().toISOString(),
                providerStatus: bufferPost.status,
              },
              postRow.media_asset_id
            );
            reconciled++;
          } else if (bufferPost.status === 'failed' || bufferPost.status === 'error') {
            await repo.reconcileFailed(
              postRow.id,
              false,
              `Buffer post ${bufferPost.id} reported failed status: ${bufferPost.status}`
            );
            failed++;
          } else if (bufferPost.status !== postRow.provider_status) {
            await repo.updateProviderStatus(postRow.id, bufferPost.status);
          }
        }
      } catch (recErr) {
        // Individual reconciliation failure does not abort other posts
        console.error(`Reconciliation check failed for post ${postRow.id}:`, recErr);
      }
    }
  } catch (err) {
    console.error('Reconciliation pass failed:', err);
  }

  // 2. Lookahead Claim & Schedule Submission Pass
  const lookahead = options?.lookaheadHours ?? config.dispatcher?.lookaheadHours ?? 24;
  const rows = await repo.claimDue(20, config.retries.leaseMinutes, enabledPlatforms, lookahead);

  for (const row of rows) {
    const post = fromRow(row, await repo.assetUrl(row.media_asset_id));
    const allowed = publishingAllowed(post.platform, {
      pauseAll: env.PAUSE_ALL_POSTING,
      facebook: env.FACEBOOK_ENABLED,
      instagram: env.INSTAGRAM_ENABLED,
      threads: env.THREADS_ENABLED,
    });

    if (!allowed.valid) {
      await repo.releaseClaim(post.id);
      skipped++;
      continue;
    }

    const publisher = publisherFor(post.platform);
    const validation = await publisher.validatePost(post);
    if (!validation.valid) {
      await repo.fail(post.id, false, validation.errors.join('; '));
      failed++;
      continue;
    }

    const started = new Date().toISOString();
    try {
      // Idempotency check 1: if post already has platform_post_id (e.g. from earlier ambiguous attempt)
      if (row.platform_post_id) {
        const existing = await publisher.getPost(row.platform_post_id);
        if (existing) {
          if (existing.status === 'sent') {
            await repo.complete(
              post.id,
              { platformPostId: existing.id, platformPostUrl: existing.externalLink },
              post.mediaAssetId
            );
            published++;
          } else {
            await repo.markProviderScheduled(post.id, {
              platformPostId: existing.id,
              platformPostUrl: existing.externalLink,
              providerStatus: existing.status,
            });
            scheduledToProvider++;
          }
          continue;
        }
      }

      // Idempotency check 2: retrying after ambiguous response without stored ID, search recent channel posts
      if (row.attempt_count > 1 && !row.platform_post_id) {
        try {
          const recent = await publisher.getChannelPosts(10);
          const match = recent.find((p) => p.text?.trim() === post.copyText.trim());
          if (match) {
            if (match.status === 'sent') {
              await repo.complete(
                post.id,
                { platformPostId: match.id, platformPostUrl: match.externalLink },
                post.mediaAssetId
              );
              published++;
            } else {
              await repo.markProviderScheduled(post.id, {
                platformPostId: match.id,
                platformPostUrl: match.externalLink,
                providerStatus: match.status,
              });
              scheduledToProvider++;
            }
            continue;
          }
        } catch {
          // If recent channel post search fails, proceed with publish attempt
        }
      }

      const result = await publisher.publish(post);

      if (result.isScheduled) {
        await repo.markProviderScheduled(post.id, {
          platformPostId: result.platformPostId,
          platformPostUrl: result.platformPostUrl,
          providerStatus: result.providerStatus,
        });
        scheduledToProvider++;
      } else {
        await repo.complete(post.id, result, post.mediaAssetId);
        published++;
      }

      await repo.recordAttempt({
        post_id: post.id,
        attempt_number: row.attempt_count,
        platform: post.platform,
        request_summary: redact({
          idempotencyKey: post.idempotencyKey,
          hasMedia: Boolean(post.mediaUrl),
          isScheduled: result.isScheduled,
        }),
        response_summary: redact(result.rawSummary),
        status_category: result.isScheduled ? 'provider_scheduled' : 'published',
        started_at: started,
        finished_at: new Date().toISOString(),
      });
    } catch (error) {
      const category = classifyError(error);
      const retryable = category.retryable && row.attempt_count < config.retries.maxPublishAttempts;
      await repo.fail(post.id, retryable, category.ambiguous ? `AMBIGUOUS: ${category.message}` : category.message);
      await repo.recordAttempt({
        post_id: post.id,
        attempt_number: row.attempt_count,
        platform: post.platform,
        request_summary: redact({ idempotencyKey: post.idempotencyKey }),
        response_summary: { error: category.message, ambiguous: category.ambiguous },
        status_category: retryable ? 'retryable' : 'permanent',
        started_at: started,
        finished_at: new Date().toISOString(),
      });
      failed++;
    }
  }

  return { scheduledToProvider, published, reconciled, failed, skipped };
}
