import type { OfferGate, OfferState } from './state.js';
import { activeOfferAllowsClaims } from './state.js';

export interface OfferCopy {
  copyText: string;
  firstCommentText?: string | null | undefined;
  offerGate?: OfferGate | undefined;
}
function normalize(text: string): string {
  return text.normalize('NFKC').replace(/https?:\/\/\S+/gi, '').replace(/[\s\u200b-\u200d\ufeff]/g, '');
}
export function hasOfferLanguage(text: string): boolean {
  return /免費|不用錢|不花錢|不收費|免付費|(?:NT\$|\$)?0元|NT\$0|零元|(?:免|不用|不需|無需|不必)(?:要|填|填寫|綁定|綁)?信用卡|免綁卡|free|pilot|beta|公測|測試階段|測試版/i.test(normalize(text));
}
export function offerCopyText(post: OfferCopy): string {
  return `${post.copyText}\n${post.firstCommentText ?? ''}`;
}
export function needsOfferCheck(post: OfferCopy): boolean {
  return post.offerGate != null || hasOfferLanguage(offerCopyText(post));
}
// Conservative lexical guard; images/novel paraphrases still require author review.
export function validateOfferCopy(post: OfferCopy, state?: OfferState): string[] {
  const errors: string[] = [];
  const text = normalize(offerCopyText(post));
  if (/公測|beta|pilot|測試階段|測試版/i.test(text)) errors.push('Public copy must not expose internal testing terminology');
  if (/(?:永久|終身|一輩子|永遠|lifetime|forever).{0,50}(?:免費|不用錢|0元|free)|(?:免費|free).{0,50}(?:永久|終身|永遠|lifetime|forever)/i.test(text)) {
    errors.push('Lifetime-free entitlement claims are forbidden');
  }
  if (/(?:只剩|剩下|剩餘|最後|僅剩|還剩).{0,6}[\d一二三四五六七八九十百]+.{0,8}(?:位|名|席|個)|\d+(?:spots?|seats?)left|倒數|倒計時|限時免費|今天截止|今晚截止|最後機會/i.test(text)) {
    errors.push('Queued scarcity counts and unverified deadlines are forbidden');
  }
  if (hasOfferLanguage(text) && post.offerGate !== 'free_pilot_active') errors.push('Offer-dependent copy requires offerGate = free_pilot_active');
  if (post.offerGate != null && post.offerGate !== 'free_pilot_active') errors.push('Unsupported offerGate');
  if (state && needsOfferCheck(post)) {
    if (!activeOfferAllowsClaims(state)) errors.push('Current production offer does not allow free-access acquisition claims');
    if (/(?:100|一百)(?:位|名|個)/.test(text) && state.freePilotLimit !== 100) errors.push('100-person threshold is not confirmed by current offer-state');
  }
  return errors;
}
// Legacy copy is inspected without rewriting it or backfilling a gate.
export function effectiveOfferGate(post: OfferCopy): OfferGate {
  return needsOfferCheck(post) ? 'free_pilot_active' : null;
}
