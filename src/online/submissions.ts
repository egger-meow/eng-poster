import { getSupabase } from '../db/client.js';
import { queueOccupyingPostStatuses, type Platform, type PostStatus } from '../types.js';

export type OnlineSubmissionStatus = 'pending' | 'claimed' | 'accepted' | 'rejected' | 'failed';

export interface OnlineSubmissionRow {
  id: string;
  submissionKey: string;
  source: 'chatgpt-online';
  expectedGitSha: string;
  payload: unknown;
  targetDate: string | null;
  status: OnlineSubmissionStatus;
  attemptCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
}

export interface VerifiedQueuedPost {
  id: string;
  platform: Platform;
  scheduledFor: string;
  status: PostStatus;
  idempotencyKey: string;
  contentHash: string;
  offerGate: 'free_pilot_active' | null;
  mediaAssetId: string | null;
}

export interface OnlineSubmissionStore {
  claim(workerId: string, limit?: number, leaseMinutes?: number): Promise<OnlineSubmissionRow[]>;
  accept(id: string, result: Record<string, unknown>): Promise<void>;
  reject(id: string, code: string, message: string, result?: Record<string, unknown>): Promise<void>;
  technicalFailure(id: string, code: string, message: string, retryable: boolean): Promise<void>;
  verifyPlanPosts(planId: string): Promise<VerifiedQueuedPost[]>;
  list(limit?: number): Promise<OnlineSubmissionRow[]>;
  get(id: string): Promise<OnlineSubmissionRow | null>;
}

function checked<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

function mapRow(row: any): OnlineSubmissionRow {
  return {
    id: row.id,
    submissionKey: row.submission_key,
    source: row.source,
    expectedGitSha: row.expected_git_sha,
    payload: row.payload,
    targetDate: row.target_date ?? null,
    status: row.status,
    attemptCount: row.attempt_count ?? 0,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    result: row.result ?? null,
  };
}

export class OnlineSubmissionRepository implements OnlineSubmissionStore {
  constructor(private readonly db = getSupabase()) {}

  async claim(workerId: string, limit = 5, leaseMinutes = 10): Promise<OnlineSubmissionRow[]> {
    const { data, error } = await this.db.rpc('worker_claim_marketing_authoring_submissions', {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_minutes: leaseMinutes,
    });
    return (checked(data, error) ?? []).map(mapRow);
  }

  async accept(id: string, result: Record<string, unknown>): Promise<void> {
    const { error } = await this.db
      .from('marketing_authoring_submissions')
      .update({
        status: 'accepted',
        result,
        error_code: null,
        error_message: null,
        claimed_by: null,
        lease_token: null,
        lease_expires_at: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'claimed');
    checked(true, error);
  }

  async reject(id: string, code: string, message: string, result: Record<string, unknown> = {}): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('marketing_authoring_submissions')
      .update({
        status: 'rejected',
        result,
        error_code: code,
        error_message: message.slice(0, 2000),
        claimed_by: null,
        lease_token: null,
        lease_expires_at: null,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'claimed');
    checked(true, error);
  }

  async technicalFailure(id: string, code: string, message: string, retryable: boolean): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('marketing_authoring_submissions')
      .update({
        status: retryable ? 'pending' : 'failed',
        error_code: code,
        error_message: message.slice(0, 2000),
        claimed_by: null,
        lease_token: null,
        lease_expires_at: null,
        claimed_at: retryable ? null : undefined,
        finished_at: retryable ? null : now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'claimed');
    checked(true, error);
  }

  async verifyPlanPosts(planId: string): Promise<VerifiedQueuedPost[]> {
    const { data, error } = await this.db
      .from('marketing_posts')
      .select('id, platform, scheduled_for, status, idempotency_key, content_hash, offer_gate, media_asset_id')
      .eq('content_plan_id', planId)
      .in('status', queueOccupyingPostStatuses)
      .order('scheduled_for', { ascending: true })
      .order('id', { ascending: true });
    const rows = checked(data, error) ?? [];
    return rows.map((row: any) => ({
      id: row.id,
      platform: row.platform,
      scheduledFor: row.scheduled_for,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      contentHash: row.content_hash,
      offerGate: row.offer_gate ?? null,
      mediaAssetId: row.media_asset_id ?? null,
    }));
  }

  async list(limit = 50): Promise<OnlineSubmissionRow[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const { data, error } = await this.db
      .from('marketing_authoring_submissions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    return (checked(data, error) ?? []).map(mapRow);
  }

  async get(id: string): Promise<OnlineSubmissionRow | null> {
    const { data, error } = await this.db
      .from('marketing_authoring_submissions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    const value = checked(data, error);
    return value ? mapRow(value) : null;
  }
}
