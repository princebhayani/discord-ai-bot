import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Options,
  type APIEmbed,
  type MessageCreateOptions,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';

/**
 * Strictly the three Gateway intents required for observing existing ticket channels/threads
 * and conversing inside them. No privileged administrative intents are requested.
 */
export const ALLOWED_GATEWAY_INTENTS: readonly GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
] as const;

/**
 * Creates a low-memory Discord Gateway observer client optimized for constrained Free-tier
 * hosting (e.g., Render Free 256 MB - 512 MB). Disables member, message, user, reaction,
 * and presence caches while keeping guild/channel metadata needed for ticket observation.
 */
export function createTicketObserverClient(): Client {
  return new Client({
    intents: [...ALLOWED_GATEWAY_INTENTS],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMemberManager: {
        maxSize: 1,
        keepOverLimit: (member) => member.id === member.client.user.id,
      },
      UserManager: {
        maxSize: 1,
        keepOverLimit: (user) => user.id === user.client.user.id,
      },
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      VoiceStateManager: 0,
      GuildInviteManager: 0,
      GuildBanManager: 0,
      GuildEmojiManager: 0,
      BaseGuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      AutoModerationRuleManager: 0,
      ThreadMemberManager: 0,
      ApplicationCommandManager: 0,
      EntitlementManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      threads: {
        interval: 600,
        lifetime: 1800,
      },
    },
  });
}

export interface NormalizedDiscordEmbed {
  title?: string | null;
  description?: string | null;
  footerText?: string | null;
  fields: Array<{ name: string; value: string }>;
}

export interface NormalizedDiscordMessage {
  id: string;
  channelId: string;
  guildId: string | null;
  authorId: string;
  authorUsername: string;
  authorBot: boolean;
  content: string;
  embeds: NormalizedDiscordEmbed[];
  mentionsUserIds: string[];
  createdTimestamp: number;
}

export interface ObservedChannelMetadata {
  exists: boolean;
  channelId: string;
  guildId: string | null;
  name: string;
  topic: string | null;
  categoryId: string | null;
  parentChannelId: string | null;
  isThread: boolean;
  isPrivateThread: boolean;
  ownerId: string | null;
  archived: boolean;
  locked: boolean;
  memberIds?: string[];
}

export interface OutgoingMessagePayload {
  content?: string;
  embeds?: APIEmbed[];
}

/**
 * Read/Send-only abstraction over Discord channel operations.
 * Intentionally provides ZERO methods to create, close, delete, archive, lock,
 * move, or modify permissions on channels or threads.
 */
export interface DiscordMessenger {
  getBotUserId(): string | null;
  sendMessage(channelId: string, payload: OutgoingMessagePayload): Promise<{ messageId: string }>;
  sendTyping(channelId: string): Promise<void>;
  fetchChannelMetadata(channelId: string): Promise<ObservedChannelMetadata>;
  fetchRecentMessages(channelId: string, limit?: number): Promise<NormalizedDiscordMessage[]>;
}

export class DiscordjsSafeMessenger implements DiscordMessenger {
  constructor(private readonly client: Client) {}

  getBotUserId(): string | null {
    return this.client.user?.id ?? null;
  }

  async sendMessage(
    channelId: string,
    payload: OutgoingMessagePayload
  ): Promise<{ messageId: string }> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new Error(`Target guild channel/thread ${channelId} is not accessible or text-based.`);
    }

    const createOpts: MessageCreateOptions = {
      content: payload.content,
      embeds: payload.embeds,
      allowedMentions: { parse: ['users'] },
    };

    const sent = await (channel as TextChannel | ThreadChannel).send(createOpts);
    return { messageId: sent.id };
  }

  async sendTyping(channelId: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased() && !channel.isDMBased()) {
        await (channel as TextChannel | ThreadChannel).sendTyping();
      }
    } catch {
      // Typing indicator failures are non-fatal
    }
  }

  async fetchChannelMetadata(channelId: string): Promise<ObservedChannelMetadata> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || channel.isDMBased()) {
        return {
          exists: false,
          channelId,
          guildId: null,
          name: '',
          topic: null,
          categoryId: null,
          parentChannelId: null,
          isThread: false,
          isPrivateThread: false,
          ownerId: null,
          archived: false,
          locked: false,
        };
      }

      if (channel.isThread()) {
        const thread = channel as ThreadChannel;
        const parent = thread.parent;
        let memberIds: string[] | undefined;
        if (thread.type === ChannelType.PrivateThread) {
          try {
            const members = await thread.members.fetch();
            memberIds = Array.from(members.keys());
          } catch {
            memberIds = undefined;
          }
        }

        return {
          exists: true,
          channelId: thread.id,
          guildId: thread.guildId,
          name: thread.name,
          topic: parent && 'topic' in parent ? parent.topic : null,
          categoryId: parent?.parentId ?? null,
          parentChannelId: thread.parentId,
          isThread: true,
          isPrivateThread: thread.type === ChannelType.PrivateThread,
          ownerId: thread.ownerId,
          archived: Boolean(thread.archived),
          locked: Boolean(thread.locked),
          memberIds,
        };
      }

      if (channel.type === ChannelType.GuildText) {
        const textChan = channel as TextChannel;
        return {
          exists: true,
          channelId: textChan.id,
          guildId: textChan.guildId,
          name: textChan.name,
          topic: textChan.topic,
          categoryId: textChan.parentId,
          parentChannelId: null,
          isThread: false,
          isPrivateThread: false,
          ownerId: null,
          archived: false,
          locked: false,
        };
      }

      return {
        exists: false,
        channelId,
        guildId: 'guildId' in channel ? channel.guildId : null,
        name: 'name' in channel ? channel.name : '',
        topic: null,
        categoryId: null,
        parentChannelId: null,
        isThread: false,
        isPrivateThread: false,
        ownerId: null,
        archived: false,
        locked: false,
      };
    } catch {
      return {
        exists: false,
        channelId,
        guildId: null,
        name: '',
        topic: null,
        categoryId: null,
        parentChannelId: null,
        isThread: false,
        isPrivateThread: false,
        ownerId: null,
        archived: false,
        locked: false,
      };
    }
  }

  async fetchRecentMessages(
    channelId: string,
    limit = 15
  ): Promise<NormalizedDiscordMessage[]> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return [];
    }

    const fetched = await (channel as TextChannel | ThreadChannel).messages.fetch({
      limit: Math.min(Math.max(limit, 1), 50),
      cache: false,
    });

    return Array.from(fetched.values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((msg) => ({
        id: msg.id,
        channelId: msg.channelId,
        guildId: msg.guildId,
        authorId: msg.author.id,
        authorUsername: msg.author.username,
        authorBot: msg.author.bot,
        content: msg.content,
        embeds: msg.embeds.map((e) => ({
          title: e.title,
          description: e.description,
          footerText: e.footer?.text ?? null,
          fields: e.fields.map((f) => ({ name: f.name, value: f.value })),
        })),
        mentionsUserIds: Array.from(msg.mentions.users.keys()),
        createdTimestamp: msg.createdTimestamp,
      }));
  }
}

