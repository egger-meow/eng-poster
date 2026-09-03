import { readOfferState, type OfferStateReader } from '../offer/state.js';
import { effectiveOfferGate, needsOfferCheck, validateOfferCopy } from '../offer/claims.js';
import { cancelProviderOffer } from '../offer/reconcile.js';
import { loadConfig } from '../config.js';
import { formatPublishCopyText, publishingAllowed } from '../content/gates.js';
import { MarketingRepository } from '../db/repository.js';
import { env } from '../env.js';
import { classifyError, PlatformError } from '../platforms/base.js';
import { publisherFor } from '../platforms/index.js';
import { redact } from '../shared/redact.js';
import type { Platform, PreparedPost } from '../types.js';

function fromRow(row: any, mediaUrl: string | null): PreparedPost {
  return {
    id: row.id,
    contentPlanId: row.content_plan_id ?? row.contentPlanId,
    platform: row.platform,
    assetMode: row.asset_mode ?? row.assetMode ?? (row.media_asset_id || row.mediaAssetId ? 'image_post' : (row.destination_url || row.destinationUrl ? 'link_preview' : 'text_only')),
    offerGate: row.offer_gate ?? row.offerGate ?? null,
    firstCommentText: row.first_comment_text ?? null,
    ctaMode: row.cta_mode ?? undefined,
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
  getOffer?: OfferStateReader;
}): Promise<DispatchDueResult> {
  if (env.DRY_RUN || env.PAUSE_ALL_POSTING) {
    return { scheduledToProvider: 0, published: 0, reconciled: 0, failed: 0, skipped: 0 };
  }

  const config = await loadConfig();
  const repo = options?.repo ?? new MarketingRepository();
  const now = options?.now ?? new Date();
  const getOffer = options?.getOffer ?? readOfferState;

  const enabledPlatforms: Platform[] = [];
  if (env.FACEBOOK_ENABLED && config.platforms.facebook.enabled) enabledPlatforms.push('facebook');
  if (env.INSTAGRAM_ENABLED && config.platforms.instagram.enabled) enabledPlatforms.push('instagram');
  if (env.THREADS_ENABLED && config.platforms.threads.enabled) enabledPlatforms.push('threads');


  let scheduledToProvider = 0;
  let published = 0;
  let reconciled = 0;
  let failed = 0;
  let skipped = 0;

  // 1. Reconciliation Pass: reconcile provider_scheduled posts near or past due time
  const reconcileThreshold = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  try {
    const providerPosts = await repo.getProviderScheduledPosts('9999-12-31T23:59:59.999Z');
    for (const postRow of providerPosts) {
      const offerPost = fromRow(postRow, null);
      const sensitive = needsOfferCheck(offerPost);
      // Cancel invalid offer posts even if the platform is disabled for new submissions.
      if (!sensitive && (!enabledPlatforms.includes(postRow.platform) || new Date(postRow.scheduled_for).getTime() > new Date(reconcileThreshold).getTime())) continue;
      if (!postRow.platform_post_id && !sensitive) continue;

      try {
        const publisher = publisherFor(postRow.platform);
        if (sensitive && !postRow.platform_post_id) {
          const recent = await publisher.getChannelPosts(100);
          const matches = recent.filter((p) => p.text?.trim() === formatPublishCopyText(offerPost).trim() || p.text?.trim() === offerPost.copyText.trim());
          if (matches.length !== 1) throw new Error('Unconfirmed offer submission; unique provider match unavailable; manual review required');
          postRow.platform_post_id = matches[0]!.id;
          await repo.holdOfferSubmission(postRow.id, 'Recovered offer provider ID; revalidation pending', postRow.platform_post_id);
        }
        if (sensitive) {
          offerPost.offerGate = effectiveOfferGate(offerPost);
          const errors = validateOfferCopy(offerPost, await getOffer());
          if (errors.length) {
            await cancelProviderOffer(repo, publisher, postRow.id, postRow.platform_post_id, errors.join('; '));
            skipped++;
            continue;
          }
        }
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
        if (sensitive) {
          await repo.recordOfferIssue(postRow.id, `Offer reconciliation requires retry/manual review: ${recErr instanceof Error ? recErr.message : 'unknown error'}`);
          failed++;
        }
        // Individual reconciliation failure does not abort other posts
        console.error(`Reconciliation check failed for post ${postRow.id}:`, recErr);
      }
    }
  } catch (err) {
    console.error('Reconciliation pass failed:', err);
  }

  if (enabledPlatforms.length === 0) return { scheduledToProvider, published, reconciled, failed, skipped };

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
    const priorOfferUncertainty = Boolean(row.platform_post_id) || /AMBIGUOUS|UNCONFIRMED/i.test(row.last_error ?? '') || row.provider_status === 'offer_submission_unconfirmed';
    if (needsOfferCheck(post)) {
      try {
        post.offerGate = effectiveOfferGate(post);
        const errors = validateOfferCopy(post, await getOffer());
        if (errors.length) {
          let providerId = row.platform_post_id;
          if (!providerId && priorOfferUncertainty) {
            const recent = await publisher.getChannelPosts(100);
            const matches = recent.filter((p) => p.text?.trim() === formatPublishCopyText(post).trim() || p.text?.trim() === post.copyText.trim());
            if (matches.length !== 1) throw new Error('Ambiguous prior offer submission; manual provider review required');
            providerId = matches[0]!.id;
          }
          if (providerId) await cancelProviderOffer(repo, publisher, post.id, providerId, errors.join('; '));
          else await repo.cancelOfferPost(post.id, errors.join('; '));
          skipped++;
          continue;
        }
      } catch (error) {
        const message = `Offer check blocked dispatch: ${error instanceof Error ? error.message : 'unknown error'}`;
        if (priorOfferUncertainty) await repo.holdOfferSubmission(post.id, message, row.platform_post_id ?? undefined);
        else {
          await repo.releaseClaim(post.id, row.attempt_count);
          await repo.recordOfferIssue(post.id, message);
        }
        failed++;
        continue;
      }
    }
    const validation = await publisher.validatePost(post);
    if (!validation.valid) {
      await repo.fail(post.id, false, validation.errors.join('; '));
      failed++;
      continue;
    }

    const started = new Date().toISOString();
    let submittedProviderId: string | undefined = row.platform_post_id ?? undefined;
    let publishStarted = false;
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
      if ((needsOfferCheck(post) ? priorOfferUncertainty : row.attempt_count > 1) && !row.platform_post_id) {
        try {
          const recent = await publisher.getChannelPosts(10);
          const publishText = formatPublishCopyText(post);
          const matches = recent.filter((p) => p.text?.trim() === publishText.trim() || p.text?.trim() === post.copyText.trim());
          if (matches.length !== 1 && needsOfferCheck(post)) throw new Error('Ambiguous offer submission without unique provider match; manual review required');
          const match = matches[0];
          if (match) {
            submittedProviderId = match.id;
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
        } catch (error) {
          if (needsOfferCheck(post)) throw error;
          // If recent channel post search fails, proceed with publish attempt
        }
      }

      if (needsOfferCheck(post)) {
        try {
          const errors = validateOfferCopy(post, await getOffer());
          if (errors.length) {
            await repo.cancelOfferPost(post.id, errors.join('; '));
            skipped++;
            continue;
          }
        } catch (error) {
          await repo.releaseClaim(post.id, row.attempt_count);
          await repo.recordOfferIssue(post.id, `Pre-submit offer check unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
          failed++;
          continue;
        }
      }
      publishStarted = true;
      const result = await publisher.publish(post);
      submittedProviderId = result.platformPostId;

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
      const definitiveNoCreate = error instanceof PlatformError && error.status !== undefined && error.status >= 400 && error.status < 500;
      const holdOffer = needsOfferCheck(post) && ((publishStarted && !definitiveNoCreate) || submittedProviderId !== undefined || priorOfferUncertainty);
      if (holdOffer) {
        // An uncertain provider schedule must remain reconcilable even after the retry budget.
        await repo.holdOfferSubmission(post.id, `OFFER SUBMISSION UNCONFIRMED: ${category.message}`, submittedProviderId);
      } else {
        await repo.fail(post.id, retryable, category.ambiguous ? `AMBIGUOUS: ${category.message}` : category.message);
      }
      await repo.recordAttempt({
        post_id: post.id,
        attempt_number: row.attempt_count,
        platform: post.platform,
        request_summary: redact({ idempotencyKey: post.idempotencyKey }),
        response_summary: { error: category.message, ambiguous: category.ambiguous },
        status_category: holdOffer ? 'offer_submission_unconfirmed' : retryable ? 'retryable' : 'permanent',
        started_at: started,
        finished_at: new Date().toISOString(),
      });
      failed++;
    }
  }

  return { scheduledToProvider, published, reconciled, failed, skipped };
}
