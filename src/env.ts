import 'dotenv/config';
import { z } from 'zod';

const bool = z.string().optional().transform((v) => v?.toLowerCase() === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DRY_RUN: bool,
  PAUSE_ALL_POSTING: bool,
  FACEBOOK_ENABLED: bool,
  INSTAGRAM_ENABLED: bool,
  THREADS_ENABLED: bool,
  PAPER_ENGLISH_BASE_URL: z.url().default('https://paperbond.jjmowlab.com'),
  OPENAI_API_KEY: z.string().optional(), SUPABASE_URL: z.url().optional(), SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  FACEBOOK_PAGE_ID: z.string().optional(), FACEBOOK_PAGE_ACCESS_TOKEN: z.string().optional(),
  INSTAGRAM_USER_ID: z.string().optional(), INSTAGRAM_ACCESS_TOKEN: z.string().optional(), INSTAGRAM_APP_ID: z.string().optional(), INSTAGRAM_APP_SECRET: z.string().optional(),
  THREADS_USER_ID: z.string().optional(), THREADS_ACCESS_TOKEN: z.string().optional(), THREADS_APP_ID: z.string().optional(), THREADS_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).optional(),
});
export type Environment = z.infer<typeof schema>;
export const env = schema.parse(process.env);
export function requireEnv<K extends keyof Environment>(key: K): NonNullable<Environment[K]> {
  const value = env[key];
  if (value === undefined || value === '') throw new Error(`Missing required environment variable: ${key}`);
  return value as NonNullable<Environment[K]>;
}
