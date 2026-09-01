import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { env } from '../src/env.js';

function scanFiles(dir: string, ignorePatterns: string[] = []): string[] {
  const files: string[] = [];
  for (const item of readdirSync(dir)) {
    if (item === 'node_modules' || item === '.git' || item === '.pnpm-store' || item === 'dist') {
      continue;
    }
    const fullPath = join(dir, item);
    if (ignorePatterns.some((pattern) => fullPath.includes(pattern))) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...scanFiles(fullPath, ignorePatterns));
    } else if (
      fullPath.endsWith('.ts') ||
      fullPath.endsWith('.js') ||
      fullPath.endsWith('.json') ||
      fullPath.endsWith('.yml') ||
      fullPath.endsWith('.yaml') ||
      fullPath.endsWith('.md') ||
      fullPath.endsWith('.env.example')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('strict verification: zero legacy Meta or OpenAI runtime remnants', () => {
  it('does not define any Meta credentials in env schema', () => {
    const rawEnv = env as any;
    expect(rawEnv.META_GRAPH_VERSION).toBeUndefined();
    expect(rawEnv.FACEBOOK_PAGE_ID).toBeUndefined();
    expect(rawEnv.FACEBOOK_PAGE_ACCESS_TOKEN).toBeUndefined();
    expect(rawEnv.INSTAGRAM_USER_ID).toBeUndefined();
    expect(rawEnv.INSTAGRAM_ACCESS_TOKEN).toBeUndefined();
    expect(rawEnv.INSTAGRAM_APP_ID).toBeUndefined();
    expect(rawEnv.INSTAGRAM_APP_SECRET).toBeUndefined();
    expect(rawEnv.THREADS_USER_ID).toBeUndefined();
    expect(rawEnv.THREADS_ACCESS_TOKEN).toBeUndefined();
    expect(rawEnv.THREADS_APP_ID).toBeUndefined();
    expect(rawEnv.THREADS_APP_SECRET).toBeUndefined();
    expect(rawEnv.OPENAI_API_KEY).toBeUndefined();
  });

  it('contains zero occurrences of legacy Meta endpoints across src, workflows, and tests', () => {
    const filesToScan = [
      ...scanFiles('src'),
      ...scanFiles('.github'),
      ...scanFiles('tests', ['no-meta-residual.test.ts']),
    ];

    const forbiddenStrings = [
      'graph.facebook.com',
      'graph.instagram.com',
      'graph.threads.net',
      'FACEBOOK_PAGE_ACCESS_TOKEN',
      'INSTAGRAM_ACCESS_TOKEN',
      'THREADS_ACCESS_TOKEN',
      'META_GRAPH_VERSION',
    ];

    for (const file of filesToScan) {
      const content = readFileSync(file, 'utf8');
      for (const forbidden of forbiddenStrings) {
        expect(
          content.includes(forbidden),
          `File ${file} must not contain "${forbidden}"`
        ).toBe(false);
      }
    }
  });

  it('contains zero legacy platform adapter files', () => {
    const srcFiles = scanFiles('src');
    const hasFb = srcFiles.some((f) => f.includes('facebook.ts'));
    const hasIg = srcFiles.some((f) => f.includes('instagram.ts'));
    const hasTh = srcFiles.some((f) => f.includes('threads.ts'));

    expect(hasFb).toBe(false);
    expect(hasIg).toBe(false);
    expect(hasTh).toBe(false);
  });
});
