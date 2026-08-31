import { attributedUrl } from '../content/utm.js';
import { validatePreparedPost } from '../content/gates.js';
import { idempotencyKey, newId } from '../shared/hash.js';
import type { Platform, PreparedPost, ValidationResult } from '../types.js';

export function dryRun(
  platform: Platform,
  mediaUrl?: string | null
): { post: PreparedPost; validation: ValidationResult } {
  const id = newId();
  const dateStr = new Date().toISOString().slice(0, 10);
  const post: PreparedPost = {
    id,
    contentPlanId: newId(),
    platform,
    copyText:
      platform === 'threads'
        ? '背了 30 個單字，隔天忘掉一大半。問題可能不只在記憶力。'
        : '孩子不是討厭英文，他可能只是受夠了無聊教材。\n\n把真正有興趣的題材，變成有學習目的的英文閱讀。',
    destinationUrl: attributedUrl('https://paperbond.jjmowlab.com', platform, 'dry-run', id),
    mediaUrl: mediaUrl ?? null,
    scheduledFor: new Date().toISOString(),
    idempotencyKey: idempotencyKey(dateStr, platform, 'dry-run', id),
    campaignSlug: 'dry-run',
    claimManifest: [{ text: 'opinion hook', kind: 'opinion', sourceUrls: [] }],
  };

  return { post, validation: validatePreparedPost(post) };
}

