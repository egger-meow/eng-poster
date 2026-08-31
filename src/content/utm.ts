import type { Platform } from '../types.js';
export function attributedUrl(base: string, platform: Platform, campaign: string, postId: string, topic?: string): string {
  const url = new URL(base); url.protocol = 'https:';
  url.searchParams.set('utm_source',platform); url.searchParams.set('utm_medium','organic_social');
  url.searchParams.set('utm_campaign',campaign); url.searchParams.set('utm_content',postId);
  if (topic) url.searchParams.set('utm_term',topic); return url.toString();
}
export function hasRequiredUtm(raw: string, platform: Platform): boolean { const u = new URL(raw); return u.protocol === 'https:' && u.searchParams.get('utm_source') === platform && u.searchParams.get('utm_medium') === 'organic_social' && Boolean(u.searchParams.get('utm_campaign') && u.searchParams.get('utm_content')); }
