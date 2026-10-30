import type { CategoryConfig, ServerSettings, ThreadClosurePolicy } from '@hrbot/shared';
import type { ConfigService } from '../config/configService.js';
import {
  evaluateObservedTicketCandidate,
  extractOpenerFromBotMessages,
  resolveOpenerFromChannelMetadata,
  verifyProviderOpeningMessage,
} from '../handlers/ticketDetector.js';
import type { TicketQueueManager } from '../queues/ticketQueueManager.js';
import type {
  BotDatabaseRepository,
  TicketSessionRecord,
} from './databaseRepository.js';
import type { Logger } from './logger.js';
import type {
  DiscordMessenger,
  NormalizedDiscordMessage,
  ObservedChannelMetadata,
} from './safeDiscordMessenger.js';

interface PendingCandidate {
  channel: ObservedChannelMetadata;
  categoryConfig: CategoryConfig;
  expiresAt: number;
}

export function isThreadConsideredClosed(
  meta: ObservedChannelMetadata,
  policy: ThreadClosurePolicy
): boolean {
  if (!meta.isThread) return false;
  switch (policy) {
    case 'locked_only':
      return meta.locked;
    case 'archived_and_locked':
      return meta.archived && meta.locked;
    case 'archived_or_locked':
      return meta.archived || meta.locked;
    case 'delete_only':
      return false;
  }
}

export function formatWelcomeMessageWithUserTag(params: {
  welcomeMessage: string;
  playerDiscordId: string | null;
  mentionUserOnWelcome: boolean;
}): string {
  const { welcomeMessage, playerDiscordId, mentionUserOnWelcome } = params;
  const hasPlaceholder = /\{(?:user|mention)\}/i.test(welcomeMessage);

  if (hasPlaceholder) {
    if (mentionUserOnWelcome && playerDiscordId) {
      return welcomeMessage.replace(/\{(?:user|mention)\}/gi, `<@${playerDiscordId}>`);
    }
    return welcomeMessage
      .replace(/^\s*\{(?:user|mention)\}[,!\s]*/i, '')
      .replace(/\s+\{(?:user|mention)\}/gi, '')
      .trim();
  }

  if (mentionUserOnWelcome && playerDiscordId) {
    if (
      welcomeMessage.includes(`<@${playerDiscordId}>`) ||
      welcomeMessage.includes(`<@!${playerDiscordId}>`)
    ) {
      return welcomeMessage;
    }
    return `<@${playerDiscordId}> ${welcomeMessage}`;
  }

  return welcomeMessage;
}

export class SessionManager {
  private readonly activeSessionsByChannel = new Map<string, TicketSessionRecord>();
  private readonly pendingCandidates = new Map<string, PendingCandidate>();
  private readonly staffThreadsByTicketChannel = new Map<string, string>();

  constructor(
    private readonly guildId: string,
    private readonly repo: BotDatabaseRepository,
    private readonly configService: ConfigService,
    private readonly messenger: DiscordMessenger,
    private readonly queueManager: TicketQueueManager,
    private readonly logger: Logger
  ) {}

  getActiveSessionInMemory(channelId: string): TicketSessionRecord | undefined {
    return this.activeSessionsByChannel.get(channelId);
  }

  getAllActiveSessionsInMemory(): TicketSessionRecord[] {
    return Array.from(this.activeSessionsByChannel.values());
  }

  setSessionInMemory(session: TicketSessionRecord): void {
    this.activeSessionsByChannel.set(session.channelId, session);
  }

  removeSessionFromMemory(channelId: string): void {
    this.activeSessionsByChannel.delete(channelId);
    this.pendingCandidates.delete(channelId);
    this.staffThreadsByTicketChannel.delete(channelId);
  }

  getObservedStaffThreadId(ticketChannelId: string): string | null {
    return this.staffThreadsByTicketChannel.get(ticketChannelId) ?? null;
  }

