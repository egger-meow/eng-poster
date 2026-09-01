import 'dotenv/config';
import { z } from 'zod';

const boolDefaultTrue = z
  .preprocess((v) => (v === undefined || v === null || v === '' ? 'true' : String(v)), z.string())
  .transform((v) => v.toLowerCase() === 'true');

const boolDefaultFalse = z
  .preprocess((v) => (v === undefined || v === null || v === '' ? 'false' : String(v)), z.string())
  .transform((v) => v.toLowerCase() === 'true');

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional()
);

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional()
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DRY_RUN: boolDefaultTrue,
  PAUSE_ALL_POSTING: boolDefaultTrue,
  FACEBOOK_ENABLED: boolDefaultFalse,
  INSTAGRAM_ENABLED: boolDefaultFalse,
  THREADS_ENABLED: boolDefaultFalse,
  PAPER_ENGLISH_BASE_URL: z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? 'https://paperbond.jjmowlab.com' : v), z.string().url().default('https://paperbond.jjmowlab.com')),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  BUFFER_API_KEY: optionalString,
  BUFFER_FACEBOOK_CHANNEL_ID: optionalString,
  BUFFER_INSTAGRAM_CHANNEL_ID: optionalString,
  BUFFER_THREADS_CHANNEL_ID: optionalString,
});

export type Environment = z.infer<typeof schema>;
export const env = schema.parse(process.env);

export function requireEnv<K extends keyof Environment>(key: K): NonNullable<Environment[K]> {
  const raw = process.env[key];
  const value = raw !== undefined && raw !== '' ? raw : env[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value as NonNullable<Environment[K]>;
}
