import type { ConfigService } from '../config/configService.js';
import { verifySignedTicketWebhook } from '../handlers/ticketDetector.js';
import type { PlayerDataBotAdapter } from '../integrations/playerDataBotAdapter.js';
import type { TicketQueueManager } from '../queues/ticketQueueManager.js';
import type { BotDatabaseRepository } from './databaseRepository.js';
import type { Logger } from './logger.js';
import type {
  DiscordMessenger,
  ObservedChannelMetadata,
} from './safeDiscordMessenger.js';
import { isThreadConsideredClosed, type SessionManager } from './sessionManager.js';

/**
 * Observes ticket closure events from the existing ticket bot and executes the
 * 10-step idempotent temporary data purge without ever closing, archiving, locking,
 * or deleting channels/threads itself.
 */
export class ClosureObserverService {
  private readonly activeCleanups = new Set<string>();
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly guildId: string,
    private readonly repo: BotDatabaseRepository,
    private readonly configService: ConfigService,
    private readonly sessionManager: SessionManager,
    private readonly queueManager: TicketQueueManager,
    private readonly playerAdapter: PlayerDataBotAdapter,
    private readonly messenger: DiscordMessenger,
    private readonly logger: Logger
  ) {}

  /**
   * Handles ChannelDelete and ThreadDelete observation events.
   */
  async handleChannelOrThreadDeleted(channelId: string): Promise<boolean> {
    return this.confirmClosureAndCleanup(channelId, 'discord_delete_event');
  }

  /**
   * Handles ThreadUpdate observation events according to the configured threadClosurePolicy.
   * Never assumes every archived thread represents a closed ticket unless configured.
   */
  async handleThreadUpdated(updatedMeta: ObservedChannelMetadata): Promise<boolean> {
    const active = await this.sessionManager.resolveActiveSession(updatedMeta.channelId);
    if (!active) {
      return false;
    }

    const { serverSettings } = await this.configService.getGuildConfiguration();
    const policy = serverSettings.ticketDetectionConfig.threadClosurePolicy;

    if (!isThreadConsideredClosed(updatedMeta, policy)) {
      return false;
    }

    return this.confirmClosureAndCleanup(updatedMeta.channelId, `thread_update_${policy}`);
  }

  /**
   * Handles an optional HMAC-signed webhook notification from the existing ticket bot.
   */
  async handleSignedWebhook(params: {
    rawBody: string;
    signatureHeader: string | undefined;
    secret: string;
  }): Promise<{ handled: boolean; action: string }> {
    const payload = verifySignedTicketWebhook(params);
    if (payload.guildId !== this.guildId) {
      return { handled: false, action: 'ignored_guild_mismatch' };
    }

    if (payload.event === 'ticket.closed') {
      const cleaned = await this.confirmClosureAndCleanup(payload.channelId, 'signed_webhook');
      return { handled: cleaned, action: 'closed_cleanup' };
    }

    if (payload.event === 'ticket.opened') {
      const meta = await this.messenger.fetchChannelMetadata(payload.channelId);
      const { categoriesById } = await this.configService.getGuildConfiguration();
      const catId = payload.categoryId ?? meta.categoryId;
      const catConfig = catId ? categoriesById.get(catId) : undefined;
      if (meta.exists && catConfig && catConfig.enabled) {
        await this.sessionManager.initializeSessionAndSendWelcome({
          channel: meta,
          categoryConfig: catConfig,
          verifiedBy: 'signed_webhook',
          playerDiscordId: payload.openerDiscordId ?? null,
          playerUsername: payload.openerUsername ?? null,
        });
        return { handled: true, action: 'opened_session' };
      }
    }

    return { handled: false, action: 'ignored' };
  }

  /**
   * Executes the 10-step idempotent closure & temporary data deletion sequence.
   */
  async confirmClosureAndCleanup(channelId: string, reason: string): Promise<boolean> {
    if (this.activeCleanups.has(channelId)) {
      return false;
    }
    this.activeCleanups.add(channelId);

    try {
      // Steps 1-3: Stop accepting new messages & abort pending AI operations immediately
      this.queueManager.abortTicket(channelId);

      const session =
        this.sessionManager.getActiveSessionInMemory(channelId) ??
        (await this.repo.getTicketSessionByChannel(channelId));

      if (session) {
        // Mark session as closing in memory & DB
        this.sessionManager.setSessionInMemory({ ...session, status: 'closing' });
        await this.repo.updateTicketSession(session.id, { status: 'closing' });

        // Step 4: Stop any pending external player-data bot lookups
        this.playerAdapter.cancelPendingLookupsForSession(session.id);
      }

      // Steps 6-9: Delete temporary messages, answers, player lookups, staff reports & session row
      const cleanupRes = await this.repo.cleanupClosedTicketSession(this.guildId, channelId);

      // Step 10: Clear all in-memory session & queue state
      this.sessionManager.removeSessionFromMemory(channelId);
      this.queueManager.finalizeTicketCleanup(channelId);

      if (cleanupRes.cleaned) {
        await this.repo.updateHeartbeatAndMetrics(this.guildId, {
          sessionsCleanedUp: 1,
        });
        this.logger.info('Cleaned up temporary data for closed ticket session', {
          channelId,
          reason,
          deletedMessages: cleanupRes.deletedMessages,
          deletedAnswers: cleanupRes.deletedAnswers,
          deletedLookups: cleanupRes.deletedLookups,
          deletedReports: cleanupRes.deletedReports,
        });
      }

      return cleanupRes.cleaned;
    } finally {
      this.activeCleanups.delete(channelId);
    }
  }

  /**
   * Periodic reconciliation verifying that every active session's Discord channel/thread
   * still exists and has not been closed.
   */
  async reconcileActiveSessions(): Promise<number> {
    const { serverSettings } = await this.configService.getGuildConfiguration();
    const policy = serverSettings.ticketDetectionConfig.threadClosurePolicy;
    const persisted = await this.repo.listActiveTicketSessions(this.guildId);

    let cleanedCount = 0;
    for (const session of persisted) {
      const meta = await this.messenger.fetchChannelMetadata(session.channelId);
      if (!meta.exists || isThreadConsideredClosed(meta, policy)) {
        const cleaned = await this.confirmClosureAndCleanup(
          session.channelId,
          'periodic_reconciliation'
        );
        if (cleaned) cleanedCount++;
      }
    }
    return cleanedCount;
  }

  startPeriodicReconciliation(intervalMs: number): void {
    this.stopPeriodicReconciliation();
    this.reconcileTimer = setInterval(() => {
      void this.reconcileActiveSessions().catch((err) => {
        this.logger.error('Periodic session reconciliation error', {
          error: err instanceof Error ? err.message : 'reconcile_failed',
        });
      });
    }, intervalMs);
    this.reconcileTimer.unref?.();
  }

  stopPeriodicReconciliation(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }
}

