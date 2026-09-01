import { env, requireEnv } from '../env.js';
import { formatFirstComment, formatPublishCopyText, formatThreadsReply } from '../content/gates.js';
import type { Platform, PreparedPost, PublishResult, SocialPublisher, TokenHealth } from '../types.js';
import { BasePublisher, PlatformError } from './base.js';

export interface BufferOrganization {
  id: string;
  name: string;
}

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  displayName?: string | null;
  isDisconnected?: boolean;
  isLocked?: boolean;
  organizationId?: string;
  organizationName?: string;
}

export interface BufferPostResult {
  id: string;
  status: string;
  dueAt?: string | null;
  sentAt?: string | null;
  sharedNow?: boolean;
  externalLink?: string | null;
  channelId?: string;
  channelService?: string;
  text?: string;
}

export class BufferClient {
  private readonly endpoint: string;

  constructor(
    private readonly apiKeyProvider: () => string = () => {
      const raw = process.env.BUFFER_API_KEY;
      if (raw && raw.trim() !== '') return raw.trim();
      return requireEnv('BUFFER_API_KEY');
    },
    endpoint = 'https://api.buffer.com'
  ) {
    this.endpoint = endpoint;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const apiKey = this.apiKeyProvider();
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (networkErr) {
      throw new PlatformError(
        networkErr instanceof Error ? networkErr.message : 'Network failure reaching Buffer API',
        undefined,
        networkErr
      );
    }

    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text.slice(0, 500) };
    }

    if (!response.ok) {
      const code =
        response.status === 429
          ? 'RATE_LIMIT_EXCEEDED'
          : response.status === 401 || response.status === 403
            ? 'UNAUTHORIZED'
            : response.status >= 500
              ? 'UNEXPECTED'
              : undefined;

      throw new PlatformError(
        `Buffer HTTP request failed (${response.status}): ${json?.message ?? response.statusText}`,
        response.status,
        json,
        code
      );
    }

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      const firstError = json.errors[0];
      const code = firstError.extensions?.code;
      const message = firstError.message ?? 'Buffer GraphQL error';

      let status = 400;
      if (code === 'RATE_LIMIT_EXCEEDED') status = 429;
      else if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') status = 401;
      else if (code === 'UNEXPECTED') status = 500;
      else if (code === 'NOT_FOUND') status = 404;

      throw new PlatformError(`Buffer GraphQL error (${code ?? 'UNKNOWN'}): ${message}`, status, json, code);
    }

    return json.data as T;
  }

  async getOrganizations(): Promise<BufferOrganization[]> {
    const data = await this.request<{ account: { organizations: BufferOrganization[] } }>(`
      query GetOrganizations {
        account {
          organizations {
            id
            name
          }
        }
      }
    `);
    return data?.account?.organizations ?? [];
  }

  async getChannels(organizationId?: string): Promise<BufferChannel[]> {
    if (organizationId) {
      const data = await this.request<{ channels: BufferChannel[] }>(
        `
        query GetChannels($input: ChannelsInput!) {
          channels(input: $input) {
            id
            name
            service
            displayName
            isDisconnected
            isLocked
          }
        }
      `,
        { input: { organizationId } }
      );
      return (data?.channels ?? []).map((c) => ({ ...c, organizationId }));
    }

    const orgs = await this.getOrganizations();
    if (orgs.length === 0) return [];

    const allChannels: BufferChannel[] = [];
    for (const org of orgs) {
      const channels = await this.getChannels(org.id);
      for (const ch of channels) {
        allChannels.push({
          ...ch,
          organizationId: org.id,
          organizationName: org.name,
        });
      }
    }
    return allChannels;
  }

  async resolveChannelId(platform: Platform, channels?: BufferChannel[]): Promise<string> {
    const envKey = `BUFFER_${platform.toUpperCase()}_CHANNEL_ID` as keyof typeof env;
    const raw = process.env[envKey];
    const configuredId = (raw !== undefined ? raw : (env[envKey] as string | undefined))?.trim();

    if (configuredId && configuredId !== '') {
      return configuredId;
    }

    const list = channels ?? (await this.getChannels());
    const matches = list.filter((c) => c.service.toLowerCase() === platform.toLowerCase());

    if (matches.length === 1) {
      return matches[0]!.id;
    }

    if (matches.length === 0) {
      const available = list.map((c) => `${c.service} (${c.name})`).join(', ') || 'none';
      throw new PlatformError(
        `No connected Buffer channel found for service "${platform}". Available channels: ${available}. Run "pnpm social buffer-channels" to inspect connected channels.`,
        404,
        undefined,
        'NOT_FOUND'
      );
    }

    const matchDetails = matches.map((c) => `"${c.name}" [ID: ${c.id}]`).join(', ');
    throw new PlatformError(
      `Multiple connected Buffer channels found for service "${platform}": ${matchDetails}. Set BUFFER_${platform.toUpperCase()}_CHANNEL_ID in your environment to specify which channel to use.`,
      400,
      undefined,
      'AMBIGUOUS_CHANNEL'
    );
  }

  async createPost(input: {
    channelId: string;
    platform: Platform;
    text: string;
    mediaUrl?: string | null | undefined;
    firstComment?: string | null | undefined;
    threadReplies?: string[] | undefined;
    schedulingType?: 'automatic' | undefined;
    mode?: 'shareNow' | undefined;
  }): Promise<BufferPostResult> {
    const postInput: Record<string, unknown> = {
      channelId: input.channelId,
      text: input.text,
      schedulingType: input.schedulingType ?? 'automatic',
      mode: input.mode ?? 'shareNow',
    };

    if (input.platform === 'facebook') {
      const fbMeta: Record<string, unknown> = {
        type: 'post',
      };
      if (input.firstComment) {
        fbMeta.firstComment = input.firstComment;
      }
      postInput.metadata = {
        facebook: fbMeta,
      };
    } else if (input.platform === 'instagram') {
      const igMeta: Record<string, unknown> = {
        type: 'post',
        shouldShareToFeed: true,
      };
      if (input.firstComment) {
        igMeta.firstComment = input.firstComment;
      }
      postInput.metadata = {
        instagram: igMeta,
      };
    } else if (input.platform === 'threads') {
      if (input.threadReplies && input.threadReplies.length > 0) {
        postInput.metadata = {
          threads: {
            thread: [
              { text: input.text },
              ...input.threadReplies.map((replyText) => ({ text: replyText })),
            ],
          },
        };
      }
    }

    if (input.mediaUrl) {
      postInput.assets = [
        {
          image: {
            url: input.mediaUrl,
          },
        },
      ];
    }

    const data = await this.request<{
      createPost: {
        post?: BufferPostResult;
        message?: string;
      };
    }>(
      `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post {
              id
              status
              dueAt
              sentAt
              sharedNow
              externalLink
              channelId
              channelService
              text
            }
          }
          ... on MutationError {
            message
          }
        }
      }
    `,
      { input: postInput }
    );

    if (data?.createPost?.message) {
      throw new PlatformError(
        `Buffer mutation error: ${data.createPost.message}`,
        400,
        data.createPost,
        'MUTATION_ERROR'
      );
    }

    if (!data?.createPost?.post) {
      throw new PlatformError(
        'Buffer returned neither a created post nor an error message',
        500,
        data,
        'UNEXPECTED'
      );
    }

    return data.createPost.post;
  }
}

