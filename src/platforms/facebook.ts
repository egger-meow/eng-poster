import { requireEnv } from '../env.js';
import type { PreparedPost, PublishResult, TokenHealth } from '../types.js';
import { BasePublisher } from './base.js';

export function facebookPayload(post: PreparedPost): URLSearchParams {
  const p = new URLSearchParams({
    message: post.copyText,
    access_token: requireEnv('FACEBOOK_PAGE_ACCESS_TOKEN'),
  });
  if (post.destinationUrl) p.set('link', post.destinationUrl);
  if (post.mediaUrl) p.set('url', post.mediaUrl);
  return p;
}

export class FacebookPublisher extends BasePublisher {
  private base() {
    return `https://graph.facebook.com/${requireEnv('META_GRAPH_VERSION')}`;
  }

  async validateCredentials(): Promise<TokenHealth> {
    const id = requireEnv('FACEBOOK_PAGE_ID');
    const token = requireEnv('FACEBOOK_PAGE_ACCESS_TOKEN');

    const body = await this.request(
      `${this.base()}/${id}?fields=id,name&access_token=${encodeURIComponent(token)}`
    );

    let grantedScopes: string[] = [];
    let expiresAt: string | undefined = undefined;

    try {
      const debug = await this.request(
        `${this.base()}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
      );
      if (debug?.data) {
        if (Array.isArray(debug.data.scopes)) grantedScopes = debug.data.scopes;
        if (debug.data.expires_at) {
          expiresAt = new Date(debug.data.expires_at * 1000).toISOString();
        } else if (debug.data.data_access_expires_at) {
          expiresAt = new Date(debug.data.data_access_expires_at * 1000).toISOString();
        }
      }
    } catch {
      // Fall back to permissions endpoint if debug_token is not available
      try {
        const perms = await this.request(
          `${this.base()}/me/permissions?access_token=${encodeURIComponent(token)}`
        );
        if (Array.isArray(perms?.data)) {
          grantedScopes = perms.data
            .filter((p: any) => p.status === 'granted')
            .map((p: any) => p.permission);
        }
      } catch {
        // Permissions inspection is optional
      }
    }

    return {
      platform: 'facebook',
      valid: body.id === id,
      accountId: body.id,
      grantedScopes,
      expiresAt: expiresAt ?? null,
      diagnostic: `Page identity: ${body.name ?? body.id} (${body.id})${expiresAt ? ` (expires: ${expiresAt})` : ''}`,
    };

  }

  async publish(post: PreparedPost): Promise<PublishResult> {
    const id = requireEnv('FACEBOOK_PAGE_ID');
    const token = requireEnv('FACEBOOK_PAGE_ACCESS_TOKEN');
    const edge = post.mediaUrl ? 'photos' : 'feed';

    const body = await this.request(`${this.base()}/${id}/${edge}`, {
      method: 'POST',
      body: facebookPayload(post),
    });

    const postId = body.post_id ?? body.id;
    let permalink = `https://www.facebook.com/${postId}`;

    try {
      const postInfo = await this.request(
        `${this.base()}/${postId}?fields=id,permalink_url&access_token=${encodeURIComponent(token)}`
      );
      if (postInfo?.permalink_url) {
        permalink = postInfo.permalink_url;
      }
    } catch {
      // Fall back safely to standard page post URL
    }

    return {
      platformPostId: postId,
      platformPostUrl: permalink,
      rawSummary: { id: postId, raw: body, permalink },
    };
  }
}

