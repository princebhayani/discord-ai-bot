import { describe, expect, it } from 'vitest';
import {
  CategoryConfigSchema,
  ServerSettingsSchema,
} from '@hrbot/shared';
import { ConfigService } from '../config/configService.js';
import { PlayerDataBotAdapter } from '../integrations/playerDataBotAdapter.js';
import { TicketQueueManager } from '../queues/ticketQueueManager.js';
import { ClosureObserverService } from './closureObserverService.js';
import { InMemoryBotRepository } from './databaseRepository.js';
import { Logger } from './logger.js';
import { ModeratorReportService } from './moderatorReportService.js';
import type {
  DiscordMessenger,
  NormalizedDiscordMessage,
  ObservedChannelMetadata,
  OutgoingMessagePayload,
} from './safeDiscordMessenger.js';
import { SessionManager } from './sessionManager.js';

const GUILD_ID = '111111111111111111';
const CAT_ID = '222222222222222222';
const STAFF_REPORT_CHANNEL_ID = '333333333333333333';
const STAFF_ROLE_ID = '444444444444444444';
const OUR_BOT_ID = '555555555555555555';
const PLAYER_ID = '999999999999999999';

class ReportTestMessenger implements DiscordMessenger {
  public sent: Array<{ channelId: string; payload: OutgoingMessagePayload }> = [];
  public channels = new Map<string, ObservedChannelMetadata>();
  private idSeq = 9000;

  getBotUserId(): string | null {
    return OUR_BOT_ID;
  }

  async sendMessage(
    channelId: string,
    payload: OutgoingMessagePayload
  ): Promise<{ messageId: string }> {
    this.sent.push({ channelId, payload });
    return { messageId: String(++this.idSeq) };
  }

  async sendTyping(): Promise<void> {}

  async fetchChannelMetadata(channelId: string): Promise<ObservedChannelMetadata> {
    return (
      this.channels.get(channelId) ?? {
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
      }
    );
  }

  async fetchRecentMessages(): Promise<NormalizedDiscordMessage[]> {
    return [];
  }
}

