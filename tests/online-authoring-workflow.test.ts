import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('online authoring worker workflow', () => {
  it('runs the ingestion worker on a schedule and never dispatches to Buffer', async () => {
    const yaml = await readFile('.github/workflows/process-online-authoring.yml', 'utf8');
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain('cron:');
    expect(yaml).toContain('pnpm social process-online-submissions');
    expect(yaml).toContain('SUPABASE_URL:');
    expect(yaml).toContain('SUPABASE_SERVICE_ROLE_KEY:');
    expect(yaml).not.toContain('dispatch-due');
    expect(yaml).not.toContain('BUFFER_API_KEY');
  });
});
