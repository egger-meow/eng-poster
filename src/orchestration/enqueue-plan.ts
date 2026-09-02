import { DateTime } from 'luxon';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { chooseSlot } from '../content/schedule.js';
import { attributedUrl } from '../content/utm.js';
import { validatePreparedPost } from '../content/gates.js';
import { MarketingRepository } from '../db/repository.js';
import { selectAsset } from '../media/select.js';
import { idempotencyKey, newId, sha256 } from '../shared/hash.js';
import type { AssetMode, Claim, CopyLengthMode, Platform, PreparedPost, ResearchSnapshot } from '../types.js';
import { classifyCopyLengthMode } from '../content/ranges.js';

const claimSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(['brand_fact', 'researched_fact', 'opinion', 'rhetorical']),
  sourceUrls: z.array(z.string().url()).default([]),
});

export const enqueuePostSchema = z.object({
  platform: z.enum(['facebook', 'instagram', 'threads']),
  assetMode: z.enum(['text_only', 'image_post', 'link_preview']).optional(),
  asset_mode: z.enum(['text_only', 'image_post', 'link_preview']).optional(),
  copyLengthMode: z.enum(['short', 'long']).optional(),
  copy_length_mode: z.enum(['short', 'long']).optional(),
  copyText: z.string().min(1),
  claimManifest: z.array(claimSchema).default([]),
  visualConcept: z.string().nullable().optional(),
  ctaMode: z.enum(['none', 'soft', 'direct']).optional(),
  destinationUrl: z.string().url().nullable().optional(),
  requestedWindow: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  mediaAssetId: z.string().uuid().nullable().optional(),
  mediaUrl: z.string().url().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  firstCommentText: z.string().nullable().optional(),
  allowRawUrlOnImagePost: z.boolean().optional(),
});

export const enqueuePlanSchema = z.object({
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'planDate must be YYYY-MM-DD'),
  source: z.string().default('chatgpt_scheduler'),
  archetype: z.string().min(1),
  topic: z.string().min(1),
  audience: z.string().default('Taiwan parents grade 5-8'),
  campaignSlug: z.string().default('always-on'),
  researchSnapshot: z
    .object({
      query: z.string(),
      sources: z.array(
        z.object({
          url: z.string().url(),
          title: z.string(),
          retrievedAt: z.string(),
          notes: z.array(z.string()).default([]),
        })
      ).default([]),
      factualNotes: z.array(z.string()).default([]),
    })
    .default({ query: '', sources: [], factualNotes: [] }),
  posts: z.array(enqueuePostSchema).min(1, 'At least one post must be provided'),
  provenance: z
    .object({
      schedulerPromptVersion: z.string().optional(),
      generationTimestamp: z.string().default(() => new Date().toISOString()),
      sourceUrls: z.array(z.string().url()).optional(),
      contentHash: z.string().optional(),
    })
    .passthrough()
    .default(() => ({ generationTimestamp: new Date().toISOString() })),
});

export type EnqueuePlanInput = z.infer<typeof enqueuePlanSchema>;
export type EnqueuePostInput = z.infer<typeof enqueuePostSchema>;

export interface EnqueueResult {
  planId: string;
  enqueued: number;
  scheduled: Record<Platform, number>;
  skipped: number;
  errors: string[];
}

