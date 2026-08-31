import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { z } from 'zod';

const windowSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/);
const platformSchema = z.object({
  enabled: z.boolean(),
  postsPerDay: z.number().int().positive().optional(),
  postsPerWeek: z.number().int().positive().optional(),
  preferredDays: z.array(z.string()).optional(),
  windows: z.array(windowSchema).min(1),
  hardDailyCap: z.number().int().positive(),
});

export const configSchema = z.object({
  version: z.string().default('v0'),
  timezone: z.string().default('Asia/Taipei'),
  websiteBaseUrl: z.string().url(),
  platforms: z.object({
    facebook: platformSchema,
    instagram: platformSchema,
    threads: platformSchema,
  }),
  contentMix: z.record(z.string(), z.number().min(0).max(1)),
  cta: z.record(z.string(), z.number().min(0).max(1)),
  media: z.object({
    exactAssetCooldownDays: z.number().int(),
    visualConceptCooldownDays: z.number().int(),
  }),
  retries: z.object({
    maxPublishAttempts: z.number().int().positive(),
    maxAuthoringRepairs: z.number().int().min(0),
    leaseMinutes: z.number().int().positive(),
  }),
  utm: z.object({ medium: z.literal('organic_social') }),
});

export type AppConfig = z.infer<typeof configSchema>;

export async function loadConfig(path = 'config/production.yaml'): Promise<AppConfig> {
  return configSchema.parse(YAML.parse(await readFile(path, 'utf8')));
}

