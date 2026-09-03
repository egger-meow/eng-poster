import { z } from 'zod';
import { getSupabase } from '../db/client.js';
import { requireEnv } from '../env.js';

export const PRODUCTION_OFFER_URL = 'https://ykzszjrqynrhgdhoeovo.supabase.co';
export const offerPhases = ['free_pilot', 'standard_paid'] as const;
export type OfferPhase = (typeof offerPhases)[number];
export type OfferGate = 'free_pilot_active' | null;

export const offerStateSchema = z.object({
  offerPhase: z.enum(offerPhases),
  freePilotActive: z.boolean(),
  freePilotAdmissions: z.number().int().nonnegative().nullable(),
  freePilotLimit: z.number().int().positive().nullable(),
  capacityRemaining: z.number().int().nonnegative().nullable(),
  status: z.enum(['open', 'waitlist', 'closed']),
  checkedAt: z.string().datetime(),
});
export type OfferState = z.infer<typeof offerStateSchema>;
export type OfferStateReader = () => Promise<OfferState>;

const enrollmentSchema = z.array(z.object({
  free_pilot_active: z.boolean(),
  free_pilot_admissions: z.number().int().nonnegative().nullish(),
  free_pilot_limit: z.number().int().positive().nullish(),
  remaining: z.number().int().nonnegative().nullish(),
  status: z.enum(['open', 'waitlist', 'closed']),
})).length(1);

export function mapEnrollmentState(data: unknown, now = new Date()): OfferState {
  const parsed = enrollmentSchema.safeParse(data);
  if (!parsed.success) throw new Error('Malformed production enrollment state; offer claims are unavailable');
  const row = parsed.data[0]!;
  if (row.free_pilot_active && row.free_pilot_admissions != null && row.free_pilot_limit != null && row.free_pilot_admissions >= row.free_pilot_limit) {
    throw new Error('Inconsistent production enrollment state; active offer reached its historical limit');
  }
  return {
    offerPhase: row.free_pilot_active ? 'free_pilot' : 'standard_paid',
    freePilotActive: row.free_pilot_active,
    freePilotAdmissions: row.free_pilot_admissions ?? null,
    freePilotLimit: row.free_pilot_limit ?? null,
    // Operational capacity is distinct from the historical offer threshold.
    capacityRemaining: row.remaining ?? null,
    status: row.status,
    checkedAt: now.toISOString(),
  };
}

export async function readOfferState(
  client?: { rpc(name: string): PromiseLike<{ data: unknown; error: { message: string } | null }> },
  now = new Date(),
): Promise<OfferState> {
  if (!client && new URL(requireEnv('SUPABASE_URL')).origin !== PRODUCTION_OFFER_URL) {
    throw new Error('Offer authority must be production ykzszjrqynrhgdhoeovo; refusing another project');
  }
  const { data, error } = await (client ? client.rpc('get_enrollment_state') : getSupabase().rpc('get_enrollment_state').abortSignal(AbortSignal.timeout(15_000)));
  if (error) throw new Error(`Production offer-state unavailable: ${error.message}`);
  return mapEnrollmentState(data, now);
}

export function activeOfferAllowsClaims(state: OfferState): boolean {
  return state.offerPhase === 'free_pilot' && state.freePilotActive && state.status === 'open' &&
    state.capacityRemaining !== null && state.capacityRemaining > 0;
}

export function validOfferClaims(state: OfferState): string[] {
  if (!activeOfferAllowsClaims(state)) return [];
  return [
    ...(state.freePilotLimit === 100 ? ['100 位學員以前，每週專屬教材免費。'] : []),
    '目前免費開放中', '目前免費使用，免信用卡',
  ];
}

export function offerStrategy(state: OfferState) {
  return activeOfferAllowsClaims(state) ? {
    acquisitionAngle: 'current_free_access',
    conversionCapableFreeMentionShare: { min: 0.6, max: 0.7 },
    suggestedCtaMix: { none: 0.3, soft: 0.35, direct: 0.35 },
    directionalOnly: true,
  } : {
    acquisitionAngle: 'verified_product_value',
    conversionCapableFreeMentionShare: { min: 0, max: 0 },
    suggestedCtaMix: null,
    directionalOnly: true,
  };
}
