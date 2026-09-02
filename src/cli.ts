#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';

import { platforms, type Platform } from './types.js';
import { enqueuePlan } from './orchestration/enqueue-plan.js';
import { checkQueueHealth } from './orchestration/queue-health.js';
import { findNextQueueGap } from './orchestration/next-queue-gap.js';
import { dispatchDue } from './orchestration/dispatch-due.js';
import { tokenHealth } from './orchestration/token-health.js';
import { ingestAssets } from './media/ingest.js';
import { dryRun } from './orchestration/dry-run.js';
import { BufferClient, publisherFor } from './platforms/index.js';
import { env } from './env.js';
import { MarketingRepository } from './db/repository.js';

const program = new Command().name('social').description('Paper English organic social engine');

program
  .command('next-queue-gap')
  .description('Find the earliest future queue gap date and missing platform slots within the stockpile horizon')
  .option('--days <days>', 'Stockpile horizon in days to inspect', '14')
  .action(async (o) => {
    console.log(JSON.stringify(await findNextQueueGap({ horizonDays: Number(o.days) }), null, 2));
  });

program
  .command('enqueue-plan')
  .requiredOption('--input <jsonOrPath>', 'JSON string or path to JSON file containing plan payload')
  .action(async (o) => {
    let raw = o.input;
    try {
      raw = await readFile(o.input, 'utf8');
    } catch {
      // Inline JSON string
    }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    console.log(JSON.stringify(await enqueuePlan(data), null, 2));
  });

program
  .command('queue-health')
  .option('--hours <hours>', 'Hours ahead to inspect schedule', '336')
  .action(async (o) => {
    console.log(JSON.stringify(await checkQueueHealth(Number(o.hours)), null, 2));
  });

program
  .command('dispatch-due')
  .action(async () => console.log(JSON.stringify(await dispatchDue(), null, 2)));

program
  .command('token-health')
  .action(async () => console.log(JSON.stringify(await tokenHealth(), null, 2)));

program
  .command('buffer-channels')
  .description('Discover connected Buffer organizations and channels')
  .action(async () => {
    const client = new BufferClient();
    const channels = await client.getChannels();
    const safeOutput = channels.map((ch) => ({
      channelId: ch.id,
      name: ch.name,
      service: ch.service,
      displayName: ch.displayName ?? null,
      organizationId: ch.organizationId ?? null,
      organizationName: ch.organizationName ?? null,
      isDisconnected: ch.isDisconnected ?? false,
      isLocked: ch.isLocked ?? false,
    }));
    console.log(JSON.stringify(safeOutput, null, 2));
  });

program
  .command('ingest-assets')
  .option('--root <path>', 'Directory root to ingest assets from')
  .action(async (o) =>
    console.log(JSON.stringify({ ingested: await ingestAssets(o.root ? [o.root] : undefined) }, null, 2))
  );

program
  .command('dry-run')
  .requiredOption('--platform <platform>')
  .option('--media-url <url>', 'Optional media URL for previewing media validations')
  .action((o) => {
    if (!platforms.includes(o.platform)) throw new Error('Invalid platform');
    console.log(JSON.stringify(dryRun(o.platform as Platform, o.mediaUrl), null, 2));
  });

program
  .command('publish-test')
  .requiredOption('--platform <platform>')
  .option('--confirm-live')
  .option('--media-url <url>', 'Explicit public media URL')
  .action(async (o) => {
    if (!platforms.includes(o.platform)) throw new Error('Invalid platform');
    if (!o.confirmLive) throw new Error('Live smoke requires --confirm-live');
    if (env.DRY_RUN) throw new Error('Set DRY_RUN=false for an explicit live smoke');
    if (env.PAUSE_ALL_POSTING) throw new Error('Set PAUSE_ALL_POSTING=false for an explicit live smoke');

    let mediaUrl: string | null = o.mediaUrl ?? null;
    let mediaAssetId: string | null = null;

    if (!mediaUrl && o.platform === 'instagram') {
      const repo = new MarketingRepository();
      const assets = await repo.availableAssets('instagram', new Date(0).toISOString());
      if (assets.length > 0) {
        mediaUrl = assets[0]!.publicUrl;
        mediaAssetId = assets[0]!.id;
      } else {
        throw new Error(
          'Instagram publish-test requires a registered public media asset or an explicit --media-url <url>'
        );
      }
    }

    const sample = dryRun(o.platform as Platform, mediaUrl);
    if (mediaAssetId) sample.post.mediaAssetId = mediaAssetId;
    if (!sample.validation.valid) throw new Error(sample.validation.errors.join('; '));

    console.log(JSON.stringify(await publisherFor(o.platform as Platform).publish(sample.post), null, 2));
  });

await program.parseAsync();
