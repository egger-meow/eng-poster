import type { MarketingRepository } from '../db/repository.js';
import type { BufferPublisher } from '../platforms/buffer.js';

// Only acknowledge local cancellation after a confirmed deletion or explicit absence.
// On an ambiguous delete response, the next pass reads the same ID before retrying.
export async function cancelProviderOffer(
  repo: MarketingRepository, publisher: BufferPublisher, postId: string, providerId: string, reason: string,
): Promise<void> {
  const existing = await publisher.getPost(providerId);
  if (existing?.status === 'sent' || existing?.sentAt) {
    throw new Error(`OFFER INCIDENT: Buffer ${providerId} already sent; manual review required; ${reason}`);
  }
  if (existing) await publisher.deletePost(providerId);
  await repo.cancelOfferPost(postId, reason);
}
