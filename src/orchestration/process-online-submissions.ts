import { execFileSync } from 'node:child_process';
import { enqueuePlan, enqueuePlanSchema, type EnqueueResult } from './enqueue-plan.js';
import {
  OnlineSubmissionRepository,
  type OnlineSubmissionStore,
} from '../online/submissions.js';

export interface ProcessOnlineSubmissionsResult {
  claimed: number;
  accepted: number;
  rejected: number;
  failed: number;
  retried: number;
}

type EnqueueFn = (input: unknown) => Promise<EnqueueResult>;

export interface ProcessOnlineSubmissionsOptions {
  store?: OnlineSubmissionStore;
  enqueue?: EnqueueFn;
  gitSha?: string;
  workerId?: string;
  limit?: number;
  leaseMinutes?: number;
  maxAttempts?: number;
}

function resolveGitSha(): string {
  const fromEnv = process.env.GITHUB_SHA ?? process.env.ENG_POSTER_GIT_SHA;
  if (fromEnv && /^[0-9a-f]{40}$/i.test(fromEnv)) return fromEnv.toLowerCase();
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase();
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error('Unable to determine worker Git SHA');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyOnlineAuthoringError(message: string): { code: string; deterministic: boolean } {
  if (/daily cap|weekly cap|slot.*filled|already.*occup/i.test(message)) {
    return { code: 'QUEUE_SLOT_ALREADY_FILLED', deterministic: true };
  }
  if (/offer phase expired|offer gate|offer.*does not allow|expired offer|winning signals/i.test(message)) {
    return { code: 'INVALID_OFFER_STATE', deterministic: true };
  }
  if (/instagram.*media|requires media|invalid asset|asset cooldown/i.test(message)) {
    return { code: 'INVALID_ASSET', deterministic: true };
  }
  if (/researched claim|unsupported.*claim|invalid claim/i.test(message)) {
    return { code: 'INVALID_CLAIM', deterministic: true };
  }
  if (/post validation failed|copy is empty|copy.*exceed|canonical paper english|main[- ]body|generic ai/i.test(message)) {
    return { code: 'INVALID_COPY', deterministic: true };
  }
  if (/invalid plan payload/i.test(message)) {
    return { code: 'INVALID_PLAN_SCHEMA', deterministic: true };
  }
  return { code: 'TECHNICAL_FAILURE', deterministic: false };
}

export async function processOnlineSubmissions(
  options: ProcessOnlineSubmissionsOptions = {}
): Promise<ProcessOnlineSubmissionsResult> {
  const store = options.store ?? new OnlineSubmissionRepository();
  const enqueue = options.enqueue ?? enqueuePlan;
  const gitSha = (options.gitSha ?? resolveGitSha()).toLowerCase();
  const workerId = options.workerId ?? 'chatgpt-online-worker';
  const limit = options.limit ?? 5;
  const leaseMinutes = options.leaseMinutes ?? 10;
  const maxAttempts = options.maxAttempts ?? 3;

  const claimedRows = await store.claim(workerId, limit, leaseMinutes);
  const summary: ProcessOnlineSubmissionsResult = {
    claimed: claimedRows.length,
    accepted: 0,
    rejected: 0,
    failed: 0,
    retried: 0,
  };

  for (const row of claimedRows) {
    if (row.expectedGitSha.toLowerCase() !== gitSha) {
      await store.reject(
        row.id,
        'STALE_GIT_SHA',
        `Submission expected ${row.expectedGitSha} but worker is ${gitSha}`,
        { expectedGitSha: row.expectedGitSha, workerGitSha: gitSha }
      );
      summary.rejected++;
      continue;
    }

    const parsed = enqueuePlanSchema.safeParse(row.payload);
    if (!parsed.success) {
      await store.reject(
        row.id,
        'INVALID_PLAN_SCHEMA',
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        { targetDate: row.targetDate }
      );
      summary.rejected++;
      continue;
    }

    try {
      const result = await enqueue(parsed.data);

      if (result.enqueued === 0 && result.skipped > 0) {
        await store.reject(
          row.id,
          'QUEUE_SLOT_ALREADY_FILLED',
          result.errors.join('; ') || 'No candidate posts were enqueued because the target capacity is no longer available',
          { targetDate: parsed.data.planDate, enqueueResult: result }
        );
        summary.rejected++;
        continue;
      }

      const verifiedPosts = await store.verifyPlanPosts(result.planId);
      if (verifiedPosts.length < result.enqueued) {
        const message = `Read-after-write found ${verifiedPosts.length} queue rows for ${result.enqueued} newly enqueued posts`;
        const retryable = row.attemptCount < maxAttempts;
        await store.technicalFailure(row.id, 'READ_AFTER_WRITE_FAILED', message, retryable);
        if (retryable) summary.retried++;
        else summary.failed++;
        continue;
      }

      await store.accept(row.id, {
        targetDate: parsed.data.planDate,
        planId: result.planId,
        postIds: verifiedPosts.map((post) => post.id),
        postCount: verifiedPosts.length,
        platforms: verifiedPosts.map((post) => post.platform),
        enqueueResult: result,
      });
      summary.accepted++;
    } catch (error) {
      const message = errorMessage(error);
      const classification = classifyOnlineAuthoringError(message);
      if (classification.deterministic) {
        await store.reject(row.id, classification.code, message, { targetDate: parsed.data.planDate });
        summary.rejected++;
        continue;
      }

      const retryable = row.attemptCount < maxAttempts;
      await store.technicalFailure(row.id, classification.code, message, retryable);
      if (retryable) summary.retried++;
      else summary.failed++;
    }
  }

  return summary;
}
