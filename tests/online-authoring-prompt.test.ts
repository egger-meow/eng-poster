import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('online queue fill prompt contract', () => {
  it('requires current main, winners, offer-state, one submit mutation, and no direct publishing', async () => {
    const prompt = await readFile('docs/CHATGPT_ONLINE_QUEUE_FILL_PROMPT.md', 'utf8');
    for (const required of [
      'CURRENT main',
      'docs/CHATGPT_SCHEDULER_PROMPT.md',
      'winner',
      'offer',
      'chatgpt_submit_marketing_plan',
      'exactly once',
      'PRECHECK_BLOCKED',
      'ONLINE_QUEUE_FILL_STAGED',
      'ONLINE_QUEUE_FILL_ACCEPTED',
      'ONLINE_QUEUE_FILL_REJECTED',
      'Do not publish anything',
    ]) expect(prompt).toContain(required);

    expect(prompt).toContain('Do not retry');
    expect(prompt).toContain('Do not perform raw INSERTs into marketing_posts');
    expect(prompt).toContain('chatgpt_get_marketing_submission');
  });

  it('forbids customer-facing beta language while preserving internal offer identifiers', async () => {
    const prompt = await readFile('docs/CHATGPT_ONLINE_QUEUE_FILL_PROMPT.md', 'utf8');
    expect(prompt).toContain('free_pilot');
    expect(prompt).toContain('公測');
    expect(prompt).toContain('NEVER use these customer-facing words');
  });
});
