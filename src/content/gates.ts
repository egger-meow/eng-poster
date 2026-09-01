import type { PreparedPost, ValidationResult } from '../types.js';
import { hasRequiredUtm } from './utm.js';

const limits = { facebook: 63206, instagram: 2200, threads: 500 } as const;

export const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>()]+|[a-zA-Z0-9-]+\.(?:com|edu|org|net|gov|tw|io|app|co|ai|me|cc)(?:\/[^\s<>()]*)?/gi;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches ? Array.from(matches) : [];
}

export function hasRawUrl(text: string): boolean {
  return extractUrls(text).length > 0;
}

export function formatPublishCopyText(post: PreparedPost): string {
  if (post.assetMode === 'link_preview' && post.destinationUrl) {
    if (!post.copyText.includes(post.destinationUrl)) {
      return `${post.copyText}\n\n${post.destinationUrl}`;
    }
  }
  return post.copyText;
}

export function formatFirstComment(post: PreparedPost): string | null {
  if (post.assetMode !== 'image_post') return null;
  if (post.ctaMode === 'none') return null;
  if (!post.destinationUrl) return null;
  return post.firstCommentText ?? `👉 了解詳情與教材試閱：\n${post.destinationUrl}`;
}

export function formatThreadsReply(post: PreparedPost): string | null {
  if (post.platform !== 'threads') return null;
  if (post.assetMode !== 'image_post') return null;
  if (post.ctaMode === 'none') return null;
  if (!post.destinationUrl) return null;
  return post.firstCommentText ?? `🔗 了解更多與教材試閱：\n${post.destinationUrl}`;
}

export function validatePreparedPost(post: PreparedPost): ValidationResult {
  const errors: string[] = [];
  const copy = post.copyText.trim();

  // 1. Basic copy validations
  if (!copy) errors.push('copy is empty');
  if (copy.length > limits[post.platform]) errors.push(`copy exceeds ${limits[post.platform]} characters`);
  if (/{{[^}]+}}|\[TBD\]|<insert/i.test(copy)) errors.push('copy has unresolved template variables');

  // 2. Destination URL UTM verification
  if (post.destinationUrl && !hasRequiredUtm(post.destinationUrl, post.platform)) {
    errors.push('destination URL is invalid or missing UTM attribution');
  }

  // 3. Claims verification
  for (const claim of post.claimManifest) {
    if (claim.kind === 'researched_fact' && claim.sourceUrls.length === 0) {
      errors.push(`unsupported researched claim: ${claim.text}`);
    }
    if (claim.kind === 'brand_fact' && claim.sourceUrls.length === 0) {
      errors.push(`unsupported brand claim: ${claim.text}`);
    }
  }

  // 4. Resolve effective asset mode
  const effectiveAssetMode = post.assetMode ?? (
    post.platform === 'instagram'
      ? 'image_post'
      : (post.mediaUrl || post.mediaAssetId)
        ? 'image_post'
        : post.destinationUrl
          ? 'link_preview'
          : 'text_only'
  );

  // 5. Platform-specific allowed asset_mode checks
  if (post.platform === 'instagram') {
    if (effectiveAssetMode !== 'image_post') {
      errors.push('instagram only supports image_post mode');
    }
    if (!post.mediaUrl && !post.mediaAssetId) {
      errors.push('instagram requires media');
    }
  }

  // 6. Strategy-specific validation rules
  if (effectiveAssetMode === 'image_post') {
    if (post.platform !== 'instagram' && !post.mediaUrl && !post.mediaAssetId) {
      errors.push(`${post.platform} image_post requires an attached media asset`);
    }
    // Disallow raw URL in body by default
    if (!post.allowRawUrlOnImagePost && hasRawUrl(copy)) {
      errors.push(`${post.platform} image_post must not include raw URL in body by default`);
    }
  } else if (effectiveAssetMode === 'link_preview') {
    // Must NOT have attached media
    if (post.mediaUrl || post.mediaAssetId) {
      errors.push(`${post.platform} link_preview must not have an attached media asset`);
    }
    // Requires canonical destination URL
    if (!post.destinationUrl) {
      errors.push(`${post.platform} link_preview requires a canonical destination URL`);
    }
    // Disallow multiple conflicting URLs in body
    const urlsInBody = extractUrls(copy);
    if (urlsInBody.length > 1) {
      errors.push(`${post.platform} link_preview allows at most one canonical URL in body`);
    }
  } else if (effectiveAssetMode === 'text_only') {
    // Must NOT have attached media
    if (post.mediaUrl || post.mediaAssetId) {
      errors.push(`${post.platform} text_only must not have an attached media asset`);
    }
    // Must NOT have canonical destination URL
    if (post.destinationUrl) {
      errors.push(`${post.platform} text_only must not have a canonical destination URL`);
    }
    // Must NOT contain raw URL in body
    if (hasRawUrl(copy)) {
      errors.push(`${post.platform} text_only must not include raw URLs in body (use link_preview mode for link posts)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function publishingAllowed(
  platform: PreparedPost['platform'],
  switches: { pauseAll: boolean; facebook: boolean; instagram: boolean; threads: boolean }
): ValidationResult {
  const errors: string[] = [];
  if (switches.pauseAll) errors.push('global posting pause is active');
  if (!switches[platform]) errors.push(`${platform} is disabled`);
  return { valid: errors.length === 0, errors };
}
