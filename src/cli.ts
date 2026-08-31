#!/usr/bin/env node
import { Command } from 'commander'; import { platforms,type Platform } from './types.js'; import { planDay } from './orchestration/plan-day.js'; import { dispatchDue } from './orchestration/dispatch-due.js'; import { tokenHealth } from './orchestration/token-health.js'; import { ingestAssets } from './media/ingest.js'; import { dryRun } from './orchestration/dry-run.js'; import { publisherFor } from './platforms/index.js'; import { env } from './env.js';
const program=new Command().name('social').description('Paper English organic social engine');
program.command('plan-day').requiredOption('--date <YYYY-MM-DD>').action(async o=>console.log(JSON.stringify(await planDay(o.date),null,2)));
program.command('dispatch-due').action(async()=>console.log(JSON.stringify(await dispatchDue(),null,2)));
program.command('token-health').action(async()=>console.log(JSON.stringify(await tokenHealth(),null,2)));
program.command('ingest-assets').action(async()=>console.log(JSON.stringify({ingested:await ingestAssets()},null,2)));
program.command('dry-run').requiredOption('--platform <platform>').action(o=>{if(!platforms.includes(o.platform))throw new Error('Invalid platform');console.log(JSON.stringify(dryRun(o.platform as Platform),null,2));});
program.command('publish-test').requiredOption('--platform <platform>').option('--confirm-live').action(async o=>{if(!platforms.includes(o.platform))throw new Error('Invalid platform');if(!o.confirmLive)throw new Error('Live smoke requires --confirm-live');if(env.DRY_RUN)throw new Error('Set DRY_RUN=false for an explicit live smoke');if(env.PAUSE_ALL_POSTING)throw new Error('Set PAUSE_ALL_POSTING=false for an explicit live smoke');const sample=dryRun(o.platform as Platform);if(!sample.validation.valid)throw new Error(sample.validation.errors.join('; '));console.log(JSON.stringify(await publisherFor(o.platform as Platform).publish(sample.post),null,2));});
await program.parseAsync();
