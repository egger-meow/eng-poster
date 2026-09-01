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
    contentPlanId: row.content_plan_id,
    platform: row.platform,
    assetMode: row.asset_mode ?? (row.media_asset_id ? 'image_post' : (row.destination_url ? 'link_preview' : 'text_only')),
    copyText: row.copy_text,
    destinationUrl: row.destination_url,
    mediaAssetId: row.media_asset_id,
    mediaUrl,
    scheduledFor: row.scheduled_for,
    idempotencyKey: row.idempotency_key,
    campaignSlug: 'always-on',
    claimManifest: row.claim_manifest ?? [],
  };
}

export async function dispatchDue(): Promise<{ published: number; failed: number; skipped: number }> {
  if (env.DRY_RUN || env.PAUSE_ALL_POSTING) {
    return { published: 0, failed: 0, skipped: 0 };
  }

  const config = await loadConfig();
  const repo = new MarketingRepository();

  const enabledPlatforms: Platform[] = [];
  if (env.FACEBOOK_ENABLED && config.platforms.facebook.enabled) enabledPlatforms.push('facebook');
  if (env.INSTAGRAM_ENABLED && config.platforms.instagram.enabled) enabledPlatforms.push('instagram');
  if (env.THREADS_ENABLED && config.platforms.threads.enabled) enabledPlatforms.push('threads');

  if (enabledPlatforms.length === 0) {
    return { published: 0, failed: 0, skipped: 0 };
  }

  const rows = await repo.claimDue(20, config.retries.leaseMinutes, enabledPlatforms);
  let published = 0;
  let failed = 0;
  let skipped = 0;

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
      const result = await publisher.publish(post);
      await repo.complete(post.id, result, post.mediaAssetId);
      await repo.recordAttempt({
        post_id: post.id,
        attempt_number: row.attempt_count,
        platform: post.platform,
        request_summary: redact({ idempotencyKey: post.idempotencyKey, hasMedia: Boolean(post.mediaUrl) }),
        response_summary: redact(result.rawSummary),
        status_category: 'published',
        started_at: started,
        finished_at: new Date().toISOString(),
      });
      published++;
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

  return { published, failed, skipped };
}

