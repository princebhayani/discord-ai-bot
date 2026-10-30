import crypto from 'node:crypto';
import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  CategoryConfigSchema,
  ServerSettingsSchema,
  type CategoryConfig,
  type ServerSettings,
} from '@hrbot/shared';
import {
  ALLOWED_GATEWAY_INTENTS,
  createTicketObserverClient,
  type ObservedChannelMetadata,
} from '../services/safeDiscordMessenger.js';
import {
  evaluateObservedTicketCandidate,
  verifyProviderOpeningMessage,
  verifySignedTicketWebhook,
} from './ticketDetector.js';

const GUILD_ID = '111111111111111111';
const ENABLED_CAT_ID = '222222222222222222';
const DISABLED_CAT_ID = '333333333333333333';
const TICKET_BOT_ID = '444444444444444444';
const OUR_BOT_ID = '555555555555555555';
const PLAYER_ID = '666666666666666666';

function createFixtureSettings(): {
  serverSettings: ServerSettings;
  categories: Map<string, CategoryConfig>;
} {
  const serverSettings = ServerSettingsSchema.parse({
    guildId: GUILD_ID,
    guildName: 'BOOM Server',
    botEnabled: true,
    defaultWelcomeMessage: 'Welcome to BOOM Support!',
    ticketDetectionConfig: {
      providerBotIds: [TICKET_BOT_ID],
      channelNamePrefixes: ['ticket-'],
      topicMarkers: ['ticket'],
      knownEmbedKeywords: ['support'],
      requireProviderVerification: true,
      waitForProviderEmbedMs: 8000,
      threadClosurePolicy: 'locked_only',
      webhookEnabled: false,
    },
    aiSettings: {},
    playerIntegrationConfig: {},
    reportSettings: {},
  });

  const enabledCategory = CategoryConfigSchema.parse({
    guildId: GUILD_ID,
    categoryId: ENABLED_CAT_ID,
    categoryName: 'Player Support',
    enabled: true,
    questions: [
      {
        key: 'player_tag',
        question: 'What is your player tag?',
        type: 'player_tag',
        required: true,
      },
    ],
  });

  const disabledCategory = CategoryConfigSchema.parse({
    guildId: GUILD_ID,
    categoryId: DISABLED_CAT_ID,
    categoryName: 'Staff Applications',
    enabled: false,
    questions: [],
  });

  const categories = new Map<string, CategoryConfig>([
    [ENABLED_CAT_ID, enabledCategory],
    [DISABLED_CAT_ID, disabledCategory],
  ]);

  return { serverSettings, categories };
}

