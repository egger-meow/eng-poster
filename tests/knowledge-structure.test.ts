import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('knowledge and examples directory structure & prompt integration', () => {
  it('does not contain nested subdirectories under knowledge/examples', () => {
    const examplesDir = join(process.cwd(), 'knowledge', 'examples');
    const items = readdirSync(examplesDir);
    const subdirectories = items.filter((item) => statSync(join(examplesDir, item)).isDirectory());

    expect(
      subdirectories,
      'knowledge/examples must be flat (no nested fb/ig/threads subdirectories)'
    ).toEqual([]);
  });

  it('contains core brand knowledge files in knowledge directory', () => {
    const knowledgeDir = join(process.cwd(), 'knowledge');
    const items = readdirSync(knowledgeDir);

    expect(items).toContain('brand.md');
    expect(items).toContain('voice.md');
    expect(items).toContain('product.md');
    expect(items).toContain('audience.md');
    expect(items).toContain('claims.md');
  });

  it('verifies that ChatGPT Scheduler prompt mandates reading knowledge/examples/**', () => {
    const promptPath = join(process.cwd(), 'docs', 'CHATGPT_SCHEDULER_PROMPT.md');
    const promptContent = readFileSync(promptPath, 'utf8');

    expect(promptContent).toContain('knowledge/examples/**');
    expect(promptContent).toMatch(/knowledge\/examples\/\*\.md/);
    expect(promptContent).toContain('Mandatory Knowledge & Reference Reading');
    expect(promptContent).toContain('Step 1: Read All Knowledge & Reference Examples');
  });

  it('verifies that scheduler setup docs include knowledge/examples/** attachment instructions', () => {
    const setupPath = join(process.cwd(), 'docs', 'SCHEDULER_SETUP.md');
    const setupContent = readFileSync(setupPath, 'utf8');

    expect(setupContent).toContain('knowledge/examples/**');
    expect(setupContent).toContain('knowledge/examples/*.md');
  });
});
