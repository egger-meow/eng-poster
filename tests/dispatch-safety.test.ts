import { describe, expect, it } from 'vitest';
import { classifyError, PlatformError } from '../src/platforms/base.js';
import { publishingAllowed } from '../src/content/gates.js';

describe('dispatch pause and platform safety', () => {
  it('prevents publishing across all platforms when pauseAll is active', () => {
    for (const platform of ['facebook', 'instagram', 'threads'] as const) {
      const allowed = publishingAllowed(platform, {
        pauseAll: true,
        facebook: true,
        instagram: true,
        threads: true,
      });
      expect(allowed.valid).toBe(false);
      expect(allowed.errors).toContain('global posting pause is active');
    }
  });

  it('isolates platform disabling without affecting other platforms', () => {
    const fbCheck = publishingAllowed('facebook', {
      pauseAll: false,
      facebook: false,
      instagram: true,
      threads: true,
    });
    expect(fbCheck.valid).toBe(false);
    expect(fbCheck.errors).toContain('facebook is disabled');


    const igCheck = publishingAllowed('instagram', {
      pauseAll: false,
      facebook: false,
      instagram: true,
      threads: true,
    });
    expect(igCheck.valid).toBe(true);

    const thCheck = publishingAllowed('threads', {
      pauseAll: false,
      facebook: false,
      instagram: false,
      threads: true,
    });
    expect(thCheck.valid).toBe(true);
  });

  it('classifies HTTP 429 and 5xx as retryable and 400/401/403 as permanent', () => {
    expect(classifyError(new PlatformError('Rate limited', 429)).retryable).toBe(true);
    expect(classifyError(new PlatformError('Server error', 500)).retryable).toBe(true);
    expect(classifyError(new PlatformError('Bad gateway', 502)).retryable).toBe(true);
    expect(classifyError(new PlatformError('Service unavailable', 503)).retryable).toBe(true);

    expect(classifyError(new PlatformError('Bad request', 400)).retryable).toBe(false);
    expect(classifyError(new PlatformError('Unauthorized', 401)).retryable).toBe(false);
    expect(classifyError(new PlatformError('Forbidden / Permissions missing', 403)).retryable).toBe(false);
    expect(classifyError(new PlatformError('Not found', 404)).retryable).toBe(false);
  });

  it('marks timeout errors as ambiguous and retryable', () => {
    const error = new Error('Fetch timeout exceeded');
    const classification = classifyError(error);
    expect(classification.retryable).toBe(true);
    expect(classification.ambiguous).toBe(true);
  });

  it('enforces maximum 4 retry attempts before transitioning to permanent failure', () => {
    const maxAttempts = 4;
    const isRetryable = (attemptCount: number, error: unknown) => {
      const cat = classifyError(error);
      return cat.retryable && attemptCount < maxAttempts;
    };

    const transientError = new PlatformError('Busy', 503);
    expect(isRetryable(1, transientError)).toBe(true);
    expect(isRetryable(2, transientError)).toBe(true);
    expect(isRetryable(3, transientError)).toBe(true);
    expect(isRetryable(4, transientError)).toBe(false); // Exceeded max attempts
  });
});
