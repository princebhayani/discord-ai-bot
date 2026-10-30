import { describe, expect, it } from 'vitest';
import {
  CategoryConfigSchema,
  ServerSettingsSchema,
  type CategoryConfig,
} from '@hrbot/shared';
import { ConfigService } from '../config/configService.js';
import { TicketQueueManager } from '../queues/ticketQueueManager.js';
import { InMemoryBotRepository } from './databaseRepository.js';
import { Logger } from './logger.js';
import type {
  DiscordMessenger,
  NormalizedDiscordMessage,
  ObservedChannelMetadata,
  OutgoingMessagePayload,
} from './safeDiscordMessenger.js';
import { SessionManager } from './sessionManager.js';

const GUILD_ID = '111111111111111111';
const CAT_ID = '222222222222222222';
const TICKET_BOT_ID = '444444444444444444';
const OUR_BOT_ID = '555555555555555555';

class MockDiscordMessenger implements DiscordMessenger {
  public sentMessages: Array<{ channelId: string; payload: OutgoingMessagePayload }> = [];
  public channels = new Map<string, ObservedChannelMetadata>();
  public recentMessages = new Map<string, NormalizedDiscordMessage[]>();
  private nextId = 1000;

  getBotUserId(): string | null {
    return OUR_BOT_ID;
  }

  async sendMessage(
    channelId: string,
    payload: OutgoingMessagePayload
  ): Promise<{ messageId: string }> {
    this.sentMessages.push({ channelId, payload });
    return { messageId: String(++this.nextId) };
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

  async fetchRecentMessages(channelId: string): Promise<NormalizedDiscordMessage[]> {
    return this.recentMessages.get(channelId) ?? [];
  }
}

describe('Phase 3: Category Filtering, Snapshot Versioning, Queues & Recovery', () => {
  it('initializes eligible sessions, sends welcome once, pins config snapshots, and recovers after restart', async () => {
    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'BOOM Clan',
        botEnabled: true,
        defaultWelcomeMessage: 'Welcome to BOOM Support!',
        ticketDetectionConfig: {
          providerBotIds: [TICKET_BOT_ID],
          requireProviderVerification: true,
        },
        aiSettings: { model: 'openai/gpt-oss-20b' },
        playerIntegrationConfig: {},
        reportSettings: {},
        configVersion: 1,
      })
    );

    const v1Category: CategoryConfig = CategoryConfigSchema.parse({
      guildId: GUILD_ID,
      categoryId: CAT_ID,
      categoryName: 'Player Support',
      enabled: true,
      configVersion: 1,
      questions: [
        {
          key: 'player_tag',
          question: 'What is your player tag?',
          type: 'player_tag',
          required: true,
        },
      ],
    });
    repo.setCategoryConfigs(GUILD_ID, [v1Category]);

    const messenger = new MockDiscordMessenger();
    const configService = new ConfigService(repo, GUILD_ID, 'openai/gpt-oss-20b', 0);
    const queueManager = new TicketQueueManager();
    const logger = new Logger('error');
    const manager = new SessionManager(
      GUILD_ID,
      repo,
      configService,
      messenger,
      queueManager,
      logger
    );

    const ticket1Meta: ObservedChannelMetadata = {
      exists: true,
      channelId: '700000000000000001',
      guildId: GUILD_ID,
      name: 'ticket-101',
      topic: null,
      categoryId: CAT_ID,
      parentChannelId: '700000000000000000',
      isThread: true,
      isPrivateThread: true,
      ownerId: TICKET_BOT_ID,
      archived: false,
      locked: false,
    };
    messenger.channels.set(ticket1Meta.channelId, ticket1Meta);

    const s1 = await manager.observeChannelOrThreadCreated(ticket1Meta);
    // Duplicate event must not send a second introduction
    await manager.observeChannelOrThreadCreated(ticket1Meta);

    expect(s1).not.toBeNull();
    expect(messenger.sentMessages).toHaveLength(1);
    expect(messenger.sentMessages[0]?.payload.content).toContain('What is your player tag?');

    // Publish v2 config in dashboard -> active ticket 101 keeps v1, new ticket 102 gets v2!
    repo.setCategoryConfigs(GUILD_ID, [
      {
        ...v1Category,
        configVersion: 2,
        welcomeMessage: 'Updated V2 Welcome! What is your IGN?',
      },
    ]);

    const ticket2Meta: ObservedChannelMetadata = {
      ...ticket1Meta,
      channelId: '700000000000000002',
      name: 'ticket-102',
    };
    messenger.channels.set(ticket2Meta.channelId, ticket2Meta);

    const s2 = await manager.observeChannelOrThreadCreated(ticket2Meta);
    expect(s1?.configVersion).toBe(1);
    expect(s2?.configVersion).toBe(2);
    expect(messenger.sentMessages[1]?.payload.content).toContain('Updated V2 Welcome!');

    // Simulate ticket-101 closed while bot was restarting (channel deleted on Discord)
    messenger.channels.delete(ticket1Meta.channelId);

    const restartedManager = new SessionManager(
      GUILD_ID,
      repo,
      configService,
      messenger,
      new TicketQueueManager(),
      logger
    );
    const recovery = await restartedManager.recoverActiveSessions();

    expect(recovery.recovered).toBe(1);
    expect(recovery.cleanedUp).toBe(1);
    // Still only 2 welcome messages total (no duplicate welcome on restart!)
    expect(messenger.sentMessages).toHaveLength(2);
    expect(await repo.getTicketSessionByChannel(ticket1Meta.channelId)).toBeNull();
    expect(await repo.getTicketSessionByChannel(ticket2Meta.channelId)).not.toBeNull();
  });

  it('processes per-ticket tasks sequentially while executing distinct tickets concurrently', async () => {
    const qm = new TicketQueueManager();
    const order: string[] = [];

    const p1 = qm.enqueueForTicket('T-1', async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push('T1-first');
    });
    const p2 = qm.enqueueForTicket('T-1', async () => {
      order.push('T1-second');
    });
    const p3 = qm.enqueueForTicket('T-2', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('T2-fast');
    });

    await Promise.all([p1, p2, p3]);
    expect(order[0]).toBe('T2-fast');
    expect(order.slice(1)).toEqual(['T1-first', 'T1-second']);
  });
});

