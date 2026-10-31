import {
  ChannelType,
  Events,
  OverwriteType,
  PermissionFlagsBits,
  type AnyThreadChannel,
  type Client,
  type Message,
  type NonThreadGuildBasedChannel,
  type PartialDMChannel,
  type DMChannel,
} from 'discord.js';
import type { ClosureObserverService } from '../services/closureObserverService.js';
import type { ConversationService } from '../services/conversationService.js';
import type { Logger } from '../services/logger.js';
import type {
  NormalizedDiscordMessage,
  ObservedChannelMetadata,
} from '../services/safeDiscordMessenger.js';
import type { SessionManager } from '../services/sessionManager.js';

function mapGuildChannelToMetadata(
  channel: NonThreadGuildBasedChannel | AnyThreadChannel
): ObservedChannelMetadata {
  if (channel.isThread()) {
    return {
      exists: true,
      channelId: channel.id,
      guildId: channel.guildId,
      name: channel.name,
      topic: channel.parent && 'topic' in channel.parent ? channel.parent.topic : null,
      categoryId: channel.parent?.parentId ?? null,
      parentChannelId: channel.parentId,
      parentChannelName: channel.parent?.name ?? null,
      isThread: true,
      isPrivateThread: (channel.type as number) === ChannelType.GuildPrivateThread,
      ownerId: channel.ownerId,
      archived: Boolean(channel.archived),
      locked: Boolean(channel.locked),
    };
  }

  const permissionMemberIds: string[] = [];
  const nonAdminPermissionMemberIds: string[] = [];
  if (channel.type === ChannelType.GuildText && 'permissionOverwrites' in channel) {
    const botUserId = channel.client.user?.id ?? null;
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (
        overwrite.type === OverwriteType.Member &&
        overwrite.allow.has(PermissionFlagsBits.ViewChannel)
      ) {
        if (botUserId && overwrite.id === botUserId) continue;
        const cachedUser = channel.client.users.cache.get(overwrite.id);
        if (cachedUser?.bot) continue;

        permissionMemberIds.push(overwrite.id);
        const cachedMember = channel.guild.members.cache.get(overwrite.id);
        const isMod = Boolean(
          cachedMember?.permissions.has(
            PermissionFlagsBits.Administrator |
              PermissionFlagsBits.ManageGuild |
              PermissionFlagsBits.ManageChannels |
              PermissionFlagsBits.ManageMessages
          )
        );
        if (!isMod) {
          nonAdminPermissionMemberIds.push(overwrite.id);
        }
      }
    }
  }

  return {
    exists: channel.type === ChannelType.GuildText,
    channelId: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    topic: 'topic' in channel ? (channel.topic as string | null) : null,
    categoryId: channel.parentId,
    parentChannelId: null,
    parentChannelName: null,
    isThread: false,
    isPrivateThread: false,
    ownerId: null,
    archived: false,
    locked: false,
    permissionMemberIds,
    nonAdminPermissionMemberIds,
  };
}

function mapDiscordMessage(msg: Message): NormalizedDiscordMessage {
  let authorRoleIds: string[] = [];
  let authorHasModeratorPermissions = false;
  try {
    if (msg.member) {
      authorRoleIds = Array.from(msg.member.roles.cache.keys());
      authorHasModeratorPermissions = msg.member.permissions.has(
        PermissionFlagsBits.Administrator |
          PermissionFlagsBits.ManageGuild |
          PermissionFlagsBits.ManageChannels |
          PermissionFlagsBits.ManageMessages
      );
    }
  } catch {
    // Ignore uncached partial member permission checks
  }

  return {
    id: msg.id,
    channelId: msg.channelId,
    guildId: msg.guildId,
    authorId: msg.author.id,
    authorUsername: msg.author.username,
    authorBot: msg.author.bot,
    authorRoleIds,
    authorHasModeratorPermissions,
    content: msg.content,
    embeds: msg.embeds.map((e) => ({
      title: e.title,
      description: e.description,
      footerText: e.footer?.text ?? null,
      fields: e.fields.map((f) => ({ name: f.name, value: f.value })),
    })),
    mentionsUserIds: Array.from(msg.mentions.users.keys()),
    createdTimestamp: msg.createdTimestamp,
  };
}

/**
 * Registers strictly observational Discord Gateway event listeners:
 * - ChannelCreate
 * - ThreadCreate
 * - MessageCreate
 * - ChannelDelete
 * - ThreadDelete
 * - ThreadUpdate
 *
 * Never registers slash commands or ticket-lifecycle management actions.
 */
export function registerDiscordEvents(params: {
  client: Client;
  expectedGuildId: string;
  sessionManager: SessionManager;
  conversationService: ConversationService;
  closureObserver: ClosureObserverService;
  logger: Logger;
}): void {
  const {
    client,
    expectedGuildId,
    sessionManager,
    conversationService,
    closureObserver,
    logger,
  } = params;

  client.on(Events.ChannelCreate, (channel: NonThreadGuildBasedChannel) => {
    if (channel.guildId !== expectedGuildId || channel.type !== ChannelType.GuildText) {
      return;
    }
    const meta = mapGuildChannelToMetadata(channel);
    void sessionManager.observeChannelOrThreadCreated(meta).catch((err) => {
      logger.error('Error handling ChannelCreate observation', {
        channelId: channel.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  });

  client.on(Events.ThreadCreate, (thread: AnyThreadChannel) => {
    if (
      thread.guildId !== expectedGuildId ||
      (thread.type as number) === ChannelType.GuildPrivateThread
    ) {
      return;
    }
    const meta = mapGuildChannelToMetadata(thread);
    void sessionManager.observeChannelOrThreadCreated(meta).catch((err) => {
      logger.error('Error handling ThreadCreate observation', {
        channelId: thread.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  });

  client.on(Events.MessageCreate, (message: Message) => {
    if (
      !message.guildId ||
      message.guildId !== expectedGuildId ||
      (message.channel.type as number) === ChannelType.GuildPrivateThread
    ) {
      return;
    }
    const normalized = mapDiscordMessage(message);
    void conversationService.handleIncomingMessage(normalized).catch((err) => {
      logger.error('Error handling MessageCreate', {
        channelId: message.channelId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  });

  client.on(
    Events.ChannelDelete,
    (channel: DMChannel | PartialDMChannel | NonThreadGuildBasedChannel) => {
      if ('isDMBased' in channel && channel.isDMBased()) {
        return;
      }
      if ('guildId' in channel && channel.guildId === expectedGuildId) {
        void closureObserver.handleChannelOrThreadDeleted(channel.id).catch((err) => {
          logger.error('Error handling ChannelDelete cleanup', {
            channelId: channel.id,
            error: err instanceof Error ? err.message : 'unknown',
          });
        });
      }
    }
  );

  client.on(Events.ThreadDelete, (thread: AnyThreadChannel) => {
    if (thread.guildId !== expectedGuildId) {
      return;
    }
    void closureObserver.handleChannelOrThreadDeleted(thread.id).catch((err) => {
      logger.error('Error handling ThreadDelete cleanup', {
        channelId: thread.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  });

  client.on(Events.ThreadUpdate, (_oldThread: AnyThreadChannel, newThread: AnyThreadChannel) => {
    if (newThread.guildId !== expectedGuildId) {
      return;
    }
    const meta = mapGuildChannelToMetadata(newThread);
    void closureObserver.handleThreadUpdated(meta).catch((err) => {
      logger.error('Error handling ThreadUpdate observation', {
        channelId: newThread.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  });
}
