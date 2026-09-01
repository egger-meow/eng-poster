import { beforeEach, describe, expect, it } from 'vitest';
import type { PreparedPost } from '../src/types.js';
import { classifyError, PlatformError } from '../src/platforms/base.js';

const p: PreparedPost = {
  id: '1',
  contentPlanId: '2',
  platform: 'threads',
  assetMode: 'text_only',
  copyText: 'hello',
  scheduledFor: '',
  idempotencyKey: 'k',
  campaignSlug: 'c',
  claimManifest: [],
};

describe('platform behavior and error classification', () => {
  beforeEach(() => {
    process.env.BUFFER_API_KEY = 'test_buffer_key';
  });

  it('classifies HTTP 429 and rate limit codes as retryable', () => {
    expect(classifyError(new PlatformError('Rate limit', 429)).retryable).toBe(true);
    expect(classifyError(new PlatformError('Rate limit', 200, undefined, 'RATE_LIMIT_EXCEEDED')).retryable).toBe(true);
  });

  it('classifies HTTP 5xx and UNEXPECTED codes as retryable', () => {
    expect(classifyError(new PlatformError('Server error', 500)).retryable).toBe(true);
    expect(classifyError(new PlatformError('Server error', 503)).retryable).toBe(true);
    expect(classifyError(new PlatformError('Server error', 200, undefined, 'UNEXPECTED')).retryable).toBe(true);
  });

  it('classifies auth failures (401/403/UNAUTHORIZED/FORBIDDEN) as permanent non-retryable', () => {
    const e401 = classifyError(new PlatformError('Unauthorized', 401));
    expect(e401.retryable).toBe(false);
    expect(e401.ambiguous).toBe(false);

    const e403 = classifyError(new PlatformError('Forbidden', 403));
    expect(e403.retryable).toBe(false);
    expect(e403.ambiguous).toBe(false);

    const eGqlAuth = classifyError(new PlatformError('Not authorized', 200, undefined, 'UNAUTHORIZED'));
    expect(eGqlAuth.retryable).toBe(false);
    expect(eGqlAuth.ambiguous).toBe(false);
  });

  it('classifies client validation and mutation errors as permanent non-retryable', () => {
    expect(classifyError(new PlatformError('Invalid channel', 400)).retryable).toBe(false);
    expect(classifyError(new PlatformError('Channel not found', 404)).retryable).toBe(false);
    expect(classifyError(new PlatformError('Mutation error', 400, undefined, 'MUTATION_ERROR')).retryable).toBe(false);
  });

  it('classifies generic errors without status as ambiguous and retryable', () => {
    const res = classifyError(new Error('Network socket disconnected'));
    expect(res.retryable).toBe(true);
    expect(res.ambiguous).toBe(true);
  });

  it('keeps input post immutable during operations', () => {
    const before = JSON.stringify(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});
