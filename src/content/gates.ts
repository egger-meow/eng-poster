import type { CopyLengthMode, PreparedPost, ValidationResult } from '../types.js';
import { hasRequiredUtm } from './utm.js';
import {
  COPY_LENGTH_RANGES,
  classifyCopyLengthMode,
  getContentLength,
  URL_REGEX,
} from './ranges.js';

const limits = { facebook: 63206, instagram: 2200, threads: 500 } as const;

export { URL_REGEX };

export const FORBIDDEN_AI_INTROS = [
  '很多家長都會發現',
  '在現今教育環境中',
  '其實學英文最重要的是',
  '你是否曾經想過',
] as const;

export const FORBIDDEN_FILLER_CONCLUSIONS = [
  '總而言之',
  '這就是為什麼',
] as const;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches ? Array.from(matches) : [];
}

export function hasRawUrl(text: string): boolean {
  return extractUrls(text).length > 0;
}

export const CANONICAL_BASE_URL = 'https://paperbond.jjmowlab.com';
export const CANONICAL_HOST = 'paperbond.jjmowlab.com';

export function isCanonicalPaperEnglishUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.hostname === CANONICAL_HOST;
  } catch {
    return false;
  }
}

export function containsCanonicalPaperEnglishUrl(text: string): boolean {
  return text.includes(CANONICAL_HOST);
}

export function formatPublishCopyText(post: PreparedPost): string {
  if (post.platform === 'facebook' || post.platform === 'threads') {
    if (!post.destinationUrl) {
      return post.copyText;
    }

    if (post.copyText.includes(post.destinationUrl)) {
      return post.copyText;
    }

    const canonicalPattern = /(?:https?:\/\/)?paperbond\.jjmowlab\.com[^\s<>()]*/gi;
    if (canonicalPattern.test(post.copyText)) {
      return post.copyText.replace(canonicalPattern, post.destinationUrl);
    }

    const trimmed = post.copyText.trimEnd();
    return `${trimmed}\n\n${post.destinationUrl}`;
  }

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

  // Copy length mode and bounds
  const effectiveLengthMode: CopyLengthMode =
    post.copyLengthMode ?? classifyCopyLengthMode(copy, post.platform);
  const contentLength = getContentLength(copy);

  if (effectiveLengthMode === 'short') {
    const maxLimit = COPY_LENGTH_RANGES[post.platform].short.maxLimit;
    if (contentLength > maxLimit) {
      errors.push(
        `copy in short mode exceeds maximum limit of ${maxLimit} characters (got ${contentLength})`
      );
    }

    // Short mode quality gate: no generic AI intros
    for (const phrase of FORBIDDEN_AI_INTROS) {
      if (copy.includes(phrase)) {
        errors.push(`short mode copy must not contain generic AI intro phrase: "${phrase}"`);
      }
    }

    // Short mode quality gate: no conclusion filler
    for (const phrase of FORBIDDEN_FILLER_CONCLUSIONS) {
      if (copy.includes(phrase)) {
        errors.push(`short mode copy must not contain conclusion filler: "${phrase}"`);
      }
    }

    // Short mode quality gate: avoid listicles
    const bulletLines = copy
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^(?:[-*•]|\d+\.)\s+/.test(l));
    if (bulletLines.length >= 3) {
      errors.push('short mode copy must not contain multi-item listicles');
    }
  } else if (effectiveLengthMode === 'long') {
    // Long mode quality gate: tighten copy, eliminate empty filler
    if (copy.includes('在現今教育環境中')) {
      errors.push('long mode copy must not contain generic setup phrase: "在現今教育環境中"');
    }
    for (const phrase of FORBIDDEN_FILLER_CONCLUSIONS) {
      if (copy.includes(phrase)) {
        errors.push(`long mode copy must avoid generic conclusion phrase: "${phrase}"`);
      }
    }
  }

  // Claim safety: absolute outcome guarantee checks
  if (/(?:保證|承諾).*(?:A\+\+|進步|考上)/i.test(copy)) {
    const hasRhetoricalOrSource = post.claimManifest.some(
      (c) => c.kind === 'opinion' || c.kind === 'rhetorical' || c.sourceUrls.length > 0
    );
    if (!hasRhetoricalOrSource) {
      errors.push('guaranteed outcome claims are forbidden without verified evidence');
    }
  }

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
    // Only Instagram disallows raw URL in body by default
    if (post.platform === 'instagram' && !post.allowRawUrlOnImagePost && hasRawUrl(copy)) {
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
  }

  // 7. Mandatory Main-Body Link Invariant for Facebook & Threads
  if (post.platform === 'facebook' || post.platform === 'threads') {
    if (!post.destinationUrl) {
      errors.push(`${post.platform} post requires a canonical Paper English destination URL`);
    } else if (!isCanonicalPaperEnglishUrl(post.destinationUrl)) {
      errors.push(`${post.platform} destination URL must be a canonical Paper English URL (${CANONICAL_BASE_URL})`);
    }

    const finalPublishCopy = formatPublishCopyText(post);
    if (!containsCanonicalPaperEnglishUrl(finalPublishCopy)) {
      errors.push(`${post.platform} final publish copy must visibly contain a canonical Paper English destination URL`);
    }
    if (finalPublishCopy.length > limits[post.platform]) {
      errors.push(
        `${post.platform} final publish copy exceeds ${limits[post.platform]} characters (got ${finalPublishCopy.length})`
      );
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
