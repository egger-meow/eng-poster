import type { Platform, SocialPublisher } from '../types.js'; import { FacebookPublisher } from './facebook.js'; import { InstagramPublisher } from './instagram.js'; import { ThreadsPublisher } from './threads.js';
export const publisherFor=(p:Platform):SocialPublisher=>p==='facebook'?new FacebookPublisher():p==='instagram'?new InstagramPublisher():new ThreadsPublisher();
