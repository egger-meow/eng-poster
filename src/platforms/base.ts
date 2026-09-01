import type { PreparedPost, PublishResult, TokenHealth, ValidationResult } from '../types.js';
import { validatePreparedPost } from '../content/gates.js';

export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly response?: unknown,
    readonly code?: string
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export function classifyError(error: unknown): { retryable: boolean; ambiguous: boolean; message: string } {
  if (error instanceof PlatformError) {
    const code = error.code?.toUpperCase();
    if (error.status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
      return { retryable: true, ambiguous: false, message: error.message };
    }
    if ((error.status !== undefined && error.status >= 500) || code === 'UNEXPECTED') {
      return { retryable: true, ambiguous: false, message: error.message };
    }
    if (error.status === 401 || error.status === 403 || code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
      return { retryable: false, ambiguous: false, message: error.message };
    }
    if (
      (error.status !== undefined && error.status >= 400 && error.status < 500) ||
      code === 'MUTATION_ERROR' ||
      code === 'NOT_FOUND' ||
      code === 'INVALID_INPUT'
    ) {
      return { retryable: false, ambiguous: false, message: error.message };
    }
    if (error.status === undefined && !code) {
      return { retryable: true, ambiguous: true, message: error.message };
    }
    return { retryable: false, ambiguous: false, message: error.message };
  }

  return {
    retryable: true,
    ambiguous: true,
    message: error instanceof Error ? error.message : 'Unknown platform error',
  };
}

export abstract class BasePublisher {
  abstract validateCredentials(): Promise<TokenHealth>;
  abstract publish(post: PreparedPost): Promise<PublishResult>;
  async validatePost(post: PreparedPost): Promise<ValidationResult> {
    return validatePreparedPost(post);
  }
}
