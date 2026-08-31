import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from '../env.js';
let singleton: SupabaseClient | undefined;
export function getSupabase(): SupabaseClient {
  singleton ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  return singleton;
}
