import { describe, expect, it, vi } from 'vitest';
import { processOnlineSubmissions } from '../src/orchestration/process-online-submissions.js';
import type { OnlineSubmissionRow, OnlineSubmissionStore } from '../src/online/submissions.js';

const SHA = '0002943a0172500b4f5c778f23285e858da0dcd1';

function payload() {
  return {
    planDate: '2026-09-05',
    archetype: 'educational_value',
    topic: '英文閱讀',
    posts: [
      {
        platform: 'threads',
        assetMode: 'text_only',
        copyText: '孩子看到英文長文就直接放空。💀',
        claimManifest: [],
      },
    ],
  };
}

function row(overrides: Partial<OnlineSubmissionRow> = {}): OnlineSubmissionRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    submissionKey: 'key',
    source: 'chatgpt-online',
    expectedGitSha: SHA,
    payload: payload(),
    targetDate: '2026-09-05',
    status: 'claimed',
    attemptCount: 1,
    ...overrides,
  };
}

function storeFixture(rows: OnlineSubmissionRow[] = [row()]) {
  const store: OnlineSubmissionStore = {
    claim: vi.fn(async () => rows),
    accept: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    technicalFailure: vi.fn(async () => undefined),
    verifyPlanPosts: vi.fn(async () => [
      {
        id: '22222222-2222-4222-8222-222222222222',
        platform: 'threads',
        scheduledFor: '2026-09-05T12:00:00.000Z',
        status: 'scheduled',
        idempotencyKey: '2026-09-05:threads:1',
        offerGate: null,
        mediaAssetId: null,
      },
    ]),
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
  };
  return store;
}

describe('processOnlineSubmissions', () => {
  it('rejects a candidate authored against a different git SHA before enqueue', async () => {
    const store = storeFixture([row({ expectedGitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })]);
    const enqueue = vi.fn();
    const result = await processOnlineSubmissions({ store, enqueue, gitSha: SHA });
    expect(result).toMatchObject({ claimed: 1, accepted: 0, rejected: 1, failed: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.reject).toHaveBeenCalledWith(expect.any(String), 'STALE_GIT_SHA', expect.stringContaining(SHA), expect.any(Object));
  });

  it('reuses the current enqueue path and accepts only after read-after-write verification', async () => {
    const store = storeFixture();
    const enqueue = vi.fn(async () => ({ planId: 'plan-id', enqueued: 1, scheduled: { facebook: 0, instagram: 0, threads: 1 }, skipped: 0, errors: [] }));
    const result = await processOnlineSubmissions({ store, enqueue, gitSha: SHA });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(store.verifyPlanPosts).toHaveBeenCalledWith('plan-id');
    expect(store.accept).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ planId: 'plan-id', postCount: 1, postIds: ['22222222-2222-4222-8222-222222222222'] }));
    expect(result).toMatchObject({ accepted: 1, rejected: 0, failed: 0 });
  });

  it('rejects invalid schema without calling enqueue', async () => {
    const store = storeFixture([row({ payload: { nope: true } })]);
    const enqueue = vi.fn();
    await processOnlineSubmissions({ store, enqueue, gitSha: SHA });
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.reject).toHaveBeenCalledWith(expect.any(String), 'INVALID_PLAN_SCHEMA', expect.any(String), expect.any(Object));
  });

  it('treats deterministic enqueue failures as rejected without retry', async () => {
    const store = storeFixture();
    const enqueue = vi.fn(async () => { throw new Error('Post validation failed for threads: copy is empty'); });
    await processOnlineSubmissions({ store, enqueue, gitSha: SHA });
    expect(store.reject).toHaveBeenCalledWith(expect.any(String), 'INVALID_COPY', expect.stringContaining('copy is empty'), expect.any(Object));
    expect(store.technicalFailure).not.toHaveBeenCalled();
  });

  it('releases technical failures for retry while attempts remain', async () => {
    const store = storeFixture([row({ attemptCount: 1 })]);
    const enqueue = vi.fn(async () => { throw new Error('fetch failed'); });
    await processOnlineSubmissions({ store, enqueue, gitSha: SHA, maxAttempts: 3 });
    expect(store.technicalFailure).toHaveBeenCalledWith(expect.any(String), 'TECHNICAL_FAILURE', 'fetch failed', true);
  });

  it('marks technical failure final when retry budget is exhausted', async () => {
    const store = storeFixture([row({ attemptCount: 3 })]);
    const enqueue = vi.fn(async () => { throw new Error('fetch failed'); });
    await processOnlineSubmissions({ store, enqueue, gitSha: SHA, maxAttempts: 3 });
    expect(store.technicalFailure).toHaveBeenCalledWith(expect.any(String), 'TECHNICAL_FAILURE', 'fetch failed', false);
  });

  it('does not accept when read-after-write verification cannot find expected posts', async () => {
    const store = storeFixture();
    store.verifyPlanPosts = vi.fn(async () => []);
    const enqueue = vi.fn(async () => ({ planId: 'plan-id', enqueued: 1, scheduled: { facebook: 0, instagram: 0, threads: 1 }, skipped: 0, errors: [] }));
    await processOnlineSubmissions({ store, enqueue, gitSha: SHA });
    expect(store.accept).not.toHaveBeenCalled();
    expect(store.technicalFailure).toHaveBeenCalledWith(expect.any(String), 'READ_AFTER_WRITE_FAILED', expect.any(String), true);
  });

  it('classifies a zero-enqueue race as a deterministic queue rejection', async () => {
    const store = storeFixture();
    const enqueue = vi.fn(async () => ({ planId: 'plan-id', enqueued: 0, scheduled: { facebook: 0, instagram: 0, threads: 5 }, skipped: 1, errors: ['Daily cap reached for threads'] }));
    await processOnlineSubmissions({ store, enqueue, gitSha: SHA });
    expect(store.reject).toHaveBeenCalledWith(expect.any(String), 'QUEUE_SLOT_ALREADY_FILLED', expect.stringContaining('Daily cap reached'), expect.any(Object));
  });
});
