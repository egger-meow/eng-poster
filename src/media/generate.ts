import { readFile } from 'node:fs/promises';
import { getOpenAI } from '../ai/openai.js';
import { getSupabase } from '../db/client.js';
import { MarketingRepository } from '../db/repository.js';
import { newId, sha256 } from '../shared/hash.js';
import type { AssetRecord, Platform } from '../types.js';
import { inspectImage } from './validate.js';

export async function generateImage(prompt: string, model: string, quality: 'low' | 'medium' | 'high'): Promise<Buffer> {
  const result = await getOpenAI().images.generate({
    model,
    prompt,
    quality,
    size: '1024x1024',
  } as any);
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image API returned no image');
  return Buffer.from(b64, 'base64');
}

export async function generateAndStoreAsset(input: {
  concept: string;
  platform: Platform;
  model: string;
  quality: 'low' | 'medium' | 'high';
  imagePromptGuide?: string;
}): Promise<AssetRecord> {
  const guide =
    input.imagePromptGuide ??
    (await readFile('prompts/image-prompt.md', 'utf8').catch(() => 'Warm modern editorial illustration.'));

  const prompt = `Style guide: ${guide}. Objective: organic English-learning social visual. Audience: Taiwan parents and grade 5-8 students. Core concept: ${input.concept}. Composition: one clear editorial illustration, generous negative space. Mood: energetic and trustworthy. Brand constraints: warm paper texture, navy and coral accents. Text overlay: none. Avoid: Traditional Chinese text inside image, English text inside image, logos, copyrighted characters, fake product UI, fake screenshots, student personal data. Aspect ratio: square.`;

  const bytes = await generateImage(prompt, input.model, input.quality);
  const meta = await inspectImage(bytes);
  const hash = sha256(bytes);
  const path = `generated/${hash}.png`;
  const db = getSupabase();

  const { error } = await db.storage
    .from('marketing-media')
    .upload(path, bytes, { contentType: meta.mime, upsert: false });
  if (error && !/already exists|Duplicate/i.test(error.message)) throw error;

  const asset: AssetRecord = {
    id: newId(),
    source: 'ai_generated',
    contentHash: hash,
    storagePath: path,
    publicUrl: db.storage.from('marketing-media').getPublicUrl(path).data.publicUrl,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    topics: [input.concept],
    audience: ['parents', 'students'],
    allowedPlatforms: [input.platform],
    reuse: true,
    priority: 0,
    concept: input.concept,
    usageCount: 0,
    lastUsedAt: null,
  };

  await new MarketingRepository(db).upsertAsset(asset);
  return asset;
}

