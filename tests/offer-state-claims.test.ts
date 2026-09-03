import { describe, expect, it, vi } from 'vitest';
import { mapEnrollmentState, readOfferState, validOfferClaims, offerStrategy } from '../src/offer/state.js';
import { effectiveOfferGate, validateOfferCopy } from '../src/offer/claims.js';

const row = { status: 'open', free_pilot_active: true, free_pilot_admissions: 4, free_pilot_limit: 100, remaining: 96 };
const active = mapEnrollmentState([row]);
const paid = mapEnrollmentState([{ ...row, free_pilot_active: false }]);
describe('canonical production offer state', () => {
  it('reads precisely get_enrollment_state and maps the RPC response', async () => {
    const rpc = vi.fn(async () => ({ data: [row], error: null }));
    const result = await readOfferState({ rpc }, new Date('2026-09-03T00:00:00Z'));
    expect(rpc).toHaveBeenCalledWith('get_enrollment_state');
    expect(result).toEqual({ offerPhase: 'free_pilot', freePilotActive: true, freePilotAdmissions: 4, freePilotLimit: 100, capacityRemaining: 96, status: 'open', checkedAt: '2026-09-03T00:00:00.000Z' });
  });
  it('maps inactive to standard_paid without inferring from admissions', () => {
    expect(paid.offerPhase).toBe('standard_paid');
    expect(validOfferClaims(paid)).toEqual([]);
  });
  it('preserves zero counts and distinguishes missing counts from zero', () => {
    expect(mapEnrollmentState([{ ...row, free_pilot_admissions: 0, remaining: 0 }])).toMatchObject({ freePilotAdmissions: 0, capacityRemaining: 0 });
    const missing = mapEnrollmentState([{ status: 'open', free_pilot_active: true }]);
    expect(missing).toMatchObject({ freePilotAdmissions: null, freePilotLimit: null, capacityRemaining: null });
    expect(validOfferClaims(missing)).toEqual([]);
  });
  it('does not conflate historical admissions and operational capacity', () => {
    expect(mapEnrollmentState([{ ...row, free_pilot_admissions: 80, remaining: 60 }]).capacityRemaining).toBe(60);
  });
  it.each([null, [], [row, row], [{}], [{ ...row, free_pilot_active: 'true' }], [{ ...row, free_pilot_limit: 0 }], [{ ...row, remaining: -1 }], [{ ...row, free_pilot_admissions: 100 }]])('fails safely on malformed/inconsistent state %j', (data) => {
    expect(() => mapEnrollmentState(data)).toThrow();
  });
  it('fails closed on RPC errors', async () => {
    await expect(readOfferState({ rpc: async () => ({ data: null, error: { message: 'offline' } }) })).rejects.toThrow('unavailable');
  });
});
describe('public offer copy contract', () => {
  it('derives directional strategy from current state only', () => {
    expect(offerStrategy(active)).toMatchObject({ suggestedCtaMix: { none: 0.3, soft: 0.35, direct: 0.35 } });
    expect(offerStrategy(paid).conversionCapableFreeMentionShare.max).toBe(0);
  });
  it.each(['100 位學員以前，每週專屬教材免費。', '目前免費使用，免信用卡', '現在居然 0 元。👀', '每週重新做的教材，現在不用錢', '免填信用卡，先拿教材看看'])('requires a live gate for %s', (copyText) => {
    expect(validateOfferCopy({ copyText }, active).join()).toContain('requires offerGate');
    expect(validateOfferCopy({ copyText, offerGate: 'free_pilot_active' }, active)).toEqual([]);
    expect(validateOfferCopy({ copyText, offerGate: 'free_pilot_active' }, paid).join()).toContain('does not allow');
  });
  it.each(['公測', '全面公測', '免費公測', 'beta', 'Free Pilot', '測試階段', '測試版'])('rejects public internal wording %s', (copyText) => {
    expect(validateOfferCopy({ copyText, offerGate: 'free_pilot_active' }, active).join()).toContain('testing terminology');
  });
  it.each(['前 100 名永久免費', '搶到就終身免費', '免費名額永久保留', 'free forever'])('rejects false permanent entitlement %s', (copyText) => {
    expect(validateOfferCopy({ copyText, offerGate: 'free_pilot_active' }, active).join()).toContain('Lifetime-free');
  });
  it.each(['只剩 96 個免費名額', '最後三個名額', '倒數 2 天免費', '今晚截止'])('rejects queued scarcity %s', (copyText) => {
    expect(validateOfferCopy({ copyText, offerGate: 'free_pilot_active' }, active).join()).toContain('scarcity');
  });
  it('checks first comments and infers legacy gates without rewriting', () => {
    const post = { copyText: '孩子看到英文長文就靈魂出竅', firstCommentText: '免費使用' };
    expect(effectiveOfferGate(post)).toBe('free_pilot_active');
    expect(validateOfferCopy(post, active).length).toBeGreaterThan(0);
    expect(Object.hasOwn(post, 'offerGate')).toBe(false);
  });
  it('allows evergreen copy in both phases without a gate', () => {
    for (const state of [active, paid]) expect(validateOfferCopy({ copyText: '孩子看到英文長文就靈魂出竅 💀' }, state)).toEqual([]);
  });
  it('rejects acquisition claims on waitlist and unconfirmed thresholds', () => {
    expect(validateOfferCopy({ copyText: '免費', offerGate: 'free_pilot_active' }, { ...active, status: 'waitlist' })).not.toEqual([]);
    expect(validateOfferCopy({ copyText: '100 位以前免費', offerGate: 'free_pilot_active' }, { ...active, freePilotLimit: null }).join()).toContain('threshold');
  });
});
