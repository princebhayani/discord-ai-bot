import { describe, expect, it, vi } from 'vitest';
import {
  CategoryConfigSchema,
  ServerSettingsSchema,
} from '@hrbot/shared';
import { ConfigService } from '../config/configService.js';
import {
  PlayerDataBotAdapter,
  renderApprovedCommand,
  sanitizeLookupTarget,
} from '../integrations/playerDataBotAdapter.js';
import { GlobalSemaphore, TicketQueueManager } from '../queues/ticketQueueManager.js';
import { ConversationService } from './conversationService.js';
import { InMemoryBotRepository } from './databaseRepository.js';
import {
  GroqAiService,
  polishHumanDiscordReply,
  type GroqCompletionClient,
  type RawGroqChatRequest,
  type RawGroqChatResult,
} from './groqAiService.js';
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
const TICKET_BOT_ID = '444444444444444444';
const OUR_BOT_ID = '555555555555555555';
const DATA_BOT_ID = '666666666666666666';
const UNRELATED_BOT_ID = '777777777777777777';
const EXEC_CHANNEL_ID = '888888888888888888';
const PLAYER_ID = '999999999999999999';

class FakeGroqClient implements GroqCompletionClient {
  public requests: RawGroqChatRequest[] = [];
  public queuedResponses: Array<(req: RawGroqChatRequest) => RawGroqChatResult> = [];

  async complete(req: RawGroqChatRequest): Promise<RawGroqChatResult> {
    this.requests.push(req);
    const handler = this.queuedResponses.shift();
    if (!handler) {
      throw new Error('No queued mock Groq response');
    }
    return handler(req);
  }
}

class LoopbackMessenger implements DiscordMessenger {
  public sent: Array<{ channelId: string; payload: OutgoingMessagePayload }> = [];
  public onCommandSent?: (channelId: string, content: string) => void;
  private seq = 5000;

  getBotUserId(): string | null {
    return OUR_BOT_ID;
  }

  async sendMessage(
    channelId: string,
    payload: OutgoingMessagePayload
  ): Promise<{ messageId: string }> {
    this.sent.push({ channelId, payload });
    if (payload.content && this.onCommandSent) {
      this.onCommandSent(channelId, payload.content);
    }
    return { messageId: String(++this.seq) };
  }

  async sendTyping(): Promise<void> {}

  async fetchChannelMetadata(channelId: string): Promise<ObservedChannelMetadata> {
    return {
      exists: true,
      channelId,
      guildId: GUILD_ID,
      name: 'ticket-501',
      topic: null,
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    };
  }

  async fetchRecentMessages(): Promise<NormalizedDiscordMessage[]> {
    return [];
  }
}