describe('Phase 2: Discord Gateway Intents & Ticket Channel/Thread Detection', () => {
  it('requests ONLY Guilds, GuildMessages, and MessageContent intents', () => {
    expect(ALLOWED_GATEWAY_INTENTS).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]);
    const client = createTicketObserverClient();
    expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(true);
    expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(false);
    client.destroy();
  });

  it('detects existing ticket channels via provider verification and ignores general/disabled channels', () => {
    const { serverSettings, categories } = createFixtureSettings();

    const candidateChannel: ObservedChannelMetadata = {
      exists: true,
      channelId: '777777777777777777',
      guildId: GUILD_ID,
      name: 'ticket-0142',
      topic: `Ticket opened by <@${PLAYER_ID}>`,
      categoryId: ENABLED_CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    };

    const disp = evaluateObservedTicketCandidate({
      channel: candidateChannel,
      expectedGuildId: GUILD_ID,
      serverSettings,
      categoriesById: categories,
    });
    expect(disp.status).toBe('awaiting_provider_message');

    // Verify opening panel message from existing ticket bot confirms ticket & extracts player ID
    const verification = verifyProviderOpeningMessage({
      message: {
        id: '888888888888888888',
        channelId: candidateChannel.channelId,
        guildId: GUILD_ID,
        authorId: TICKET_BOT_ID,
        authorUsername: 'TicketTool',
        authorBot: true,
        content: `Welcome <@${PLAYER_ID}>! Staff will be with you soon.`,
        embeds: [{ title: 'Support Ticket', fields: [] }],
        mentionsUserIds: [PLAYER_ID],
        createdTimestamp: Date.now(),
      },
      detectionConfig: serverSettings.ticketDetectionConfig,
      ourBotUserId: OUR_BOT_ID,
    });
    expect(verification.verified).toBe(true);
    expect(verification.detectedOpenerId).toBe(PLAYER_ID);

    // Disabled category ignored
    const disabledDisp = evaluateObservedTicketCandidate({
      channel: { ...candidateChannel, categoryId: DISABLED_CAT_ID },
      expectedGuildId: GUILD_ID,
      serverSettings,
      categoriesById: categories,
    });
    expect(disabledDisp.status).toBe('ignored');

    // General chat channel in enabled category (wrong name, no topic marker) ignored
    const generalDisp = evaluateObservedTicketCandidate({
      channel: { ...candidateChannel, name: 'general-chat', topic: null },
      expectedGuildId: GUILD_ID,
      serverSettings,
      categoriesById: categories,
    });
    expect(generalDisp.status).toBe('ignored');
  });

  it('ignores private threads by default (preventing welcome spam in staff private threads) and blocks child threads inside ticket channels', () => {
    const { serverSettings, categories } = createFixtureSettings();

    const ticketThread: ObservedChannelMetadata = {
      exists: true,
      channelId: '999999999999999991',
      guildId: GUILD_ID,
      name: 'ticket-player-a',
      topic: null,
      categoryId: ENABLED_CAT_ID,
      parentChannelId: '999999999999999990',
      parentChannelName: 'open-a-ticket',
      isThread: true,
      isPrivateThread: true,
      ownerId: TICKET_BOT_ID,
      archived: false,
      locked: false,
    };

    // Default behavior: ignorePrivateThreads is TRUE -> private threads are ignored!
    const defaultPrivateDisp = evaluateObservedTicketCandidate({
      channel: ticketThread,
      expectedGuildId: GUILD_ID,
      serverSettings,
      categoriesById: categories,
    });
    expect(defaultPrivateDisp.status).toBe('ignored');

    // When admin explicitly opts in to standalone private-thread tickets (ignorePrivateThreads: false):
    const settingsAllowingPrivateThreads: ServerSettings = {
      ...serverSettings,
      ticketDetectionConfig: {
        ...serverSettings.ticketDetectionConfig,
        ignorePrivateThreads: false,
      },
    };

    const validThreadDisp = evaluateObservedTicketCandidate({
      channel: ticketThread,
      expectedGuildId: GUILD_ID,
      serverSettings: settingsAllowingPrivateThreads,
      categoriesById: categories,
    });
    expect(validThreadDisp.status).toBe('eligible');

    // Even when ignorePrivateThreads is false, a sub-thread created INSIDE a ticket-* channel is ignored!
    const subThreadInsideTicketChannel: ObservedChannelMetadata = {
      ...ticketThread,
      channelId: '999999999999999993',
      parentChannelName: 'ticket-0142',
    };
    const subThreadDisp = evaluateObservedTicketCandidate({
      channel: subThreadInsideTicketChannel,
      expectedGuildId: GUILD_ID,
      serverSettings: settingsAllowingPrivateThreads,
      categoriesById: categories,
    });
    expect(subThreadDisp.status).toBe('ignored');

    // Ordinary discussion thread created by a human player in the same category -> ignored
    const userDiscussionThread: ObservedChannelMetadata = {
      ...ticketThread,
      channelId: '999999999999999992',
      name: 'war-strategy-discussion',
      ownerId: PLAYER_ID,
      isPrivateThread: false,
    };

    const userThreadDisp = evaluateObservedTicketCandidate({
      channel: userDiscussionThread,
      expectedGuildId: GUILD_ID,
      serverSettings: settingsAllowingPrivateThreads,
      categoriesById: categories,
    });
    expect(userThreadDisp.status).toBe('ignored');
  });

  it('verifies HMAC-signed ticket provider webhooks and rejects tampered signatures', () => {
    const secret = 'super-webhook-secret';
    const rawBody = JSON.stringify({
      event: 'ticket.opened',
      guildId: GUILD_ID,
      channelId: '777777777777777777',
      categoryId: ENABLED_CAT_ID,
      openerDiscordId: PLAYER_ID,
      timestamp: Date.now(),
    });
    const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const payload = verifySignedTicketWebhook({
      rawBody,
      signatureHeader: `sha256=${sig}`,
      secret,
    });
    expect(payload.event).toBe('ticket.opened');
    expect(payload.openerDiscordId).toBe(PLAYER_ID);

    expect(() =>
      verifySignedTicketWebhook({
        rawBody,
        signatureHeader: 'sha256=deadbeef',
        secret,
      })
    ).toThrow();
  });
});

