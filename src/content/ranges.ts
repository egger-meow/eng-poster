import type { CopyLengthMode, Platform } from '../types.js';

export interface CopyLengthRange {
  minRecommended: number;
  maxTarget: number;
  maxLimit: number;
}

export const COPY_LENGTH_RANGES: Record<Platform, Record<CopyLengthMode, CopyLengthRange>> = {
  threads: {
    short: { minRecommended: 5, maxTarget: 100, maxLimit: 140 },
    long: { minRecommended: 150, maxTarget: 350, maxLimit: 500 },
  },
  facebook: {
    short: { minRecommended: 10, maxTarget: 150, maxLimit: 200 },
    long: { minRecommended: 250, maxTarget: 800, maxLimit: 63206 },
  },
  instagram: {
    short: { minRecommended: 30, maxTarget: 180, maxLimit: 220 },
    long: { minRecommended: 180, maxTarget: 400, maxLimit: 2200 },
  },
} as const;

export const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>()]+|[a-zA-Z0-9-]+\.(?:com|edu|org|net|gov|tw|io|app|co|ai|me|cc)(?:\/[^\s<>()]*)?/gi;

/**
 * Strips URLs from copy text to measure pure content length.
 */
export function getContentLength(text: string): number {
  const stripped = text.replace(URL_REGEX, '').trim();
  return stripped.length;
}

/**
 * Classifies copy length into 'short' or 'long' deterministically.
 */
export function classifyCopyLengthMode(copyText: string, platform?: Platform): CopyLengthMode {
  const pureLength = getContentLength(copyText);
  if (platform === 'threads') {
    return pureLength <= 120 ? 'short' : 'long';
  }
  if (platform === 'facebook') {
    return pureLength <= 200 ? 'short' : 'long';
  }
  if (platform === 'instagram') {
    return pureLength <= 180 ? 'short' : 'long';
  }
  return pureLength <= 150 ? 'short' : 'long';
}