describe('Phase 6 & Phase 7: Moderator Reports, Confidentiality Boundaries & Closure Purge', () => {
  it('delivers confidential staff report to pre-existing staff channel, player-safe summary to ticket, and purges all temporary data idempotently on closure', async () => {
    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'BOOM Server',
        botEnabled: true,
        defaultWelcomeMessage: 'Welcome!',
        ticketDetectionConfig: {
          requireProviderVerification: false,
          threadClosurePolicy: 'locked_only',
          ignorePrivateThreads: false,
        },
        aiSettings: { model: 'openai/gpt-oss-20b' },
        playerIntegrationConfig: {},
        reportSettings: {
          destinationMode: 'staff_channel',
          staffReportChannelId: STAFF_REPORT_CHANNEL_ID,
          includePlayerSummaryInTicket: true,
          staffRoleIds: [STAFF_ROLE_ID],
        },
      })
    );

    repo.setCategoryConfigs(GUILD_ID, [
      CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
        categoryName: 'Clan Complaints',
        enabled: true,
        questions: [
          {
            key: 'player_tag',
            question: 'What is your player tag?',
            type: 'player_tag',
            required: true,
          },
          {
            key: 'issue',
            question: 'Describe your complaint.',
            type: 'long_text',
            required: true,
          },
        ],
      }),
    ]);

    const messenger = new ReportTestMessenger();
    const ticketThreadId = '750000000000000001';

    messenger.channels.set(STAFF_REPORT_CHANNEL_ID, {
      exists: true,
      channelId: STAFF_REPORT_CHANNEL_ID,
      guildId: GUILD_ID,
      name: 'staff-ticket-reports',
      topic: null,
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    });

    const threadMeta: ObservedChannelMetadata = {
      exists: true,
      channelId: ticketThreadId,
      guildId: GUILD_ID,
      name: 'ticket-complaint-1',
      topic: null,
      categoryId: CAT_ID,
      parentChannelId: '750000000000000000',
      isThread: true,
      isPrivateThread: true,
      ownerId: '400000000000000000',
      archived: false,
      locked: false,
      memberIds: [PLAYER_ID],
    };
    messenger.channels.set(ticketThreadId, threadMeta);

    const logger = new Logger('error');
    const qm = new TicketQueueManager();
    const configService = new ConfigService(repo, GUILD_ID, 'openai/gpt-oss-20b', 0);
    const sessionManager = new SessionManager(
      GUILD_ID,
      repo,
      configService,
      messenger,
      qm,
      logger
    );
    const playerAdapter = new PlayerDataBotAdapter(repo, messenger, logger);
    const reportService = new ModeratorReportService(
      repo,
      messenger,
      sessionManager,
      qm,
      logger
    );
    const closureObserver = new ClosureObserverService(
      GUILD_ID,
      repo,
      configService,
      sessionManager,
      qm,
      playerAdapter,
      messenger,
      logger
    );

    const session = await sessionManager.observeChannelOrThreadCreated(threadMeta);
    expect(session).not.toBeNull();

    // Populate temporary data
    await repo.updateTicketSession(session!.id, {
      playerDiscordId: PLAYER_ID,
      playerUsername: 'ArcherQueen',
    });
    await repo.appendTicketMessage({
      sessionId: session!.id,
      discordMessageId: 'msg-p-1',
      senderType: 'player',
      senderDiscordId: PLAYER_ID,
      content: 'My tag is #PYL928 and an elder kicked me without explanation.',
      redacted: false,
    });
    await repo.upsertTicketAnswer({
      sessionId: session!.id,
      questionKey: 'player_tag',
      answerValue: '#PYL928',
      rawText: '#PYL928',
      validated: true,
      validationNote: null,
    });
    await repo.upsertTicketAnswer({
      sessionId: session!.id,
      questionKey: 'issue',
      answerValue: 'An elder kicked me without explanation.',
      rawText: 'An elder kicked me without explanation.',
      validated: true,
      validationNote: null,
    });
    const lookup = await repo.createPlayerLookup({
      sessionId: session!.id,
      actionType: 'lookup_player',
      queryTarget: '#PYL928',
      approvedCommand: '.player #PYL928',
      status: 'completed',
    });
    await repo.updatePlayerLookup(lookup.id, {
      parsedData: {
        playerTag: '#PYL928',
        playerName: 'ArcherQueen',
        townHallLevel: 15,
        clanName: 'None',
        donations: 900,
        trophies: 4800,
        extraFields: {},
      },
      completedAt: new Date().toISOString(),
    });

    const refreshedSession = await repo.getTicketSessionByChannel(ticketThreadId);
    messenger.sent = [];

    const reportPayload = await reportService.generateAndDeliverReport({
      session: refreshedSession!,
      issueSummary: 'Player reports being removed from clan without explanation.',
      neutralAssessment: 'Profile verified as TH15; clan history check by staff needed.',
    });

    expect(reportPayload).not.toBeNull();
    expect(messenger.sent).toHaveLength(2);

    // 1. Confidential report went to STAFF_REPORT_CHANNEL_ID
    const staffMsg = messenger.sent.find((m) => m.channelId === STAFF_REPORT_CHANNEL_ID);
    expect(staffMsg).toBeDefined();
    expect(staffMsg?.payload.content).toContain(`<@&${STAFF_ROLE_ID}>`);
    const staffEmbedFields = staffMsg?.payload.embeds?.[0]?.fields ?? [];
    expect(staffEmbedFields.some((f) => f.name === 'Neutral Staff Assessment')).toBe(true);

    // 2. Player-visible summary in ticket channel does NOT contain confidential Neutral Staff Assessment
    const playerSummaryMsg = messenger.sent.find((m) => m.channelId === ticketThreadId);
    expect(playerSummaryMsg).toBeDefined();
    const playerEmbedFields = playerSummaryMsg?.payload.embeds?.[0]?.fields ?? [];
    expect(playerEmbedFields.some((f) => f.name === 'Neutral Staff Assessment')).toBe(false);

    // 3. Thread archived (unlocked) does NOT trigger closure when policy is 'locked_only'
    const archivedNotLocked = await closureObserver.handleThreadUpdated({
      ...threadMeta,
      archived: true,
      locked: false,
    });
    expect(archivedNotLocked).toBe(false);
    expect(await repo.getTicketSessionByChannel(ticketThreadId)).not.toBeNull();

    // 4. Thread locked by existing ticket bot confirms closure & purges ALL temporary data
    const lockedClosed = await closureObserver.handleThreadUpdated({
      ...threadMeta,
      archived: true,
      locked: true,
    });
    expect(lockedClosed).toBe(true);

    expect(await repo.getTicketSessionByChannel(ticketThreadId)).toBeNull();
    expect(await repo.listTicketMessages(session!.id)).toHaveLength(0);
    expect(await repo.listTicketAnswers(session!.id)).toHaveLength(0);
    expect(await repo.listPlayerLookups(session!.id)).toHaveLength(0);
    expect(await repo.getStaffReport(session!.id)).toBeNull();

    // Persistent configs remain completely intact!
    expect((await repo.getCategoryConfigs(GUILD_ID)).length).toBe(1);
    expect(repo.serverSettings.get(GUILD_ID)?.operationalMetrics.sessionsCleanedUp).toBe(1);

    // 5. Idempotent second cleanup call does not throw or double-count
    const secondCleanup = await closureObserver.handleChannelOrThreadDeleted(ticketThreadId);
    expect(secondCleanup).toBe(false);
    expect(repo.serverSettings.get(GUILD_ID)?.operationalMetrics.sessionsCleanedUp).toBe(1);
  });
});

