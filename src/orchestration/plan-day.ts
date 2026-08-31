import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { loadConfig } from '../config.js';
import { criticize } from '../content/critic.js';
import { generateVariants } from '../content/generator.js';
import { validatePreparedPost } from '../content/gates.js';
import { chooseSlot } from '../content/schedule.js';
import { attributedUrl } from '../content/utm.js';
import { MarketingRepository } from '../db/repository.js';
import { generateAndStoreAsset } from '../media/generate.js';
import { selectAsset } from '../media/select.js';
import { researchTopic } from '../research/researcher.js';
import { idempotencyKey, newId, sha256 } from '../shared/hash.js';
import type { Platform, PreparedPost, ResearchSnapshot } from '../types.js';

const read = (path: string) => readFile(path, 'utf8');

const archetypeTopics: Record<string, string> = {
  pain_point: '台灣家長最近關心的國中英文學習挫折與背單字痛點',
  educational_value: '學生興趣如何安全轉化為英文閱讀練習與閱讀策略',
  product_proof: '紙屬英文如何將個人興趣轉化為會考級別英文教材',
  timely_topic: '台灣近期國中英文教育趨勢與家長準備重點',
  conversion_offer: '紙屬英文客製化興趣英語教材體驗方案',
};

function selectArchetype(mix: Record<string, number>, index: number): string {
  const mapping: Record<string, string> = {
    painPointOrOpinion: 'pain_point',
    educationalValue: 'educational_value',
    productProof: 'product_proof',
    timelyTopic: 'timely_topic',
    conversion: 'conversion_offer',
  };

  const keys = Object.keys(mix);
  if (keys.length === 0) return 'pain_point';
  const key = keys[index % keys.length]!;
  return mapping[key] ?? key;
}

function selectCtaMode(ctaMix: Record<string, number>, slotIndex: number): 'none' | 'soft' | 'direct' {
  const modes: Array<'none' | 'soft' | 'direct'> = ['none', 'soft', 'direct'];
  return modes[slotIndex % modes.length] ?? 'soft';
}

