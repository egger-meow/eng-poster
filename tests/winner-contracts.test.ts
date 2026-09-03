import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Authoritative Winner Analysis & Anti-Copy Contract Tests', () => {
  const prompt = readFileSync('docs/CHATGPT_SCHEDULER_PROMPT.md', 'utf8');
  const voice = readFileSync('knowledge/voice.md', 'utf8');
  const setup = readFileSync('docs/SCHEDULER_SETUP.md', 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  const agentPrompt = readFileSync('AGENT_START_PROMPT.md', 'utf8');

  it('mandates winner inspection and analysis phase in master scheduler prompt', () => {
    expect(prompt).toContain('Winner Posts as Behavioral Evidence & Learning Source');
    expect(prompt).toContain('Step 6: Load Manually Marked Winner Posts');
    expect(prompt).toContain('Step 7: Mandatory WINNER ANALYSIS Phase & Deriving Winning Signals');
    expect(prompt).toContain('pnpm social winners-list');
  });

  it('enforces that zero winners does not block or fail authoring', () => {
    expect(prompt).toContain('Zero-Winner Graceful Fallback');
    expect(prompt).toContain('winnerReferenceCount: 0');
    expect(prompt).toContain('Zero winners must never fail or halt the authoring run');
  });

  it('enforces the critical anti-copy rule: Learn the reason, not the sentence', () => {
    expect(prompt).toContain('Critical Anti-Copy Rule ("Learn the reason, not the sentence")');
    expect(voice).toContain('Authoritative Rule: "Learn the reason, not the sentence."');
    expect(prompt).toContain('Closely paraphrasing a winner');
    expect(prompt).toContain('Repeatedly reusing the same hook syntax');
    expect(voice).toContain('Repeatedly reusing the same opening sentence syntax across runs');
  });

  it('documents exploit vs explore balance (~60-70% / ~30-40%)', () => {
    expect(prompt).toContain('60–70%');
    expect(prompt).toContain('30–40%');
    expect(prompt).toContain('"explorationMode": "winner_informed"');
    expect(voice).toContain('Exploit vs. Explore Balance (~60–70% / ~30–40%)');
    expect(setup).toContain('Exploit vs. Explore (~60–70% / ~30–40%)');
  });

  it('specifies winner learning reporting fields', () => {
    expect(prompt).toContain('winnerReferenceCount');
    expect(prompt).toContain('winningSignalsUsed');
    expect(prompt).toContain('explorationMode');
  });

  it('documents local winner dashboard and winners-list CLI commands across docs and setup', () => {
    expect(setup).toContain('pnpm social winners');
    expect(setup).toContain('pnpm social winners-list');
    expect(setup).toContain('http://127.0.0.1:3333');
    expect(setup).toContain('public.marketing_post_feedback');

    expect(readme).toContain('pnpm social winners');
    expect(readme).toContain('pnpm social winners-list');

    expect(agentPrompt).toContain('pnpm social winners');
    expect(agentPrompt).toContain('marketing_post_feedback');
  });

  it('preserves existing queue-aware conveyor belt and link invariants', () => {
    expect(prompt).toContain('14-Day Stockpile Horizon & 336h Queue Health');
    expect(prompt).toContain('72h Timely-Topic Freshness Rule');
    expect(prompt).toContain('EVERY FACEBOOK AND THREADS POST MUST LEAD BACK TO PAPER ENGLISH IN THE MAIN BODY');
    expect(voice).toContain('EVERY FACEBOOK AND THREADS POST MUST LEAD BACK TO PAPER ENGLISH IN THE MAIN BODY');
  });
});
