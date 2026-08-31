import { requireEnv } from '../env.js';
import type { PreparedPost, PublishResult, TokenHealth } from '../types.js';
import { BasePublisher } from './base.js';

export function threadsContainerPayload(post: PreparedPost): URLSearchParams {
  const p = new URLSearchParams({
    media_type: post.mediaUrl ? 'IMAGE' : 'TEXT',
    text: post.copyText,
    access_token: requireEnv('THREADS_ACCESS_TOKEN'),
  });
  if (post.mediaUrl) p.set('image_url', post.mediaUrl);
  return p;
}

export class ThreadsPublisher extends BasePublisher {
  private base() {
    return `https://graph.threads.net/${requireEnv('META_GRAPH_VERSION')}`;
  }

  async validateCredentials(): Promise<TokenHealth> {
    const expected = requireEnv('THREADS_USER_ID');
    const token = requireEnv('THREADS_ACCESS_TOKEN');

    const me = await this.request(
      `${this.base()}/me?fields=id,username,threads_profile_picture_url&access_token=${encodeURIComponent(token)}`
    );

    const valid = me.id === expected;
    let grantedScopes: string[] = ['threads_basic', 'threads_content_publish'];
    let expiresAt: string | undefined = undefined;

    try {
      const debug = await this.request(
        `https://graph.threads.net/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
      );
      if (debug?.data) {
        if (Array.isArray(debug.data.scopes)) grantedScopes = debug.data.scopes;
        if (debug.data.expires_at) {
          expiresAt = new Date(debug.data.expires_at * 1000).toISOString();
        }
      }
    } catch {
      // Debug token endpoint is optional if not supported on Threads endpoint
    }

    return {
      platform: 'threads',
      valid,
      accountId: me.id,
      grantedScopes,
      expiresAt: expiresAt ?? null,
      diagnostic: `Threads identity: @${me.username ?? me.id} (${me.id})${expiresAt ? ` (expires: ${expiresAt})` : ''}`,
    };

  }

  async publish(post: PreparedPost): Promise<PublishResult> {
    const token = requireEnv('THREADS_ACCESS_TOKEN');
    const c = await this.request(`${this.base()}/me/threads`, {
      method: 'POST',
      body: threadsContainerPayload(post),
    });

    const b = await this.request(`${this.base()}/me/threads_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: c.id,
        access_token: token,
      }),
    });

    let permalink = `https://www.threads.net/post/${b.id}`;
    try {
      const mediaInfo = await this.request(
        `${this.base()}/${b.id}?fields=id,permalink&access_token=${encodeURIComponent(token)}`
      );
      if (mediaInfo?.permalink) {
        permalink = mediaInfo.permalink;
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

  async refreshToken(): Promise<{ accessToken: string; expiresIn: number; expiresAt: string }> {
    const token = requireEnv('THREADS_ACCESS_TOKEN');
    const result = await this.request(
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`
    );

    const expiresIn = result.expires_in ?? 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return {
      accessToken: result.access_token,
      expiresIn,
      expiresAt,
    };
  }
}

