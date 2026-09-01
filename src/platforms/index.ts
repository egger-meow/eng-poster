import type { Platform, SocialPublisher } from '../types.js';
import { BufferPublisher } from './buffer.js';

export const publisherFor = (p: Platform): SocialPublisher => new BufferPublisher(p);
export { BufferClient, BufferPublisher } from './buffer.js';
