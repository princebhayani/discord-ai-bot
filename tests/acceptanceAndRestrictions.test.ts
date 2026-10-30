import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CategoryConfigSchema,
  FORBIDDEN_PERMISSIONS,
  REQUIRED_PERMISSION_BITFIELD,
  ServerSettingsSchema,
} from '@hrbot/shared';
import { ConfigService } from '../apps/bot/src/config/configService.js';
import { PlayerDataBotAdapter } from '../apps/bot/src/integrations/playerDataBotAdapter.js';
import { GlobalSemaphore, TicketQueueManager } from '../apps/bot/src/queues/ticketQueueManager.js';
import { ClosureObserverService } from '../apps/bot/src/services/closureObserverService.js';
import { ConversationService } from '../apps/bot/src/services/conversationService.js';
import { InMemoryBotRepository } from '../apps/bot/src/services/databaseRepository.js';
import {
  GroqAiService,
  type GroqCompletionClient,
  type RawGroqChatRequest,
  type RawGroqChatResult,
} from '../apps/bot/src/services/groqAiService.js';
import { Logger } from '../apps/bot/src/services/logger.js';
import { ModeratorReportService } from '../apps/bot/src/services/moderatorReportService.js';
import type {
  DiscordMessenger,
  NormalizedDiscordMessage,
  ObservedChannelMetadata,
  OutgoingMessagePayload,
} from '../apps/bot/src/services/safeDiscordMessenger.js';
import { SessionManager } from '../apps/bot/src/services/sessionManager.js';

function collectSourceFiles(dir: string, extFilter: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') {
        continue;
      }
      results.push(...collectSourceFiles(full, extFilter));
    } else if (
      extFilter.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.endsWith('.test.ts')
    ) {
      results.push(full);
    }
  }
  return results;
}

