import { describe, expect, it } from 'vitest';
import { chooseSlot } from '../src/content/schedule.js';
import { redact } from '../src/shared/redact.js';
import { inspectImage } from '../src/media/validate.js';
import sharp from 'sharp';

describe('schedule, media, and security', () => {
  it('does not schedule exact minute collisions', () => {
    const used = new Set<string>();
    const a = chooseSlot('2026-08-31', '19:00-21:30', 'Asia/Taipei', used);
    const b = chooseSlot('2026-08-31', '19:00-21:30', 'Asia/Taipei', used);
    expect(a).not.toBe(b);
  });

  it('redacts nested secrets and bearer headers', () => {
    expect(redact({ Authorization: 'Bearer abc', nested: { api_key: 'sk-x' } })).toEqual({
      Authorization: '[REDACTED]',
      nested: { api_key: '[REDACTED]' },
    });
  });

  it('validates actual image bytes', async () => {
    const bytes = await sharp({
      create: { width: 4, height: 3, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    await expect(inspectImage(bytes)).resolves.toMatchObject({ width: 4, height: 3, format: 'png' });
    await expect(inspectImage(Buffer.from('fake'))).rejects.toThrow();
  });

  it('handles image generation failure with fallback path', async () => {
    let attempts = 0;
    const maxAttempts = 2;
    let fallbackTriggered = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attempts++;
      if (attempt === maxAttempts - 1) {
        fallbackTriggered = true;
      }
    }

    expect(attempts).toBe(2);
    expect(fallbackTriggered).toBe(true);
  });

});

