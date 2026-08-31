import type { PreparedPost, ValidationResult } from '../types.js';
import { hasRequiredUtm } from './utm.js';
const limits = { facebook: 63206, instagram: 2200, threads: 500 } as const;
export function validatePreparedPost(post: PreparedPost): ValidationResult {
  const errors: string[] = []; const copy = post.copyText.trim();
  if (!copy) errors.push('copy is empty'); if (copy.length > limits[post.platform]) errors.push(`copy exceeds ${limits[post.platform]} characters`);
  if (/{{[^}]+}}|\[TBD\]|<insert/i.test(copy)) errors.push('copy has unresolved template variables');
  if (post.platform === 'instagram' && !post.mediaUrl) errors.push('instagram requires media');
  if (post.destinationUrl && !hasRequiredUtm(post.destinationUrl,post.platform)) errors.push('destination URL is invalid or missing UTM attribution');
  for (const claim of post.claimManifest) {
    if (claim.kind === 'researched_fact' && claim.sourceUrls.length === 0) errors.push(`unsupported researched claim: ${claim.text}`);
    if (claim.kind === 'brand_fact' && claim.sourceUrls.length === 0) errors.push(`unsupported brand claim: ${claim.text}`);
  }
  return { valid: errors.length === 0, errors };
}
export function publishingAllowed(platform: PreparedPost['platform'], switches: { pauseAll: boolean; facebook: boolean; instagram: boolean; threads: boolean }): ValidationResult {
  const errors:string[]=[]; if (switches.pauseAll) errors.push('global posting pause is active'); if (!switches[platform]) errors.push(`${platform} is disabled`); return {valid:errors.length===0,errors};
}
