import { readFile } from 'node:fs/promises';
import { structured } from '../ai/openai.js';
import type { GeneratedVariant } from './generator.js';
import type { ResearchSnapshot } from '../types.js';

const schema = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    repairedCopy: { type: ['string', 'null'] },
  },
  required: ['approved', 'issues', 'repairedCopy'],
  additionalProperties: false,
};

export async function criticize(
  variant: GeneratedVariant,
  research: ResearchSnapshot,
  model: string,
  criticPrompt?: string
): Promise<{ approved: boolean; issues: string[]; repairedCopy: string | null }> {
  const instructions =
    criticPrompt ??
    (await readFile('prompts/critic.md', 'utf8').catch(
      () =>
        'Reject unsupported claims, source mismatch, fake urgency, repetitive/generic prose, platform mismatch, weak first lines, or promotional imbalance. A repair may remove or soften claims but never fabricate support.'
    ));

  return structured({
    model,
    name: 'content_critic',
    schema,
    instructions,
    input: JSON.stringify({ variant, research }),
  });
}