export class BufferPublisher extends BasePublisher implements SocialPublisher {
  constructor(
    readonly platform: Platform,
    readonly client: BufferClient = new BufferClient()
  ) {
    super();
  }

  async validateCredentials(): Promise<TokenHealth> {
    try {
      const orgs = await this.client.getOrganizations();
      if (orgs.length === 0) {
        return {
          platform: this.platform,
          valid: false,
          grantedScopes: [],
          diagnostic: 'Buffer account has no associated organizations.',
        };
      }

      const channels = await this.client.getChannels();
      const channelId = await this.client.resolveChannelId(this.platform, channels);
      const matched = channels.find((c) => c.id === channelId);

      return {
        platform: this.platform,
        valid: true,
        accountId: channelId,
        grantedScopes: ['buffer:api'],
        expiresAt: null,
        diagnostic: `Buffer channel resolved: ${matched?.name ?? 'unnamed'} (${channelId}) on service ${matched?.service ?? this.platform} in org "${matched?.organizationName ?? orgs[0]!.name}"`,
      };
    } catch (err) {
      return {
        platform: this.platform,
        valid: false,
        grantedScopes: [],
        diagnostic: err instanceof Error ? err.message : 'Unknown Buffer validation error',
      };
    }
  }

  async publish(post: PreparedPost): Promise<PublishResult> {
    const validation = await this.validatePost(post);
    if (!validation.valid) {
      throw new PlatformError(
        `Post validation failed: ${validation.errors.join('; ')}`,
        400,
        undefined,
        'INVALID_INPUT'
      );
    }

    const channelId = await this.client.resolveChannelId(this.platform);
    const publishText = formatPublishCopyText(post);
    const mediaUrl = post.assetMode === 'image_post' ? post.mediaUrl : null;

    let firstComment: string | null = null;
    let threadReplies: string[] | undefined = undefined;

    if (this.platform === 'threads') {
      const reply = formatThreadsReply(post);
      if (reply) {
        threadReplies = [reply];
      }
    } else {
      firstComment = formatFirstComment(post);
    }

    const postResult = await this.client.createPost({
      channelId,
      platform: this.platform,
      text: publishText,
      mediaUrl,
      firstComment,
      threadReplies,
      mode: 'shareNow',
    });

    return {
      platformPostId: postResult.id,
      platformPostUrl: postResult.externalLink ?? null,
      rawSummary: {
        id: postResult.id,
        status: postResult.status,
        dueAt: postResult.dueAt ?? null,
        sentAt: postResult.sentAt ?? null,
        sharedNow: postResult.sharedNow ?? true,
        externalLink: postResult.externalLink ?? null,
        channelId: postResult.channelId ?? channelId,
        channelService: postResult.channelService ?? this.platform,
      },
    };
  }
}