describe('Phase 10: Non-Negotiable Restrictions, Concurrency Isolation & End-to-End Acceptance', () => {
  it('CRITICAL RESTRICTION AUDIT: bot source code never calls channel/thread creation, deletion, closure, lock, archive, or permission mutation APIs', () => {
    const botSrcDir = path.resolve(__dirname, '../apps/bot/src');
    const files = collectSourceFiles(botSrcDir, ['.ts']);
    expect(files.length).toBeGreaterThan(8);

    const forbiddenPatterns = [
      { label: 'Create Discord channel', regex: /\.channels\.create\s*\(/ },
      { label: 'Create Discord thread', regex: /\.threads\.create\s*\(/ },
      { label: 'Start thread from message', regex: /\.startThread\s*\(/ },
      { label: 'Archive thread', regex: /\.setArchived\s*\(/ },
      { label: 'Lock thread', regex: /\.setLocked\s*\(/ },
      { label: 'Move channel category', regex: /\.setParent\s*\(/ },
      { label: 'Modify channel permission overwrites', regex: /permissionOverwrites\.(edit|create|delete|set)\s*\(/ },
      { label: 'Delete Discord channel/thread', regex: /\b(channel|thread|textChan)\.delete\s*\(/ },
    ];

    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      for (const rule of forbiddenPatterns) {
        expect(rule.regex.test(code), `${rule.label} found in ${file}`).toBe(false);
      }
    }

    // Verify required permission bitfield has zero overlap with forbidden permissions
    for (const [permName, flag] of Object.entries(FORBIDDEN_PERMISSIONS)) {
      expect(REQUIRED_PERMISSION_BITFIELD & flag, `${permName} must not be requested`).toBe(0n);
    }
  });

  it('SECURITY AUDIT: client-rendered dashboard components never reference server-only API keys', () => {
    const dashboardSrcDir = path.resolve(__dirname, '../apps/dashboard/src');
    const files = collectSourceFiles(dashboardSrcDir, ['.ts', '.tsx']);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const isClientComponent =
        content.includes("'use client'") ||
        content.includes('"use client"') ||
        file.endsWith(path.join('supabase', 'client.ts'));

      if (isClientComponent) {
        expect(content).not.toContain('process.env.SUPABASE_SERVICE_ROLE_KEY');
        expect(content).not.toContain('process.env.GROQ_API_KEY');
        expect(content).not.toContain('process.env.DISCORD_BOT_TOKEN');
      }
    }
  });

  it('CONCURRENCY & MID-FLIGHT CLOSURE: isolates 4 simultaneous tickets, enforces global Groq concurrency limit, and aborts closed tickets mid-generation', async () => {
    const GUILD_ID = '111111111111111111';
    const CAT_ID = '222222222222222222';
    const STAFF_REPORT_CH = '333333333333333333';

    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'BOOM Arena',
        botEnabled: true,
        defaultWelcomeMessage: 'Welcome to BOOM Support!',
        ticketDetectionConfig: { requireProviderVerification: false },
        aiSettings: {
          model: 'llama-3.3-70b-versatile',
          globalConcurrencyLimit: 2,
          structuredOutputsEnabled: true,
        },
        playerIntegrationConfig: { enabled: false },
        reportSettings: {
          destinationMode: 'staff_channel',
          staffReportChannelId: STAFF_REPORT_CH,
        },
      })
    );

    repo.setCategoryConfigs(GUILD_ID, [
      CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
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
      }),
    ]);

    const sentByChannel = new Map<string, OutgoingMessagePayload[]>();
    const activeChannels = new Map<string, ObservedChannelMetadata>();
    activeChannels.set(STAFF_REPORT_CH, {
      exists: true,
      channelId: STAFF_REPORT_CH,
      guildId: GUILD_ID,
      name: 'staff-reports',
      topic: null,
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    });

    let msgCounter = 100;
    const messenger: DiscordMessenger = {
      getBotUserId: () => '555555555555555555',
      async sendMessage(channelId, payload) {
        const list = sentByChannel.get(channelId) ?? [];
        list.push(payload);
        sentByChannel.set(channelId, list);
        return { messageId: `m-${++msgCounter}` };
      },
      async sendTyping() {},
      async fetchChannelMetadata(channelId) {
        return (
          activeChannels.get(channelId) ?? {
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
      },
      async fetchRecentMessages() {
        return [];
      },
    };

    let inFlightGroqCalls = 0;
    let peakGroqConcurrency = 0;

    const groqClient: GroqCompletionClient = {
      async complete(req: RawGroqChatRequest): Promise<RawGroqChatResult> {
        // llama-3.3-70b-versatile should automatically use json_object mode!
        expect(req.responseFormat.type).toBe('json_object');

        inFlightGroqCalls++;
        peakGroqConcurrency = Math.max(peakGroqConcurrency, inFlightGroqCalls);

        try {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 45);
            req.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('Aborted'));
              },
              { once: true }
            );
          });

          const lastMsg = req.messages[req.messages.length - 1]?.content ?? '';
          const tagMatch = /#[0289PYLQGRJCUV0-9]{4,10}/i.exec(lastMsg);
          const tag = tagMatch ? tagMatch[0].toUpperCase() : '#PYL001';

          return {
            content: JSON.stringify({
              reply: `Recorded ${tag} — forwarding to moderators.`,
              extractedAnswers: { player_tag: tag },
              missingFields: [],
              requestedAction: 'none',
              lookupTarget: null,
              issueSummary: `Intake for ${tag}`,
              neutralAssessment: 'Ready for review.',
              complete: true,
            }),
            promptTokens: 200,
            completionTokens: 50,
          };
        } finally {
          inFlightGroqCalls--;
        }
      },
    };

    const logger = new Logger('error');
    const qm = new TicketQueueManager();
    const semaphore = new GlobalSemaphore(2);
    const configSvc = new ConfigService(repo, GUILD_ID, 'llama-3.3-70b-versatile', 0);
    const sessionManager = new SessionManager(GUILD_ID, repo, configSvc, messenger, qm, logger);
    const groqService = new GroqAiService(groqClient, semaphore, 'llama-3.3-70b-versatile', logger);
    const playerAdapter = new PlayerDataBotAdapter(repo, messenger, logger);
    const reportService = new ModeratorReportService(repo, messenger, sessionManager, qm, logger);
    const conversationService = new ConversationService(
      repo,
      sessionManager,
      groqService,
      playerAdapter,
      messenger,
      qm,
      logger
    );
    conversationService.setReportCallback(async (p) => {
      await reportService.generateAndDeliverReport(p);
    });
    const closureObserver = new ClosureObserverService(
      GUILD_ID,
      repo,
      configSvc,
      sessionManager,
      qm,
      playerAdapter,
      messenger,
      logger
    );

    const ticketDefs = [
      { channelId: '810000000000000101', playerId: '900000000000000001', tag: '#PYL101' },
      { channelId: '810000000000000102', playerId: '900000000000000002', tag: '#PYL202' },
      { channelId: '810000000000000103', playerId: '900000000000000003', tag: '#PYL808' },
      { channelId: '810000000000000104', playerId: '900000000000000004', tag: '#PYL909' },
    ];

    for (const t of ticketDefs) {
      const meta: ObservedChannelMetadata = {
        exists: true,
        channelId: t.channelId,
        guildId: GUILD_ID,
        name: `ticket-${t.tag.slice(1)}`,
        topic: null,
        categoryId: CAT_ID,
        parentChannelId: null,
        isThread: false,
        isPrivateThread: false,
        ownerId: null,
        archived: false,
        locked: false,
      };
      activeChannels.set(t.channelId, meta);
      await sessionManager.observeChannelOrThreadCreated(meta);
    }

    // Clear welcome message counters before firing 4 concurrent player messages
    sentByChannel.clear();

    const turnPromises = ticketDefs.map((t, idx) =>
      conversationService.handleIncomingMessage({
        id: `concurrent-msg-${idx}`,
        channelId: t.channelId,
        guildId: GUILD_ID,
        authorId: t.playerId,
        authorUsername: `Player${idx}`,
        authorBot: false,
        content: `My tag is ${t.tag}`,
        embeds: [],
        mentionsUserIds: [],
        createdTimestamp: Date.now(),
      } satisfies NormalizedDiscordMessage)
    );

    // Close ticket T-103 mid-flight (10ms in, while Groq takes 45ms)!
    setTimeout(() => {
      activeChannels.delete('810000000000000103');
      void closureObserver.handleChannelOrThreadDeleted('810000000000000103');
    }, 10);

    await Promise.all(turnPromises);

    // 1. Global Groq concurrency limit of 2 was strictly respected
    expect(peakGroqConcurrency).toBeLessThanOrEqual(2);

    // 2. Closed ticket T-103 sent ZERO late replies and all its temporary data was deleted
    expect(sentByChannel.get('810000000000000103') ?? []).toHaveLength(0);
    expect(await repo.getTicketSessionByChannel('810000000000000103')).toBeNull();

    // 3. Remaining 3 tickets each received ONLY their own isolated tag response (zero cross-ticket leakage!)
    for (const openTicket of [ticketDefs[0]!, ticketDefs[1]!, ticketDefs[3]!]) {
      const replies = sentByChannel.get(openTicket.channelId) ?? [];
      expect(replies).toHaveLength(1);
      expect(replies[0]?.content).toContain(openTicket.tag);
      for (const other of ticketDefs) {
        if (other.channelId !== openTicket.channelId) {
          expect(replies[0]?.content).not.toContain(other.tag);
        }
      }
    }

    // 4. Exactly 3 staff reports were delivered into the pre-existing staff report channel
    expect(sentByChannel.get(STAFF_REPORT_CH) ?? []).toHaveLength(3);
  });
});

