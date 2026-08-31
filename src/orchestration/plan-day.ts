import { readFile } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { loadConfig } from '../config.js';
import { criticize } from '../content/critic.js';
import { generateVariants } from '../content/generator.js';
import { validatePreparedPost } from '../content/gates.js';
import { chooseSlot } from '../content/schedule.js';
import { attributedUrl } from '../content/utm.js';
import { MarketingRepository } from '../db/repository.js';
import { generateAndStoreAsset } from '../media/generate.js';
import { selectAsset } from '../media/select.js';
import { researchTopic } from '../research/researcher.js';
import { idempotencyKey, newId, sha256 } from '../shared/hash.js';
import type { Platform, PreparedPost, ResearchSnapshot } from '../types.js';

const read=(path:string)=>readFile(path,'utf8');
export async function planDay(date:string):Promise<{planned:number;scheduled:Record<Platform,number>;fallbacks:number}> {
  const config=await loadConfig(),repo=new MarketingRepository(),occupied=new Set<string>();
  const scheduled:Record<Platform,number>={facebook:0,instagram:0,threads:0}; let fallbacks=0,planned=0;
  const knowledge=await Promise.all(['brand','product','claims','voice'].map(name=>read(`knowledge/${name}.md`)));
  const [brand,product,claims,voice]=[knowledge[0]!,knowledge[1]!,knowledge[2]!,knowledge[3]!];
  const prompts=await Promise.all(['research','planner','writer','critic','visual-planner','image-prompt'].map(name=>read(`prompts/${name}.md`)));
  for(const topic of ['台灣家長最近關心的英文學習問題與可信建議','學生興趣如何安全轉化為英文閱讀練習']) {
    let research:ResearchSnapshot;
    try { research=await researchTopic(topic,config.models.text); }
    catch { research={query:topic,sources:[],factualNotes:[]}; fallbacks++; }
    const archetype=research.sources.length?'timely_topic':'pain_point';
    const planId=await repo.createPlan({planDate:date,archetype,topic,audience:'Taiwan parents grade 5-8',campaignSlug:'always-on',research,provenance:{engineVersion:'0.1.0',plannerPromptVersion:'planner-v1',writerPromptVersion:'writer-v1',criticPromptVersion:'critic-v1',visualPromptVersion:'visual-v1',promptHash:sha256(prompts.join('\n')),configVersion:config.version,configHash:sha256(JSON.stringify(config)),knowledgeHash:sha256(brand+product+claims+voice),textModel:config.models.text,imageModel:config.models.image,generationTimestamp:new Date().toISOString()}});
    const variants=await generateVariants({topic,archetype,research,brand,product,claims,voice,model:config.models.text});
    for(const variant of variants) {
      const platform=variant.platform,cfg=config.platforms[platform]; if(!cfg.enabled)continue;
      const weekday=DateTime.fromISO(date,{zone:config.timezone}).toFormat('ccc').toLowerCase().slice(0,3);
      const target=cfg.postsPerDay??(cfg.preferredDays?.includes(weekday)?1:0); if(scheduled[platform]>=Math.min(target,cfg.hardDailyCap))continue;
      const critique=await criticize(variant,research,config.models.text); if(!critique.approved){if(critique.repairedCopy)variant.copyText=critique.repairedCopy;else continue;}
      let asset=(variant.needsMedia||platform==='instagram')?await selectAsset(platform,[variant.visualConcept],config.media.exactAssetCooldownDays):undefined;
      if(!asset&&(variant.needsMedia||platform==='instagram')&&config.media.aiGenerationEnabled){for(let attempt=0;attempt<config.media.maxGenerationAttempts&&!asset;attempt++){try{asset=await generateAndStoreAsset({concept:variant.visualConcept,platform,model:config.media.aiModel,quality:config.media.defaultQuality});}catch{fallbacks++;}}}
      if(platform==='instagram'&&!asset){fallbacks++;continue;}
      const postId=newId(),window=cfg.windows[scheduled[platform]%cfg.windows.length]!;
      const post:PreparedPost={id:postId,contentPlanId:planId,platform,copyText:variant.copyText,destinationUrl:attributedUrl(config.websiteBaseUrl,platform,'always-on',postId),mediaUrl:asset?.publicUrl??null,mediaAssetId:asset?.id??null,scheduledFor:chooseSlot(date,window,config.timezone,occupied),idempotencyKey:idempotencyKey(date,platform,String(scheduled[platform]+1),planId),campaignSlug:'always-on',claimManifest:variant.claims};
      if(!validatePreparedPost(post).valid)continue; await repo.schedule(post,sha256(post.copyText)); scheduled[platform]++; planned++;
    }
  }
  return {planned,scheduled,fallbacks};
}
