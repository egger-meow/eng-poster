import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import YAML from 'yaml';
import { MarketingRepository } from '../src/db/repository.js';

describe('asset metadata and filenames hygiene', () => {
  it('ensures all images under assets/manual have semantic non-UUID filenames and valid YAML sidecars', () => {
    const root = join(process.cwd(), 'assets', 'manual');
    const walk = (dir: string): string[] => {
      const files: string[] = [];
      for (const item of readdirSync(dir)) {
        const full = join(dir, item);
        if (statSync(full).isDirectory()) {
          files.push(...walk(full));
        } else if (/\.(png|jpe?g|webp)$/i.test(item)) {
          files.push(full);
        }
      }
      return files;
    };

    const images = walk(root);
    expect(images.length).toBeGreaterThan(0);

    for (const imagePath of images) {
      const filename = imagePath.split(/[\\/]/).pop()!;
      // Filename must NOT look like a UUID
      expect(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(filename),
        `Filename ${filename} should not be a raw UUID`
      ).toBe(false);

      // Must have companion .yaml sidecar
      const sidecarPath = imagePath.slice(0, -extname(imagePath).length) + '.yaml';
      const yamlContent = readFileSync(sidecarPath, 'utf8');
      const parsed = YAML.parse(yamlContent);

      expect(parsed, `Sidecar for ${filename} must be valid YAML`).toBeTruthy();
      expect(parsed.concept, `Sidecar for ${filename} must define concept`).toBeTruthy();
      expect(Array.isArray(parsed.topics), `Sidecar for ${filename} must define topics array`).toBe(true);
      expect(parsed.topics.length, `Sidecar for ${filename} must have at least one topic`).toBeGreaterThan(0);
      for (const topic of parsed.topics) {
        expect(/^[0-9a-f]{6,}$/i.test(topic), `Topic ${topic} in ${filename} must not be a hex hash`).toBe(false);
      }
    }
  });

  it('gracefully falls back to 3-argument claim_marketing_posts if 4-argument RPC does not exist', async () => {
    const mockRpc = vi.fn().mockImplementation((name, args) => {
      if (name === 'claim_marketing_posts' && 'p_lookahead_hours' in args) {
        return Promise.resolve({
          data: null,
          error: { code: 'PGRST202', message: 'function claim_marketing_posts(p_limit => integer, p_lease_minutes => integer, p_platforms => text[], p_lookahead_hours => integer) does not exist' },
        });
      }
      if (name === 'claim_marketing_posts' && !('p_lookahead_hours' in args)) {
        return Promise.resolve({
          data: [
            {
              id: 'post-1',
              status: 'claimed',
              scheduled_for: '2026-09-01T12:00:00Z',
              platform: 'threads',
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const repo = new MarketingRepository({ rpc: mockRpc } as any);
    const claimed = await repo.claimDue(10, 15, ['threads'], 24);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[0][1]).toHaveProperty('p_lookahead_hours', 24);
    expect(mockRpc.mock.calls[1][1]).not.toHaveProperty('p_lookahead_hours');
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe('post-1');
  });
});
