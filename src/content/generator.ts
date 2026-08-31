import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { structured } from '../ai/openai.js';
import type { Claim, Platform, ResearchSnapshot } from '../types.js';

export interface GeneratedVariant {
  platform: Platform;
  copyText: string;
  claims: Claim[];
  needsMedia: boolean;
  visualConcept: string;
}

export interface GenerateVariantsInput {
  topic: string;
  archetype: string;
  research: ResearchSnapshot;
  brand: string;
  product: string;
  claims: string;
  voice: string;
  audience?: string;
  writerPrompt?: string;
  visualPlannerPrompt?: string;
  ctaMode?: 'none' | 'soft' | 'direct';
  model: string;
  examples?: Partial<Record<Platform, string[]>>;
}


const schema = {
  type: 'object',
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['facebook', 'instagram', 'threads'] },
          copyText: { type: 'string' },
          claims: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                kind: { type: 'string', enum: ['brand_fact', 'researched_fact', 'opinion', 'rhetorical'] },
                sourceUrls: { type: 'array', items: { type: 'string' } },
              },
              required: ['text', 'kind', 'sourceUrls'],
              additionalProperties: false,
            },
          },
          needsMedia: { type: 'boolean' },
          visualConcept: { type: 'string' },
        },
        required: ['platform', 'copyText', 'claims', 'needsMedia', 'visualConcept'],
        additionalProperties: false,
      },
    },
  },
  required: ['variants'],
  additionalProperties: false,
};

async function loadPlatformExamples(platform: Platform, maxCount = 3): Promise<string[]> {
  const dir = `knowledge/examples/${platform}`;
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith('.md') && f !== 'README.md');
    const loaded: string[] = [];
    for (const file of mdFiles.slice(0, maxCount)) {
      const content = await readFile(join(dir, file), 'utf8');
      if (content.trim()) loaded.push(content.trim());
    }
    return loaded;
  } catch {
    return [];
  }
}

export async function generateVariants(input: GenerateVariantsInput): Promise<GeneratedVariant[]> {
  const writerPrompt = input.writerPrompt ?? (await readFile('prompts/writer.md', 'utf8').catch(() => ''));
  const visualPlannerPrompt =
    input.visualPlannerPrompt ?? (await readFile('prompts/visual-planner.md', 'utf8').catch(() => ''));
  const audience = input.audience ?? (await readFile('knowledge/audience.md', 'utf8').catch(() => ''));

  const fbExamples = input.examples?.facebook ?? (await loadPlatformExamples('facebook'));
  const igExamples = input.examples?.instagram ?? (await loadPlatformExamples('instagram'));
  const thExamples = input.examples?.threads ?? (await loadPlatformExamples('threads'));

  const instructions = [
    writerPrompt,
    '\n## VISUAL PLANNING INSTRUCTIONS',
    visualPlannerPrompt,
    '\n## BRAND VOICE & CONSTRAINTS',
    input.voice,
    '\n## TARGET AUDIENCE',
    audience,
    '\n## BRAND CAPABILITIES & PRODUCT',
    input.product,
    '\n## BRAND IDENTITY & CANONICAL FACTS',
    input.brand,
    '\n## CLAIMS RULES',
    input.claims,
    '\n## REFERENCE EXAMPLES',
    `Facebook examples (${fbExamples.length}):\n${fbExamples.join('\n---\n') || 'None provided'}`,
    `Instagram examples (${igExamples.length}):\n${igExamples.join('\n---\n') || 'None provided'}`,
    `Threads examples (${thExamples.length}):\n${thExamples.join('\n---\n') || 'None provided'}`,
    input.ctaMode ? `\nCTA Strategy for this generation: ${input.ctaMode}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');


  const r = await structured<{ variants: GeneratedVariant[] }>({
    model: input.model,
    name: 'platform_variants',
    schema,
    instructions,
    input: JSON.stringify({
      topic: input.topic,
      archetype: input.archetype,
      research: input.research,
      ctaMode: input.ctaMode ?? 'soft',
    }),
  });

  return r.variants;
}