export async function enqueuePlan(
  rawInput: unknown,
  repo = new MarketingRepository()
): Promise<EnqueueResult> {
  const parsed = enqueuePlanSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(`Invalid plan payload: ${parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
  }


  const input = parsed.data;
  const config = await loadConfig();
  const occupied = new Set<string>();


  const dt = DateTime.fromISO(input.planDate, { zone: config.timezone });
  if (!dt.isValid) {
    throw new Error(`Invalid planDate timezone conversion for ${input.planDate}`);
  }
  const weekday = dt.toFormat('ccc').toLowerCase().slice(0, 3);
  const startOfWeek = dt.startOf('week').toISO()!;
  const endOfWeek = dt.endOf('week').toISO()!;

  const scheduledCounts: Record<Platform, number> = { facebook: 0, instagram: 0, threads: 0 };
  const errors: string[] = [];
  let enqueued = 0;
  let skipped = 0;

  // 1. Query rolling history and cooldown concepts
  const recentVisualConcepts = await repo.getRecentVisualConcepts(input.planDate, config.media.visualConceptCooldownDays);
  const usedConceptsThisRun = new Set<string>(recentVisualConcepts);
  const usedAssetIdsThisRun = new Set<string>();

  // 2. Find or create content plan row
  let planId = await repo.findPlan(input.planDate, input.archetype);
  if (!planId) {
    planId = await repo.createPlan({
      planDate: input.planDate,
      archetype: input.archetype,
      topic: input.topic,
      audience: input.audience,
      campaignSlug: input.campaignSlug,
      research: input.researchSnapshot as ResearchSnapshot,
      provenance: {
        source: input.source,
        ...input.provenance,
        configVersion: config.version,
        enqueuedAt: new Date().toISOString(),
      },
    });
  }

  // 3. Process each post with strict validation gates
  for (const postInput of input.posts) {
    const platform = postInput.platform;
    const cfg = config.platforms[platform];

    if (!cfg || !cfg.enabled) {
      errors.push(`Platform ${platform} is disabled in configuration`);
      skipped++;
      continue;
    }

    // Gate A: Researched factual claims must have source URLs
    for (const claim of postInput.claimManifest) {
      if (claim.kind === 'researched_fact' && (!claim.sourceUrls || claim.sourceUrls.length === 0)) {
        throw new Error(`Researched claim "${claim.text.slice(0, 40)}..." is missing required source URLs`);
      }
    }

    // Gate B: Character limits per platform
    const limits: Record<Platform, number> = { threads: 500, instagram: 2200, facebook: 63206 };
    if (postInput.copyText.length > limits[platform]) {
      throw new Error(`Post copy for ${platform} exceeds max length of ${limits[platform]} characters (got ${postInput.copyText.length})`);
    }

    // Gate C: Caps enforcement
    const existingDayPosts = await repo.getExistingPostsForDate(input.planDate, platform);
    scheduledCounts[platform] = existingDayPosts.length;

    const weekCount = await repo.countPostsForDateRange(platform, startOfWeek, endOfWeek);
    const dayTarget = cfg.postsPerDay ?? (cfg.preferredDays?.includes(weekday) ? 1 : 0);
    const dailyCap = Math.min(dayTarget, cfg.hardDailyCap);
    const weeklyCap = cfg.postsPerWeek ?? 999;

    if (existingDayPosts.length >= dailyCap) {
      errors.push(`Daily cap reached for ${platform} on ${input.planDate} (${existingDayPosts.length}/${dailyCap})`);
      skipped++;
      continue;
    }
    if (weekCount >= weeklyCap) {
      errors.push(`Weekly cap reached for ${platform} (${weekCount}/${weeklyCap})`);
      skipped++;
      continue;
    }

    const slotNumber = existingDayPosts.length + 1;
    const postKey = idempotencyKey(input.planDate, platform, String(slotNumber));

    // Resolve asset mode
    const assetMode: AssetMode = postInput.assetMode ?? postInput.asset_mode ?? (
      platform === 'instagram'
        ? 'image_post'
        : (postInput.mediaAssetId || postInput.mediaUrl)
          ? 'image_post'
          : (postInput.destinationUrl || (postInput.ctaMode && postInput.ctaMode !== 'none'))
            ? 'link_preview'
            : 'text_only'
    );

    // Gate D: Media resolution and cooldowns
    let mediaUrl: string | null = postInput.mediaUrl ?? null;
    let mediaAssetId: string | null = postInput.mediaAssetId ?? null;

    if (assetMode === 'image_post' && !mediaUrl && !mediaAssetId) {
      const selected = await selectAsset(
        platform,
        [postInput.visualConcept ?? input.topic],
        config.media.exactAssetCooldownDays,
        config.media.visualConceptCooldownDays,
        Array.from(usedConceptsThisRun),
        usedAssetIdsThisRun,
        repo
      );
      if (selected) {
        mediaUrl = selected.publicUrl;
        mediaAssetId = selected.id;
        usedAssetIdsThisRun.add(selected.id);
        if (selected.concept) usedConceptsThisRun.add(selected.concept);
      }
    }

    if (platform === 'instagram' && assetMode !== 'image_post') {
      throw new Error('instagram only supports image_post mode');
    }

    if (platform === 'instagram' && !mediaUrl) {
      throw new Error('Instagram post requires media, but neither mediaUrl nor available library asset was found');
    }

    // Gate E: Destination URL and UTM attribution
    const postId = newId();
    let destinationUrl: string | null = null;
    if (platform === 'facebook' || platform === 'threads') {
      const baseUrl = postInput.destinationUrl ?? config.websiteBaseUrl;
      destinationUrl = attributedUrl(baseUrl, platform, input.campaignSlug, postId, input.topic);
    } else if (platform === 'instagram') {
      if (postInput.destinationUrl) {
        destinationUrl = attributedUrl(postInput.destinationUrl, platform, input.campaignSlug, postId, input.topic);
      } else if (postInput.ctaMode && postInput.ctaMode !== 'none') {
        destinationUrl = attributedUrl(config.websiteBaseUrl, platform, input.campaignSlug, postId, input.topic);
      }
    }

    // Gate F: Slot scheduling
    const window = postInput.requestedWindow ?? cfg.windows[(slotNumber - 1) % cfg.windows.length]!;
    const scheduledFor = postInput.scheduledFor ?? chooseSlot(input.planDate, window, config.timezone, occupied);

    const copyLengthMode: CopyLengthMode =
      postInput.copyLengthMode ??
      postInput.copy_length_mode ??
      classifyCopyLengthMode(postInput.copyText, platform);

    const preparedPost: PreparedPost = {
      id: postId,
      contentPlanId: planId,
      platform,
      assetMode,
      copyLengthMode,
      copyText: postInput.copyText,
      destinationUrl,
      mediaUrl,
      mediaAssetId,
      scheduledFor,
      idempotencyKey: postKey,
      campaignSlug: input.campaignSlug,
      claimManifest: postInput.claimManifest as Claim[],
      ctaMode: postInput.ctaMode,
      firstCommentText: postInput.firstCommentText ?? null,
      allowRawUrlOnImagePost: postInput.allowRawUrlOnImagePost,
    };

    const postValidation = validatePreparedPost(preparedPost);
    if (!postValidation.valid) {
      throw new Error(`Post validation failed for ${platform} (${assetMode}): ${postValidation.errors.join('; ')}`);
    }

    await repo.schedule(preparedPost, sha256(preparedPost.copyText));
    scheduledCounts[platform]++;
    enqueued++;
  }

  return {
    planId,
    enqueued,
    scheduled: scheduledCounts,
    skipped,
    errors,
  };
}
