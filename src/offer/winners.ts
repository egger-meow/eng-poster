import type { WinningSignal, WinnerPostContext } from '../types.js';
import { hasOfferLanguage } from './claims.js';
import { activeOfferAllowsClaims, validOfferClaims, type OfferState } from './state.js';

export function winnerOfferContext(winner: WinnerPostContext, current: OfferState) {
  const dependent = winner.offerDependent === true || hasOfferLanguage(winner.copyText);
  return {
    ...winner,
    sourceOfferPhase: winner.offerPhase ?? null,
    offerDependent: dependent,
    currentOfferPhase: current.offerPhase,
    offerClaimsReusable: dependent && winner.offerPhase === current.offerPhase && activeOfferAllowsClaims(current),
    allowedCurrentOfferClaims: validOfferClaims(current),
    learningRule: 'Expired offer facts are NEVER transferable winning signals. Learn psychological mechanisms; validate every new claim against current offer-state.',
  };
}

export function validateWinningSignals(signals: Array<string | WinningSignal>, current: OfferState): string[] {
  return signals.flatMap((signal) => {
    const text = typeof signal === 'string' ? signal : `${signal.signal} ${signal.notes ?? ''}`;
    if (hasOfferLanguage(text) && !activeOfferAllowsClaims(current)) {
      return ['Expired or unverified offer facts cannot be used as current winning signals; describe the transferable mechanism instead'];
    }
    return [];
  });
}
