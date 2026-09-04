import { execFileSync } from 'node:child_process';
import { enqueuePlan, enqueuePlanSchema, type EnqueueResult } from './enqueue-plan.js';
import { sha256 } from '../shared/hash.js';
import {
  OnlineSubmissionRepository,
  type CandidateContentIdentity,
  type OnlineSubmissionStore,
  type VerifiedQueuedPost,
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

function candidateIdentities(posts: Array<{ platform: CandidateContentIdentity['platform']; copyText: string }>): CandidateContentIdentity[] {
  return posts.map((post) => ({ platform: post.platform, contentHash: sha256(post.copyText) }));
}

function matchingCandidatePosts(
  expected: CandidateContentIdentity[],
  actual: VerifiedQueuedPost[]
): VerifiedQueuedPost[] {
  const remaining = [...actual];
  const matches: VerifiedQueuedPost[] = [];
  for (const candidate of expected) {
    const index = remaining.findIndex(
      (post) => post.platform === candidate.platform && post.contentHash === candidate.contentHash
    );
    if (index < 0) continue;
    matches.push(remaining[index]!);
    remaining.splice(index, 1);
  }
  return matches;
}

function acceptedResult(
  targetDate: string,
  matches: VerifiedQueuedPost[],
  enqueueResult?: EnqueueResult,
  recovered = false
): Record<string, unknown> {
  const planIds = Array.from(new Set(matches.map((post) => post.contentPlanId)));
  return {
    targetDate,
    planId: planIds.length === 1 ? planIds[0] : enqueueResult?.planId ?? null,
    postIds: matches.map((post) => post.id),
    postCount: matches.length,
    platforms: matches.map((post) => post.platform),
    recovered,
    ...(enqueueResult ? { enqueueResult } : {}),
  };
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

    const expected = candidateIdentities(parsed.data.posts);

    try {
      // A lease recovery can happen after enqueue writes but before the submission was marked accepted.
      // Recover exact platform+content-hash matches first so a retry never creates a duplicate post.
      if (row.attemptCount > 1) {
        const existing = await store.findCandidatePosts(parsed.data.planDate, expected);
        const matches = matchingCandidatePosts(expected, existing);
        if (matches.length === expected.length) {
          await store.accept(row.id, acceptedResult(parsed.data.planDate, matches, undefined, true));
          summary.accepted++;
          continue;
        }
        if (matches.length > 0) {
          await store.reject(
            row.id,
            'AMBIGUOUS_PARTIAL_ENQUEUE',
            `Recovered ${matches.length}/${expected.length} exact candidate posts; refusing automatic retry to avoid duplicate queue writes`,
            acceptedResult(parsed.data.planDate, matches, undefined, true)
          );
          summary.rejected++;
          continue;
        }
      }

      const result = await enqueue(parsed.data);
      const verifiedPosts = await store.verifyPlanPosts(result.planId);
      const matches = matchingCandidatePosts(expected, verifiedPosts);

      if (matches.length === expected.length) {
        await store.accept(
          row.id,
          acceptedResult(parsed.data.planDate, matches, result, result.enqueued === 0)
        );
        summary.accepted++;
        continue;
      }

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

      const message = `Read-after-write matched ${matches.length}/${expected.length} exact candidate posts`;
      // Once enqueue has started, an ambiguous technical retry could duplicate a partially-written plan.
      // Fail closed. Lease retries are safe only when the exact candidate can be recovered above.
      await store.technicalFailure(row.id, 'READ_AFTER_WRITE_FAILED', message, false);
      summary.failed++;
    } catch (error) {
      const message = errorMessage(error);
      const classification = classifyOnlineAuthoringError(message);
      if (classification.deterministic) {
        await store.reject(row.id, classification.code, message, { targetDate: parsed.data.planDate });
        summary.rejected++;
        continue;
      }

      // Unknown failures from inside enqueue are potentially ambiguous because enqueuePlan performs real writes.
      // Do not blindly retry them. A worker crash before enqueue is naturally recovered by the lease; a crash
      // after writes is recovered on the next claim by the exact content-hash lookup above.
      const retryable = false;
      await store.technicalFailure(row.id, classification.code, message, retryable);
      if (retryable && row.attemptCount < maxAttempts) summary.retried++;
      else summary.failed++;
    }
  }

  return summary;
}
