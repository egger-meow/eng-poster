import { createHash, randomUUID } from 'node:crypto';
export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const newId = (): string => randomUUID();
export const idempotencyKey = (date: string, platform: string, slot: string, extra?: string): string =>
  extra ? `${date}:${platform}:${slot}:${extra}` : `${date}:${platform}:${slot}`;

