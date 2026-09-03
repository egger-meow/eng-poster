import { MarketingRepository } from '../db/repository.js';
import { hasOfferLanguage, validateOfferCopy } from './claims.js';
import { readOfferState, type OfferStateReader } from './state.js';

export async function inspectOfferSensitiveQueue(repo = new MarketingRepository(), getOffer: OfferStateReader = readOfferState) {
  const offerState = await getOffer();
  const rows = await repo.getOfferSensitiveQueueRows();
  const posts = rows.filter((row) => row.offer_gate != null || hasOfferLanguage(`${row.copy_text} ${row.first_comment_text ?? ''}`)).map((row) => ({
    id: row.id, platform: row.platform, status: row.status, scheduledFor: row.scheduled_for,
    platformPostId: row.platform_post_id ?? null, offerGate: row.offer_gate ?? null,
    inferredOfferSensitive: hasOfferLanguage(`${row.copy_text} ${row.first_comment_text ?? ''}`),
    copyText: row.copy_text,
    reviewReasons: validateOfferCopy({ copyText: row.copy_text, firstCommentText: row.first_comment_text, offerGate: row.offer_gate }, offerState),
  }));
  return { offerState, count: posts.length, posts };
}
