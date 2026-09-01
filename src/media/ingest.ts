import { access, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, normalize } from 'node:path';

import YAML from 'yaml';
import { getSupabase } from '../db/client.js';
import { MarketingRepository } from '../db/repository.js';
import { newId, sha256 } from '../shared/hash.js';
import type { AssetRecord, AssetSource, Platform } from '../types.js';
import { inspectImage } from './validate.js';

async function exists(dir: string): Promise<boolean> {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (/\.(png|jpe?g|webp)$/i.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function extractTopicsFromFilename(name: string): string[] {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
    return ['general'];
  }
  const parts = name
    .split(/[-_ ]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 1 && !/^[0-9a-f]{6,}$/i.test(p));
  return parts.length > 0 ? parts : ['general'];
}

export function determineAssetSource(filePath: string): AssetSource {
  const norm = normalize(filePath).replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/fallback/') || norm.startsWith('assets/fallback')) {
    return 'fallback';
  }
  if (norm.includes('/manual/product/') || norm.includes('/product/')) {
    return 'screenshot';
  }
  return 'manual';
}

export async function ingestAssets(roots: string[] | string = ['assets/manual', 'assets/fallback']): Promise<number> {
  const repo = new MarketingRepository();
  const db = getSupabase();
  const rootList = Array.isArray(roots) ? roots : [roots];
  let count = 0;

  for (const root of rootList) {
    for (const file of await walk(root)) {
      const bytes = await readFile(file);
      const meta = await inspectImage(bytes);
      const hash = sha256(bytes);
      const side = file.slice(0, -extname(file).length) + '.yaml';

      let md: any = {};
      try {
        md = YAML.parse(await readFile(side, 'utf8')) ?? {};
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }

      const source = md.source ?? determineAssetSource(file);
      const storagePath = `${source}/${hash.slice(0, 2)}/${hash}-${basename(file)}`;
      const { error } = await db.storage
        .from('marketing-media')
        .upload(storagePath, bytes, { contentType: meta.mime, upsert: false });

      if (error && !/already exists|Duplicate/i.test(error.message)) {
        throw error;
      }

      const publicUrl = db.storage.from('marketing-media').getPublicUrl(storagePath).data.publicUrl;
      const asset: AssetRecord = {
        id: newId(),
        source,
        contentHash: hash,
        storagePath,
        publicUrl,
        width: meta.width,
        height: meta.height,
        format: meta.format,
        topics: md.topics ?? extractTopicsFromFilename(basename(file, extname(file))),
        audience: md.audience ?? ['parents', 'students'],
        allowedPlatforms: (md.platforms ?? ['facebook', 'instagram', 'threads']) as Platform[],
        reuse: md.reuse ?? true,
        priority: md.priority ?? (source === 'fallback' ? -10 : 0),
        concept: md.concept ?? null,
        expiresAt: md.expires_at ?? null,
        usageCount: 0,
        lastUsedAt: null,
      };

      await repo.upsertAsset(asset);
      count++;
    }
  }

  return count;
}

