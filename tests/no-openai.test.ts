import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { env } from '../src/env.js';

function getAllSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const item of readdirSync(dir)) {
    const fullPath = join(dir, item);
    if (statSync(fullPath).isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('no OpenAI dependency verification', () => {
  it('does not require OPENAI_API_KEY in environment', () => {
    // env must not have OPENAI_API_KEY as a property
    expect((env as any).OPENAI_API_KEY).toBeUndefined();
  });

  it('contains zero imports of openai across all src files', () => {
    const srcFiles = getAllSourceFiles('src');
    expect(srcFiles.length).toBeGreaterThan(0);

    for (const file of srcFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toContain("from 'openai'");
      expect(content).not.toContain('from "openai"');
      expect(content).not.toContain("require('openai')");
      expect(content).not.toContain('require("openai")');
    }
  });

  it('does not have src/ai/openai.ts or runtime generation models in src', () => {
    const srcFiles = getAllSourceFiles('src');
    const hasOpenAiFile = srcFiles.some((f) => f.includes('openai.ts'));
    expect(hasOpenAiFile).toBe(false);
  });
});
