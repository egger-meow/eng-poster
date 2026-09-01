import type { Platform } from '../types.js';
import { BufferPublisher } from './buffer.js';

export const publisherFor = (p: Platform): BufferPublisher => new BufferPublisher(p);
export { BufferClient, BufferPublisher } from './buffer.js';