export async function planDay(date: string): Promise<{
  planned: number;
  scheduled: Record<Platform, number>;
  fallbacks: number;
}> {
  const config = await loadConfig();
  const repo = new MarketingRepository();
  const occupied = new Set<string>();

  const scheduled: Record<Platform, number> = { facebook: 0, instagram: 0, threads: 0 };
  let fallbacks = 0;
  let planned = 0;
  let researchCallsToday = 0;
  let imageGenerationsToday = 0;

  const dt = DateTime.fromISO(date, { zone: config.timezone });
  const weekday = dt.toFormat('ccc').toLowerCase().slice(0, 3);
  const startOfWeek = dt.startOf('week').toISO()!;
  const endOfWeek = dt.endOf('week').toISO()!;

  // 1. Check existing scheduled/published posts and caps
  const neededSlots: Record<Platform, number> = { facebook: 0, instagram: 0, threads: 0 };
  for (const platform of ['facebook', 'instagram', 'threads'] as Platform[]) {
    const cfg = config.platforms[platform];
    if (!cfg.enabled) continue;

    const existingDayPosts = await repo.getExistingPostsForDate(date, platform);
    scheduled[platform] = existingDayPosts.length;

    const weekCount = await repo.countPostsForDateRange(platform, startOfWeek, endOfWeek);
    const dayTarget = cfg.postsPerDay ?? (cfg.preferredDays?.includes(weekday) ? 1 : 0);
    const dailyCap = Math.min(dayTarget, cfg.hardDailyCap);
    const weeklyCap = cfg.postsPerWeek ?? 999;

    const remainingDaily = Math.max(0, dailyCap - existingDayPosts.length);
    const remainingWeekly = Math.max(0, weeklyCap - weekCount);
    neededSlots[platform] = Math.min(remainingDaily, remainingWeekly);
  }

  const totalNeeded = neededSlots.facebook + neededSlots.instagram + neededSlots.threads;
  if (totalNeeded === 0) {
    return { planned, scheduled, fallbacks };
  }

  // 2. Load knowledge and prompts
  const [brand, product, claims, voice, audience] = await Promise.all([
    read('knowledge/brand.md'),
    read('knowledge/product.md'),
    read('knowledge/claims.md'),
    read('knowledge/voice.md'),
    read('knowledge/audience.md'),
  ]);

  const [plannerPrompt, writerPrompt, criticPrompt, researchPrompt, visualPrompt, imagePrompt] = await Promise.all([
    read('prompts/planner.md'),
    read('prompts/writer.md'),
    read('prompts/critic.md'),
    read('prompts/research.md'),
    read('prompts/visual-planner.md'),
    read('prompts/image-prompt.md'),
  ]);

  const maxSlotsNeeded = Math.max(neededSlots.facebook, neededSlots.instagram, neededSlots.threads);

  for (let slot = 0; slot < maxSlotsNeeded; slot++) {
    const archetype = selectArchetype(config.contentMix, slot);
    const topic = archetypeTopics[archetype] ?? archetypeTopics.pain_point!;
    const ctaMode = selectCtaMode(config.cta, slot);

    let research: ResearchSnapshot;
    if (
      config.research.enabled &&
      researchCallsToday < config.research.maxDailyCalls &&
      config.research.requireWebSearchForCurrentClaims
    ) {
      try {
        research = await researchTopic(topic, config.models.text, researchPrompt);
        researchCallsToday++;
      } catch {
        research = { query: topic, sources: [], factualNotes: [] };
        fallbacks++;
      }
    } else {
      research = { query: topic, sources: [], factualNotes: [] };
    }

    let planId = await repo.findPlan(date, archetype);
    if (!planId) {
      planId = await repo.createPlan({
        planDate: date,
        archetype,
        topic,
        audience: 'Taiwan parents grade 5-8',
        campaignSlug: 'always-on',
        research,
        provenance: {
          engineVersion: '0.1.0',
          plannerPromptVersion: 'planner-v1',
          writerPromptVersion: 'writer-v1',
          criticPromptVersion: 'critic-v1',
          visualPromptVersion: 'visual-v1',
          promptHash: sha256(
            [plannerPrompt, writerPrompt, criticPrompt, researchPrompt, visualPrompt, imagePrompt].join('\n')
          ),
          configVersion: config.version,
          configHash: sha256(JSON.stringify(config)),
          knowledgeHash: sha256(brand + product + claims + voice + audience),
          textModel: config.models.text,
          imageModel: config.models.image,
          generationTimestamp: new Date().toISOString(),
        },
      });
    }

    const variants = await generateVariants({
      topic,
      archetype,
      research,
      brand,
      product,
      claims,
      voice,
      audience,
      writerPrompt,
      ctaMode,
      model: config.models.text,
    });

    for (const variant of variants) {
      const platform = variant.platform;
      const cfg = config.platforms[platform];
      if (!cfg.enabled) continue;
      if (neededSlots[platform] <= 0) continue;

      const slotNumber = scheduled[platform] + 1;
      const postKey = idempotencyKey(date, platform, String(slotNumber));

      const critique = await criticize(variant, research, config.models.text, criticPrompt);
      if (!critique.approved) {
        if (critique.repairedCopy) {
          variant.copyText = critique.repairedCopy;
        } else {
          continue;
        }
      }

      let asset =
        variant.needsMedia || platform === 'instagram'
          ? await selectAsset(
              platform,
              [variant.visualConcept],
              config.media.exactAssetCooldownDays,
              config.media.visualConceptCooldownDays
            )
          : undefined;

      if (
        !asset &&
        (variant.needsMedia || platform === 'instagram') &&
        config.media.aiGenerationEnabled &&
        imageGenerationsToday < config.media.maxDailyGenerations
      ) {
        for (let attempt = 0; attempt < config.media.maxGenerationAttempts && !asset; attempt++) {
          try {
            asset = await generateAndStoreAsset({
              concept: variant.visualConcept,
              platform,
              model: config.media.aiModel,
              quality: config.media.defaultQuality,
              imagePromptGuide: imagePrompt,
            });
            imageGenerationsToday++;
          } catch {
            fallbacks++;
          }
        }
      }

      if (platform === 'instagram' && !asset) {
        fallbacks++;
        continue;
      }

      const postId = newId();
      const window = cfg.windows[(slotNumber - 1) % cfg.windows.length]!;
      const destinationUrl =
        ctaMode === 'none'
          ? null
          : attributedUrl(config.websiteBaseUrl, platform, 'always-on', postId);

      const post: PreparedPost = {
        id: postId,
        contentPlanId: planId,
        platform,
        copyText: variant.copyText,
        destinationUrl,
        mediaUrl: asset?.publicUrl ?? null,
        mediaAssetId: asset?.id ?? null,
        scheduledFor: chooseSlot(date, window, config.timezone, occupied),
        idempotencyKey: postKey,
        campaignSlug: 'always-on',
        claimManifest: variant.claims,
      };

      if (!validatePreparedPost(post).valid) continue;

      await repo.schedule(post, sha256(post.copyText));
      scheduled[platform]++;
      neededSlots[platform]--;
      planned++;
    }
  }

  return { planned, scheduled, fallbacks };
}

