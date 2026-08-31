import { requireEnv } from '../env.js';
import type { PreparedPost, PublishResult, TokenHealth } from '../types.js';
import { BasePublisher, PlatformError } from './base.js';

export function instagramContainerPayload(post: PreparedPost): URLSearchParams {
  if (!post.mediaUrl) throw new Error('Instagram media is required');
  return new URLSearchParams({
    image_url: post.mediaUrl,
    caption: post.copyText,
    access_token: requireEnv('INSTAGRAM_ACCESS_TOKEN'),
  });
}

export class InstagramPublisher extends BasePublisher {
  private base() {
    return `https://graph.instagram.com/${requireEnv('META_GRAPH_VERSION')}`;
  }

  async validateCredentials(): Promise<TokenHealth> {
    const expected = requireEnv('INSTAGRAM_USER_ID');
    const token = requireEnv('INSTAGRAM_ACCESS_TOKEN');

    const me = await this.request(
      `${this.base()}/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`
    );

    const valid = me.id === expected;
    let grantedScopes: string[] = [];
    let expiresAt: string | undefined = undefined;

    try {
      const debug = await this.request(
        `https://graph.facebook.com/${requireEnv('META_GRAPH_VERSION')}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
      );
      if (debug?.data) {
        if (Array.isArray(debug.data.scopes)) grantedScopes = debug.data.scopes;
        if (debug.data.expires_at) {
          expiresAt = new Date(debug.data.expires_at * 1000).toISOString();
        }
      }
    } catch {
      // Debug token endpoint is optional if using basic display or standalone token
    }

    const scopeStatus = grantedScopes.length > 0 ? `scopes: [${grantedScopes.join(', ')}]` : 'scopes: uninspected';
    return {
      platform: 'instagram',
      valid,
      accountId: me.id,
      grantedScopes,
      expiresAt: expiresAt ?? null,
      diagnostic: `Instagram identity: @${me.username ?? me.id} (${me.id})${expiresAt ? ` (expires: ${expiresAt})` : ''} [${scopeStatus}]`,
    };


  }

  async publish(post: PreparedPost): Promise<PublishResult> {
    const user = requireEnv('INSTAGRAM_USER_ID');
    const token = requireEnv('INSTAGRAM_ACCESS_TOKEN');

    const c = await this.request(`${this.base()}/${user}/media`, {
      method: 'POST',
      body: instagramContainerPayload(post),
    });

    for (let n = 0; n < 8; n++) {
      const s = await this.request(
        `${this.base()}/${c.id}?fields=status_code&access_token=${encodeURIComponent(token)}`
      );
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
        throw new PlatformError(`Instagram container ${s.status_code}`, 400, s);
      }
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** n, 30000)));
    }

    const b = await this.request(`${this.base()}/${user}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: c.id,
        access_token: token,
      }),
    });

    let permalink = `https://www.instagram.com/p/${b.id}/`;
    try {
      const mediaInfo = await this.request(
        `${this.base()}/${b.id}?fields=id,permalink,shortcode&access_token=${encodeURIComponent(token)}`
      );
      if (mediaInfo?.permalink) {
        permalink = mediaInfo.permalink;
      } else if (mediaInfo?.shortcode) {
        permalink = `https://www.instagram.com/p/${mediaInfo.shortcode}/`;
      }
    } catch {
      // Fall back safely to standard permalink pattern
    }

    return {
      platformPostId: b.id,
      platformPostUrl: permalink,
      rawSummary: { id: b.id, containerId: c.id, permalink },
    };
  }
}