describe('Phase 4 & Phase 5: Groq Conversational Engine & External Player-Data Bot Integration', () => {
  it('extracts multiple answers, redacts secrets, executes approved external bot lookups, and ignores unrelated bots/channels', async () => {
    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'BOOM Support',
        botEnabled: true,
        defaultWelcomeMessage: 'Welcome to BOOM Support!',
        ticketDetectionConfig: {
          providerBotIds: [TICKET_BOT_ID],
          requireProviderVerification: false,
        },
        aiSettings: {
          model: 'openai/gpt-oss-20b',
          structuredOutputsEnabled: true,
        },
        playerIntegrationConfig: {
          enabled: true,
          externalBotUserId: DATA_BOT_ID,
          commandPrefix: '.',
          executionChannelId: EXEC_CHANNEL_ID,
          timeoutMs: 3000,
          supportedActions: ['lookup_player', 'lookup_clan'],
          commandTemplates: {
            lookup_player: '{prefix}player {target}',
            lookup_clan: '{prefix}clan {target}',
            lookup_profile: '{prefix}profile {target}',
          },
        },
        reportSettings: {
          staffUserIds: ['121212121212121212'],
        },
      })
    );

    repo.setCategoryConfigs(GUILD_ID, [
      CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
        categoryName: 'Player Support',
        enabled: true,
        playerLookupEnabled: true,
        questions: [
          {
            key: 'player_tag',
            question: 'What is your player tag?',
            type: 'player_tag',
            required: true,
          },
          {
            key: 'clan_name',
            question: 'Which clan are you currently in?',
            type: 'text',
            required: true,
          },
          {
            key: 'issue',
            question: 'Explain your issue.',
            type: 'long_text',
            required: true,
          },
        ],
      }),
    ]);

    const messenger = new LoopbackMessenger();
    const fakeGroq = new FakeGroqClient();
    const logger = new Logger('error');
    const queueManager = new TicketQueueManager();
    const configService = new ConfigService(repo, GUILD_ID, 'openai/gpt-oss-20b', 0);
    const sessionManager = new SessionManager(
      GUILD_ID,
      repo,
      configService,
      messenger,
      queueManager,
      logger
    );
    const groqService = new GroqAiService(
      fakeGroq,
      new GlobalSemaphore(5),
      'openai/gpt-oss-20b',
      logger
    );
    const playerAdapter = new PlayerDataBotAdapter(repo, messenger, logger);
    const conversationService = new ConversationService(
      repo,
      sessionManager,
      groqService,
      playerAdapter,
      messenger,
      queueManager,
      logger
    );

    let reportReadyTriggered = false;
    conversationService.setReportCallback(async () => {
      reportReadyTriggered = true;
    });

    // Simulate external bot replying ONLY after an unrelated bot posts first (unrelated bot must be ignored!)
    messenger.onCommandSent = (chanId, cmdContent) => {
      if (chanId === EXEC_CHANNEL_ID && cmdContent === '.player #PYL928') {
        setTimeout(() => {
          // 1. Unrelated bot message -> must be ignored
          playerAdapter.observeExternalBotMessage({
            id: 'ext-wrong-1',
            channelId: EXEC_CHANNEL_ID,
            guildId: GUILD_ID,
            authorId: UNRELATED_BOT_ID,
            authorUsername: 'MusicBot',
            authorBot: true,
            content: 'Now playing track',
            embeds: [],
            mentionsUserIds: [],
            createdTimestamp: Date.now(),
          });

          // 2. Approved external player-data bot response -> accepted and parsed!
          playerAdapter.observeExternalBotMessage({
            id: 'ext-valid-2',
            channelId: EXEC_CHANNEL_ID,
            guildId: GUILD_ID,
            authorId: DATA_BOT_ID,
            authorUsername: 'ClashPerk',
            authorBot: true,
            content: '',
            embeds: [
              {
                title: 'Chief Dragon',
                fields: [
                  { name: 'Player Tag', value: '#PYL928' },
                  { name: 'Town Hall', value: '16' },
                  { name: 'Clan', value: 'BOOM' },
                  { name: 'Donations', value: '2,450' },
                  { name: 'Trophies', value: '5,610' },
                ],
              },
            ],
            mentionsUserIds: [],
            createdTimestamp: Date.now(),
          });
        }, 15);
      }
    };

    // Unrelated general channel message must NEVER be stored
    await conversationService.handleIncomingMessage({
      id: 'general-msg-1',
      channelId: '100000000000000099',
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'Dragon',
      authorBot: false,
      content: 'Hello general chat!',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });
    expect(repo.messages.size).toBe(0);

    // Initialize eligible ticket channel
    const ticketChannelId = '710000000000000001';
    const session = await sessionManager.observeChannelOrThreadCreated({
      exists: true,
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      name: 'ticket-dragon',
      topic: 'Ticket opened',
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    });
    expect(session).not.toBeNull();

    // Queue Turn 1 AI output: extracts BOTH player_tag and clan_name, requests lookup_player, asks for issue
    fakeGroq.queuedResponses.push((req) => {
      // Verify strict json_schema was selected for openai/gpt-oss-20b
      expect(req.responseFormat.type).toBe('json_schema');
      // Verify secret password was redacted BEFORE reaching Groq!
      const lastUserMsg = req.messages[req.messages.length - 1]?.content ?? '';
      expect(lastUserMsg).not.toContain('MyPass999');
      expect(lastUserMsg).toContain('[REDACTED_SECRET]');

      return {
        content: JSON.stringify({
          reply: "Thanks! I've noted your tag and clan. Please never share passwords in Discord. Could you explain the issue you're facing?",
          extractedAnswers: {
            player_tag: 'pyl928',
            clan_name: 'BOOM',
            issue: null,
          },
          missingFields: ['issue'],
          requestedAction: 'lookup_player',
          lookupTarget: '#PYL928',
          issueSummary: null,
          neutralAssessment: null,
          complete: false,
        }),
        promptTokens: 320,
        completionTokens: 85,
      };
    });

    await conversationService.handleIncomingMessage({
      id: 'player-msg-1',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'Dragon',
      authorBot: false,
      content: 'Hi! My tag is pyl928, I am in BOOM clan, and password: MyPass999',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    const answersAfterTurn1 = await repo.listTicketAnswers(session!.id);
    expect(answersAfterTurn1).toHaveLength(2);

    const lookupsAfterTurn1 = await repo.listPlayerLookups(session!.id);
    expect(lookupsAfterTurn1).toHaveLength(1);
    expect(lookupsAfterTurn1[0]?.status).toBe('completed');
    expect(lookupsAfterTurn1[0]?.parsedData?.townHallLevel).toBe(16);
    expect(lookupsAfterTurn1[0]?.parsedData?.trophies).toBe(5610);

    // Queue Turn 2 AI output: verified player profile is now present in Groq system prompt!
    fakeGroq.queuedResponses.push((req) => {
      const sysPrompt = req.messages[0]?.content ?? '';
      expect(sysPrompt).toContain('Chief Dragon');
      expect(sysPrompt).toContain('#PYL928');
      return {
        content: JSON.stringify({
          reply: 'Got it! Everything is recorded for our moderators, and a human team member will assist you shortly.',
          extractedAnswers: {
            player_tag: null,
            clan_name: null,
            issue: 'I missed my war attack because of a power outage and want to explain to leadership.',
          },
          missingFields: [],
          requestedAction: 'none',
          lookupTarget: null,
          issueSummary: 'Player missed war attack due to power outage.',
          neutralAssessment: 'Player profile verified (TH16 in BOOM); awaiting leadership review.',
          complete: true,
        }),
        promptTokens: 410,
        completionTokens: 90,
      };
    });

    await conversationService.handleIncomingMessage({
      id: 'player-msg-2',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'Dragon',
      authorBot: false,
      content: 'I missed my war attack because of a power outage and want to explain to leadership.',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    expect(reportReadyTriggered).toBe(true);
    const updatedSession = await repo.getTicketSessionByChannel(ticketChannelId);
    expect(updatedSession?.status).toBe('ready_for_review');
  });

  it('prevents arbitrary dot-command injection and handles lookup timeouts gracefully', async () => {
    expect(sanitizeLookupTarget('lookup_player', '.ban @everyone')).toBeNull();
    expect(sanitizeLookupTarget('lookup_clan', 'BOOM\n.kick user')).toBeNull();
    expect(sanitizeLookupTarget('lookup_player', 'abc123')).toBe('#ABC123');

    const cmd = renderApprovedCommand(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        defaultWelcomeMessage: 'Hello world',
        ticketDetectionConfig: {},
        aiSettings: {},
        playerIntegrationConfig: {
          enabled: true,
          externalBotUserId: DATA_BOT_ID,
          commandPrefix: '.',
          executionChannelId: EXEC_CHANNEL_ID,
          timeoutMs: 5000,
        },
        reportSettings: {},
      }).playerIntegrationConfig,
      'lookup_player',
      '#ABC123'
    );
    expect(cmd).toBe('.player #ABC123');

    // Timeout test when external bot ignores bot account
    vi.useFakeTimers();
    try {
      const repo = new InMemoryBotRepository();
      const messenger = new LoopbackMessenger();
      const adapter = new PlayerDataBotAdapter(repo, messenger, new Logger('error'));
      const settings = ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        defaultWelcomeMessage: 'Welcome message',
        ticketDetectionConfig: {},
        aiSettings: {},
        playerIntegrationConfig: {
          enabled: true,
          externalBotUserId: DATA_BOT_ID,
          commandPrefix: '.',
          executionChannelId: EXEC_CHANNEL_ID,
          timeoutMs: 5000,
        },
        reportSettings: {},
      });
      repo.setServerSettings(settings);
      const cat = CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
        categoryName: 'Support',
        enabled: true,
        playerLookupEnabled: true,
        questions: [],
      });
      const configSvc = new ConfigService(repo, GUILD_ID, 'llama-3.3-70b-versatile', 0);
      const snap = configSvc.buildSessionConfigSnapshot(settings, cat);
      const { session } = await repo.createOrGetTicketSession({
        guildId: GUILD_ID,
        channelId: '720000000000000002',
        parentChannelId: null,
        categoryId: CAT_ID,
        categoryName: 'Support',
        isThread: false,
        isPrivateThread: false,
        providerVerifiedBy: 'category_match',
        playerDiscordId: PLAYER_ID,
        playerUsername: 'PlayerTwo',
        configVersion: 1,
        configSnapshot: snap,
      });

      const lookupPromise = adapter.executeLookup({
        session,
        rawAction: 'lookup_player',
        rawTarget: '#ABC123',
      });
      await vi.advanceTimersByTimeAsync(5100);
      const timedOutLookup = await lookupPromise;
      expect(timedOutLookup?.status).toBe('timed_out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('distinguishes the single ticket opener from admins, supports 1-line DOT commands inside tickets, and builds humanized prompts', async () => {
    const ADMIN_ID = '121212121212121212';
    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'Boom House',
        botEnabled: true,
        defaultWelcomeMessage: 'Hey {user}! Welcome to Boom House!',
        ticketDetectionConfig: {
          requireProviderVerification: false,
          mentionUserOnWelcome: true,
        },
        aiSettings: {
          model: 'openai/gpt-oss-20b',
          personaName: 'Duke The Recruiter',
          toneStyle: 'human_casual',
          humanizeConversation: true,
          serverKnowledge: {
            serverOverview: 'Boom House is a top war & CWL clan family.',
            joiningProcessAndTiming: 'Leaders review tags within 15-30 minutes.',
          },
        },
        playerIntegrationConfig: {
          enabled: true,
          quickCommandLine: '.p {tag}',
          executionChannelMode: 'ticket_channel',
          externalBotUserId: DATA_BOT_ID,
          timeoutMs: 2000,
        },
        reportSettings: {},
      })
    );

    repo.setCategoryConfigs(GUILD_ID, [
      CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
        categoryName: 'Recruitment',
        enabled: true,
        playerLookupEnabled: true,
        questions: [
          {
            key: 'player_tag',
            question: "What's your player tag?",
            type: 'player_tag',
            required: true,
          },
        ],
      }),
    ]);

    const messenger = new LoopbackMessenger();
    const fakeGroq = new FakeGroqClient();
    const logger = new Logger('error');
    const qm = new TicketQueueManager();
    const configService = new ConfigService(repo, GUILD_ID, 'openai/gpt-oss-20b', 0);
    const sessionManager = new SessionManager(GUILD_ID, repo, configService, messenger, qm, logger);
    const groqService = new GroqAiService(fakeGroq, new GlobalSemaphore(5), 'openai/gpt-oss-20b', logger);
    const playerAdapter = new PlayerDataBotAdapter(repo, messenger, logger);
    const conversationService = new ConversationService(
      repo,
      sessionManager,
      groqService,
      playerAdapter,
      messenger,
      qm,
      logger,
      configService
    );

    const ticketChannelId = '730000000000000001';
    await sessionManager.observeChannelOrThreadCreated({
      exists: true,
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      name: 'ticket-boom',
      topic: `Opened by <@${PLAYER_ID}>`,
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    });

    // 1st message tagged the single ticket opener via {user}
    expect(messenger.sent[0]?.payload.content).toContain(`<@${PLAYER_ID}>`);

    // Simulate stats bot replying right inside the ticket channel when `.p #9RQU2YQPL` is sent
    messenger.onCommandSent = (chanId, cmdContent) => {
      if (chanId === ticketChannelId && cmdContent === '.p #9RQU2YQPL') {
        setTimeout(() => {
          playerAdapter.observeExternalBotMessage({
            id: 'stats-reply-1',
            channelId: ticketChannelId,
            guildId: GUILD_ID,
            authorId: DATA_BOT_ID,
            authorUsername: 'ClashPerk',
            authorBot: true,
            content: 'Player Tag: #9RQU2YQPL\nTown Hall: 16\nTrophies: 5400',
            embeds: [],
            mentionsUserIds: [],
            createdTimestamp: Date.now(),
          });
        }, 10);
      }
    };

    fakeGroq.queuedResponses.push((req) => {
      const sys = req.messages[0]?.content ?? '';
      expect(sys).toContain('Duke The Recruiter');
      expect(sys).toContain('Boom House is a top war & CWL clan family.');
      expect(sys).toContain('STRICTLY BANNED AI CLICHÉS');
      return {
        content: JSON.stringify({
          reply: "Awesome, got your tag! Passing `#9RQU2YQPL` to the leaders right now—they usually check within 15-30 mins.",
          extractedAnswers: { player_tag: '#9RQU2YQPL' },
          missingFields: [],
          requestedAction: 'lookup_player',
          lookupTarget: '#9RQU2YQPL',
          issueSummary: 'Opener wants to join Boom House (#9RQU2YQPL).',
          neutralAssessment: 'Profile verified.',
          complete: true,
        }),
        promptTokens: 250,
        completionTokens: 60,
      };
    });

    // Opener sends tag -> triggers 1-line `.p #9RQU2YQPL` inside ticket channel
    await conversationService.handleIncomingMessage({
      id: 'opener-1',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'PrinceOpener',
      authorBot: false,
      content: '#9RQU2YQPL',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    expect(messenger.sent.some((m) => m.payload.content === '.p #9RQU2YQPL')).toBe(true);
    const msgCountBeforeAdmin = messenger.sent.length;

    // Admin runs a manual bot command `.c boom` -> ignored silently, no AI turn triggered
    await conversationService.handleIncomingMessage({
      id: 'admin-cmd-1',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: ADMIN_ID,
      authorUsername: 'ClanLeader',
      authorBot: false,
      authorHasModeratorPermissions: true,
      content: '.c boom',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });
    expect(messenger.sent.length).toBe(msgCountBeforeAdmin);

    // Admin sends a real chat message to the player -> NEVER mistaken for opener; hands off to human staff!
    await conversationService.handleIncomingMessage({
      id: 'admin-chat-1',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: ADMIN_ID,
      authorUsername: 'ClanLeader',
      authorBot: false,
      authorHasModeratorPermissions: true,
      content: 'Hey welcome bro, sending you an invite to Boom House now!',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    expect(messenger.sent.length).toBe(msgCountBeforeAdmin);
    expect(fakeGroq.requests).toHaveLength(1);
    const finalSession = await repo.getTicketSessionByChannel(ticketChannelId);
    expect(finalSession?.playerDiscordId).toBe(PLAYER_ID);
    expect(finalSession?.status).toBe('human_handoff');
  });

  it('handles "i don\'t have" without ever re-asking for tag, collects TH backup info, and strips robotic AI tells', async () => {
    const STAFF_CH = '898989898989898989';
    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'Boom House',
        botEnabled: true,
        defaultWelcomeMessage: 'hey {user}! welcome to Boom House',
        ticketDetectionConfig: {
          requireProviderVerification: false,
          mentionUserOnWelcome: true,
        },
        aiSettings: {
          model: 'llama-3.3-70b-versatile',
          personaName: 'Duke The Recruiter',
          toneStyle: 'human_casual',
          humanizeConversation: true,
        },
        playerIntegrationConfig: {
          enabled: true,
          quickCommandLine: '.p {tag}',
          executionChannelMode: 'ticket_channel',
          externalBotUserId: DATA_BOT_ID,
        },
        reportSettings: {
          destinationMode: 'staff_channel',
          staffReportChannelId: STAFF_CH,
        },
      })
    );

    repo.setCategoryConfigs(GUILD_ID, [
      CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
        categoryName: 'Recruitment',
        enabled: true,
        playerLookupEnabled: true,
        questions: [
          {
            key: 'player_tag',
            question: "What's your player tag?",
            type: 'player_tag',
            required: true,
          },
        ],
      }),
    ]);

    const messenger = new LoopbackMessenger();
    const fakeGroq = new FakeGroqClient();
    const logger = new Logger('error');
    const qm = new TicketQueueManager();
    const configService = new ConfigService(repo, GUILD_ID, 'llama-3.3-70b-versatile', 0);
    const sessionManager = new SessionManager(GUILD_ID, repo, configService, messenger, qm, logger);
    const groqService = new GroqAiService(
      fakeGroq,
      new GlobalSemaphore(5),
      'llama-3.3-70b-versatile',
      logger
    );
    const playerAdapter = new PlayerDataBotAdapter(repo, messenger, logger);
    const reportService = new ModeratorReportService(repo, messenger, sessionManager, qm, logger);
    const conversationService = new ConversationService(
      repo,
      sessionManager,
      groqService,
      playerAdapter,
      messenger,
      qm,
      logger,
      configService
    );

    let deliveredPayload: Awaited<ReturnType<typeof reportService.generateAndDeliverReport>> = null;
    conversationService.setReportCallback(async (params) => {
      deliveredPayload = await reportService.generateAndDeliverReport(params);
    });

    const ticketChannelId = '740000000000000001';
    await sessionManager.observeChannelOrThreadCreated({
      exists: true,
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      name: 'ticket-prince',
      topic: `Opened by <@${PLAYER_ID}>`,
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    });

    // Turn 1: Player says "hi" -> even if LLM leaked "(#...)" & double "!", polisher strips them cleanly
    fakeGroq.queuedResponses.push(() => ({
      content: JSON.stringify({
        reply: "hey! looking to join Boom House? drop your player tag (#...) so i can check your base!",
        extractedAnswers: { player_tag: null },
        unavailableFields: [],
        missingFields: ['player_tag'],
        requestedAction: 'none',
        lookupTarget: null,
        issueSummary: null,
        neutralAssessment: null,
        complete: false,
      }),
      promptTokens: 200,
      completionTokens: 40,
    }));

    await conversationService.handleIncomingMessage({
      id: 'u-turn-1',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'Prince',
      authorBot: false,
      content: 'hi',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    const turn1BotMsg = messenger.sent[messenger.sent.length - 1]?.payload.content ?? '';
    expect(turn1BotMsg).not.toContain('(#...)');

    // Turn 2: Player says "i don't have" -> pre-turn marks player_tag [Unavailable], asks backup question, keeps session active
    fakeGroq.queuedResponses.push((req) => {
      const sys = req.messages[0]?.content ?? '';
      expect(sys).toContain('[Unavailable]');
      expect(sys).toContain('DO NOT ask for it again');
      return {
        content: JSON.stringify({
          reply: 'all good, what town hall level are you and what kind of clan vibe are you looking for?',
          extractedAnswers: { player_tag: null },
          unavailableFields: ['player_tag'],
          missingFields: [],
          requestedAction: 'none',
          lookupTarget: null,
          issueSummary: null,
          neutralAssessment: null,
          complete: false,
        }),
        promptTokens: 240,
        completionTokens: 45,
      };
    });

    await conversationService.handleIncomingMessage({
      id: 'u-turn-2',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'Prince',
      authorBot: false,
      content: "i don't have",
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    // Must NOT execute `.p [Unavailable]...` and must stay active for 1 backup turn
    expect(messenger.sent.some((m) => (m.payload.content ?? '').startsWith('.p '))).toBe(false);
    const sessionAfterTurn2 = await repo.getTicketSessionByChannel(ticketChannelId);
    expect(sessionAfterTurn2?.status).toBe('active');
    expect(deliveredPayload).toBeNull();

    // Turn 3: Player replies "im th12 and looking for home" -> player_tag is ALREADY complete ([Unavailable]), wraps up & sends report!
    fakeGroq.queuedResponses.push((req) => {
      const sys = req.messages[0]?.content ?? '';
      expect(sys).toContain('ALL REQUIRED INFO IS COMPLETE!');
      expect(sys).toContain('NEVER mention, hint at, or ask for (player_tag) again!');
      return {
        content: JSON.stringify({
          reply: "nice, th12 looking for a home works for us. We'll keep you in mind!",
          extractedAnswers: { player_tag: null },
          unavailableFields: [],
          missingFields: [],
          requestedAction: 'none',
          lookupTarget: null,
          issueSummary: 'TH12 player looking for a home clan; player tag unavailable.',
          neutralAssessment: 'Self-reported TH12 recruit ready for leadership placement.',
          complete: true,
        }),
        promptTokens: 280,
        completionTokens: 55,
      };
    });

    await conversationService.handleIncomingMessage({
      id: 'u-turn-3',
      channelId: ticketChannelId,
      guildId: GUILD_ID,
      authorId: PLAYER_ID,
      authorUsername: 'Prince',
      authorBot: false,
      content: 'im th12 and looking for home',
      embeds: [],
      mentionsUserIds: [],
      createdTimestamp: Date.now(),
    });

    const turn3TicketReplies = messenger.sent.filter((m) => m.channelId === ticketChannelId);
    const turn3BotMsg =
      turn3TicketReplies[turn3TicketReplies.length - 1]?.payload.content ?? '';
    expect(turn3BotMsg.toLowerCase()).not.toContain('keep you in mind');
    expect(turn3BotMsg).toContain('leaders');

    const sessionAfterTurn3 = await repo.getTicketSessionByChannel(ticketChannelId);
    expect(sessionAfterTurn3?.status).toBe('ready_for_review');
    expect(deliveredPayload).not.toBeNull();
    expect(deliveredPayload?.playerInformation.playerTag).toBe('Unavailable (not provided)');
    expect(deliveredPayload?.playerInformation.townHallLevel).toBe('12 (self-reported)');

    // Direct polisher checks for hallucinated "three dots" UI & verbatim copy-paste repetition
    const fixedThreeDots = polishHumanDiscordReply(
      "Just open the app, tap your profile icon, and press the three dots on your profile and copy it – that's your tag!"
    );
    expect(fixedThreeDots.toLowerCase()).not.toContain('three dots');
    expect(fixedThreeDots.toLowerCase()).toContain('top-left');

    const antiClone = polishHumanDiscordReply(
      'No worries, just let us know when you are online and one of our leaders will send an invite.',
      ['No worries, just let us know when you are online and one of our leaders will send an invite.']
    );
    expect(antiClone.toLowerCase()).not.toContain('no worries');
    expect(antiClone.toLowerCase()).toContain('my bad');
  });
});