  /**
   * Prunes expired pending provider-verification candidates so memory never accumulates stale entries.
   */
  pruneExpiredCandidates(now = Date.now()): number {
    let pruned = 0;
    for (const [channelId, candidate] of this.pendingCandidates.entries()) {
      if (now >= candidate.expiresAt) {
        this.pendingCandidates.delete(channelId);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Returns numeric counts of in-memory maps for safe memory diagnostics.
   */
  getMemoryStateCounts(): { activeSessions: number; pendingCandidates: number } {
    return {
      activeSessions: this.activeSessionsByChannel.size,
      pendingCandidates: this.pendingCandidates.size,
    };
  }

  /**
   * Clears in-memory caches ONLY during process termination.
   * Never deletes active ticket records from Supabase on host restart.
   */
  clearMemoryState(): void {
    this.activeSessionsByChannel.clear();
    this.pendingCandidates.clear();
    this.staffThreadsByTicketChannel.clear();
  }

  async resolveActiveSession(channelId: string): Promise<TicketSessionRecord | null> {
    if (this.queueManager.isClosingOrAborted(channelId)) {
      return null;
    }

    const cached = this.activeSessionsByChannel.get(channelId);
    if (cached && cached.status !== 'closing') {
      return cached;
    }

    const persisted = await this.repo.getTicketSessionByChannel(channelId);
    if (persisted && persisted.status !== 'closing') {
      this.activeSessionsByChannel.set(channelId, persisted);
      return persisted;
    }

    return null;
  }

  /**
   * Handles ChannelCreate or ThreadCreate observation events without mutating the channel/thread.
   */
  async observeChannelOrThreadCreated(
    channel: ObservedChannelMetadata
  ): Promise<TicketSessionRecord | null> {
    this.pruneExpiredCandidates();
    if (this.activeSessionsByChannel.has(channel.channelId)) {
      return this.activeSessionsByChannel.get(channel.channelId) ?? null;
    }

    // Never start a player ticket session inside a child thread of an existing/pending ticket channel
    if (channel.isThread && channel.parentChannelId) {
      const parentIsTicket =
        this.activeSessionsByChannel.has(channel.parentChannelId) ||
        this.pendingCandidates.has(channel.parentChannelId) ||
        Boolean(await this.repo.getTicketSessionByChannel(channel.parentChannelId));

      if (parentIsTicket) {
        if (channel.isPrivateThread) {
          this.staffThreadsByTicketChannel.set(channel.parentChannelId, channel.channelId);
        }
        this.logger.debug('Ignored child thread inside active ticket channel', {
          threadId: channel.channelId,
          parentChannelId: channel.parentChannelId,
          isPrivateThread: channel.isPrivateThread,
        });
        return null;
      }
    }

    const { serverSettings, categoriesById } = await this.configService.getGuildConfiguration();
    const disposition = evaluateObservedTicketCandidate({
      channel,
      expectedGuildId: this.guildId,
      serverSettings,
      categoriesById,
    });

    if (disposition.status === 'ignored') {
      this.logger.debug('Ignored non-eligible channel/thread event', {
        channelId: channel.channelId,
        reason: disposition.reason,
      });
      return null;
    }

    if (disposition.status === 'eligible') {
      return this.initializeSessionAndSendWelcome({
        channel,
        categoryConfig: disposition.categoryConfig,
        verifiedBy: disposition.verifiedBy,
        playerDiscordId: disposition.detectedOpenerId,
        playerUsername: null,
      });
    }

    // Status is 'awaiting_provider_message': check recent messages first in case the ticket bot already posted
    const waitMs = serverSettings.ticketDetectionConfig.waitForProviderEmbedMs;
    this.pendingCandidates.set(channel.channelId, {
      channel,
      categoryConfig: disposition.categoryConfig,
      expiresAt: Date.now() + waitMs,
    });

    try {
      const recentMessages = await this.messenger.fetchRecentMessages(channel.channelId, 5);
      for (const msg of recentMessages) {
        const promoted = await this.tryPromotePendingCandidateOnMessage(msg);
        if (promoted) {
          return promoted;
        }
      }
    } catch {
      // Wait for incoming MessageCreate event within window
    }

    return null;
  }

  /**
   * Checks if a newly arrived message is the existing ticket bot's opening message
   * for a channel awaiting provider verification.
   */
  async tryPromotePendingCandidateOnMessage(
    message: NormalizedDiscordMessage
  ): Promise<TicketSessionRecord | null> {
    const pending = this.pendingCandidates.get(message.channelId);
    if (!pending) {
      return null;
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingCandidates.delete(message.channelId);
      return null;
    }

    const { serverSettings } = await this.configService.getGuildConfiguration();
    const check = verifyProviderOpeningMessage({
      message,
      detectionConfig: serverSettings.ticketDetectionConfig,
      ourBotUserId: this.messenger.getBotUserId(),
    });

    if (!check.verified) {
      return null;
    }

    this.pendingCandidates.delete(message.channelId);
    return this.initializeSessionAndSendWelcome({
      channel: pending.channel,
      categoryConfig: pending.categoryConfig,
      verifiedBy: 'provider_message',
      playerDiscordId: check.detectedOpenerId,
      playerUsername: null,
    });
  }

  private async resolveSingleTicketOpener(params: {
    channel: ObservedChannelMetadata;
    initialOpenerId: string | null;
    serverSettings: ServerSettings;
    signal: AbortSignal;
  }): Promise<string | null> {
    const { channel, initialOpenerId, serverSettings, signal } = params;
    const ourBotId = this.messenger.getBotUserId();
    const externalBotId = serverSettings.playerIntegrationConfig.externalBotUserId || null;
    const knownBotIds = new Set<string>(
      [
        ourBotId,
        externalBotId,
        ...serverSettings.ticketDetectionConfig.providerBotIds,
      ].filter((id): id is string => Boolean(id))
    );
    const staffUserIds = serverSettings.reportSettings.staffUserIds;

    let candidateOpenerId =
      initialOpenerId && !knownBotIds.has(initialOpenerId) ? initialOpenerId : null;

    if (!candidateOpenerId) {
      candidateOpenerId = resolveOpenerFromChannelMetadata({
        channel,
        knownBotIds,
        staffUserIds,
      });
    }

    try {
      let recentMessages = await this.messenger.fetchRecentMessages(channel.channelId, 8);
      const hasTicketBotOpeningPanel = recentMessages.some(
        (m) => m.authorBot && m.authorId !== ourBotId && m.authorId !== externalBotId
      );

      // On live Discord channels, wait briefly if the ticket bot hasn't posted its opening panel yet
      // so our welcome appears below the ticket panel AND captures `<@OPENER_ID>` reliably.
      if (
        !hasTicketBotOpeningPanel &&
        channel.permissionMemberIds !== undefined &&
        !signal.aborted
      ) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1400);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });

        if (!signal.aborted) {
          recentMessages = await this.messenger.fetchRecentMessages(channel.channelId, 8);
          if (!candidateOpenerId) {
            const refreshedMeta = await this.messenger.fetchChannelMetadata(channel.channelId);
            candidateOpenerId = resolveOpenerFromChannelMetadata({
              channel: refreshedMeta,
              knownBotIds,
              staffUserIds,
            });
          }
        }
      }

      const fromBotPanel = extractOpenerFromBotMessages({
        messages: recentMessages,
        knownBotIds,
        ourBotUserId: ourBotId,
        externalDataBotId: externalBotId,
        staffUserIds,
      });
      if (fromBotPanel) {
        return fromBotPanel;
      }
    } catch {
      // Non-fatal fallback to channel overwrite/topic opener ID
    }

    return candidateOpenerId;
  }

  /**
   * Initializes an isolated AI session with a frozen config snapshot and sends
   * the server welcome message strictly once (tagging the single ticket opener).
   */
  async initializeSessionAndSendWelcome(params: {
    channel: ObservedChannelMetadata;
    categoryConfig: CategoryConfig;
    verifiedBy: string;
    playerDiscordId: string | null;
    playerUsername: string | null;
  }): Promise<TicketSessionRecord | null> {
    const { channel, categoryConfig, verifiedBy, playerDiscordId, playerUsername } = params;

    const result = await this.queueManager.enqueueForTicket(
      channel.channelId,
      async (signal) => {
        if (signal.aborted) return null;

        const { serverSettings } = await this.configService.getGuildConfiguration();
        const snapshot = this.configService.buildSessionConfigSnapshot(
          serverSettings,
          categoryConfig
        );

        const resolvedOpenerId = await this.resolveSingleTicketOpener({
          channel,
          initialOpenerId: playerDiscordId,
          serverSettings,
          signal,
        });
        if (signal.aborted) return null;

        const { session } = await this.repo.createOrGetTicketSession({
          guildId: this.guildId,
          channelId: channel.channelId,
          parentChannelId: channel.parentChannelId,
          categoryId: categoryConfig.categoryId,
          categoryName: categoryConfig.categoryName,
          isThread: channel.isThread,
          isPrivateThread: channel.isPrivateThread,
          providerVerifiedBy: verifiedBy,
          playerDiscordId: resolvedOpenerId,
          playerUsername,
          configVersion: snapshot.categoryConfigVersion,
          configSnapshot: snapshot,
        });

        let currentSession = session;
        if (!currentSession.playerDiscordId && resolvedOpenerId) {
          const patched = await this.repo.updateTicketSession(currentSession.id, {
            playerDiscordId: resolvedOpenerId,
          });
          if (patched) currentSession = patched;
        }

        if (!currentSession.welcomeSent && !signal.aborted) {
          const welcomeText = formatWelcomeMessageWithUserTag({
            welcomeMessage: currentSession.configSnapshot.welcomeMessage,
            playerDiscordId: currentSession.playerDiscordId,
            mentionUserOnWelcome: currentSession.configSnapshot.mentionUserOnWelcome,
          });
          const sent = await this.messenger.sendMessage(channel.channelId, {
            content: welcomeText,
          });

          await this.repo.appendTicketMessage({
            sessionId: currentSession.id,
            discordMessageId: sent.messageId,
            senderType: 'assistant',
            senderDiscordId: this.messenger.getBotUserId(),
            content: welcomeText,
            redacted: false,
          });

          const updated = await this.repo.updateTicketSession(currentSession.id, {
            welcomeSent: true,
          });
          if (updated) {
            currentSession = updated;
          }
        }

        this.activeSessionsByChannel.set(channel.channelId, currentSession);
        this.logger.info('Initialized ticket AI session', {
          sessionId: currentSession.id,
          channelId: currentSession.channelId,
          categoryId: currentSession.categoryId,
          verifiedBy,
          configVersion: currentSession.configVersion,
        });
        return currentSession;
      }
    );

    return result ?? null;
  }

  /**
   * Recovers active ticket sessions from Supabase after a bot restart without sending
   * duplicate introductions, and cleans up any tickets closed while offline.
   */
  async recoverActiveSessions(
    onClosedDuringDowntime?: (channelId: string) => Promise<void>
  ): Promise<{ recovered: number; cleanedUp: number }> {
    const { serverSettings } = await this.configService.getGuildConfiguration(true);
    const persisted = await this.repo.listActiveTicketSessions(this.guildId);

    let recovered = 0;
    let cleanedUp = 0;

    for (const session of persisted) {
      const meta = await this.messenger.fetchChannelMetadata(session.channelId);
      const closedWhileOffline =
        !meta.exists ||
        isThreadConsideredClosed(meta, serverSettings.ticketDetectionConfig.threadClosurePolicy);

      if (closedWhileOffline) {
        if (onClosedDuringDowntime) {
          await onClosedDuringDowntime(session.channelId);
        } else {
          await this.repo.cleanupClosedTicketSession(this.guildId, session.channelId);
        }
        cleanedUp++;
        continue;
      }

      // Restore active session in memory
      let activeSession = session;
      if (!activeSession.welcomeSent) {
        // Crashed before welcome was sent — deliver once now
        const welcomeText = formatWelcomeMessageWithUserTag({
          welcomeMessage: activeSession.configSnapshot.welcomeMessage,
          playerDiscordId: activeSession.playerDiscordId,
          mentionUserOnWelcome: activeSession.configSnapshot.mentionUserOnWelcome,
        });
        const sent = await this.messenger.sendMessage(activeSession.channelId, {
          content: welcomeText,
        });
        await this.repo.appendTicketMessage({
          sessionId: activeSession.id,
          discordMessageId: sent.messageId,
          senderType: 'assistant',
          senderDiscordId: this.messenger.getBotUserId(),
          content: welcomeText,
          redacted: false,
        });
        const updated = await this.repo.updateTicketSession(activeSession.id, {
          welcomeSent: true,
        });
        if (updated) activeSession = updated;
      }

      this.activeSessionsByChannel.set(activeSession.channelId, activeSession);
      recovered++;
    }

    this.logger.info('Completed startup session recovery', { recovered, cleanedUp });
    return { recovered, cleanedUp };
  }
}

