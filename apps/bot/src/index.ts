import dns from 'node:dns';
import net from 'node:net';
import 'dotenv/config';
import { Events, type Client } from 'discord.js';

// Force IPv4-first DNS resolution and disable Happy Eyeballs IPv6 auto-selection so
// Node 22/24 undici fetch() connects reliably to Supabase from IPv4-only Render containers.
dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
import { buildLeastPrivilegeBotInviteUrl } from '@hrbot/shared';
import { ConfigService } from './config/configService.js';
import { loadBotEnv, type BotEnv } from './config/env.js';
import { registerDiscordEvents } from './events/registerDiscordEvents.js';
import { PlayerDataBotAdapter } from './integrations/playerDataBotAdapter.js';
import { GlobalSemaphore, TicketQueueManager } from './queues/ticketQueueManager.js';
import { HealthServer } from './server/health-server.js';
import { ClosureObserverService } from './services/closureObserverService.js';
import { ConversationService } from './services/conversationService.js';
import {
  SupabaseBotRepository,
  type BotDatabaseRepository,
} from './services/databaseRepository.js';
import {
  GroqAiService,
  OfficialGroqSdkClient,
  type GroqCompletionClient,
} from './services/groqAiService.js';
import { getMemoryUsageMb, Logger } from './services/logger.js';
import { ModeratorReportService } from './services/moderatorReportService.js';
import {
  createTicketObserverClient,
  DiscordjsSafeMessenger,
  type DiscordMessenger,
} from './services/safeDiscordMessenger.js';
import { SessionManager } from './services/sessionManager.js';

export interface StartAssistantBotOptions {
  rawEnv?: NodeJS.ProcessEnv;
  repo?: BotDatabaseRepository;
  discordClient?: Pick<Client, 'login' | 'destroy' | 'isReady' | 'on' | 'once' | 'user'>;
  messenger?: DiscordMessenger;
  groqClient?: GroqCompletionClient;
  registerProcessSignals?: boolean;
}

export interface RunningAssistantBot {
  env: BotEnv;
  healthServer: HealthServer;
  boundAddress: { host: string; port: number };
  queueManager: TicketQueueManager;
  sessionManager: SessionManager;
  isDiscordConnected: () => boolean;
  shutdown: (reason?: string) => Promise<void>;
}

let activeBotRuntime: RunningAssistantBot | null = null;

/**
 * Starts the Discord AI Ticket Conversation Assistant and built-in HTTP health server
 * inside a single Node.js process suitable for Render's Free Web Service plan.
 */
export async function startAssistantBot(
  options: StartAssistantBotOptions = {}
): Promise<RunningAssistantBot> {
  if (activeBotRuntime) {
    throw new Error(
      'Assistant bot runtime is already active in this process; refusing to start a duplicate instance.'
    );
  }

  // 1. Load and validate environment variables
  const env = loadBotEnv(options.rawEnv ?? process.env);

  // 2. Initialize application logging + numeric memory diagnostics
  const logger = new Logger(env.LOG_LEVEL, 'ticket-ai-bot');
  let supabaseHost = 'unknown';
  try {
    supabaseHost = new URL(env.SUPABASE_URL).host;
  } catch {
    supabaseHost = 'invalid_url';
  }
  logger.info('Bootstrapping Discord Ticket AI Assistant', {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    supabaseHost,
    memoryMb: getMemoryUsageMb(),
  });

  // 3. Initialize the Supabase repository client
  const repo: BotDatabaseRepository =
    options.repo ?? new SupabaseBotRepository(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

  // 4. Initialize the single low-memory Discord client
  const client = (options.discordClient ?? createTicketObserverClient()) as Client;
  const messenger: DiscordMessenger = options.messenger ?? new DiscordjsSafeMessenger(client);
  const queueManager = new TicketQueueManager();
  const globalSemaphore = new GlobalSemaphore(3);
  const configService = new ConfigService(repo, env.DISCORD_GUILD_ID, env.GROQ_MODEL);

  const sessionManager = new SessionManager(
    env.DISCORD_GUILD_ID,
    repo,
    configService,
    messenger,
    queueManager,
    logger.child('session')
  );

  const groqClient: GroqCompletionClient =
    options.groqClient ?? new OfficialGroqSdkClient(env.GROQ_API_KEY);
  const groqService = new GroqAiService(
    groqClient,
    globalSemaphore,
    env.GROQ_MODEL,
    logger.child('groq')
  );

  const playerAdapter = new PlayerDataBotAdapter(
    repo,
    messenger,
    logger.child('player-adapter')
  );

  const reportService = new ModeratorReportService(
    repo,
    messenger,
    sessionManager,
    queueManager,
    logger.child('report')
  );

  const conversationService = new ConversationService(
    repo,
    sessionManager,
    groqService,
    playerAdapter,
    messenger,
    queueManager,
    logger.child('conversation')
  );

  conversationService.setReportCallback(
    async ({ session, issueSummary, neutralAssessment, signal }) => {
      await reportService.generateAndDeliverReport({
        session,
        issueSummary,
        neutralAssessment,
        signal,
      });
    }
  );

  const closureObserver = new ClosureObserverService(
    env.DISCORD_GUILD_ID,
    repo,
    configService,
    sessionManager,
    queueManager,
    playerAdapter,
    messenger,
    logger.child('closure')
  );

  if (!options.discordClient) {
    registerDiscordEvents({
      client,
      expectedGuildId: env.DISCORD_GUILD_ID,
      sessionManager,
      conversationService,
      closureObserver,
      logger: logger.child('events'),
    });
  }

  let discordConnected = false;
  let shuttingDown = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let loginRetryTimer: NodeJS.Timeout | null = null;
  let recoveryRetryTimer: NodeJS.Timeout | null = null;

  // 5. Start the single built-in HTTP health server BEFORE connecting Discord Gateway
  const healthServer = new HealthServer({
    port: env.PORT,
    host: '0.0.0.0',
    isDiscordReady: () => !shuttingDown && discordConnected && Boolean(client.isReady()),
    webhookHandler: env.TICKET_WEBHOOK_SECRET
      ? async (rawBody, signatureHeader) =>
          closureObserver.handleSignedWebhook({
            rawBody,
            signatureHeader,
            secret: env.TICKET_WEBHOOK_SECRET,
          })
      : undefined,
    logger: logger.child('health'),
  });

  const boundAddress = await healthServer.start();

  const runPostConnectRecovery = async (): Promise<void> => {
    if (shuttingDown) return;
    try {
      await repo.ensureServerSettings(env.DISCORD_GUILD_ID, env.GROQ_MODEL);
      await repo.updateHeartbeatAndMetrics(env.DISCORD_GUILD_ID);

      // Recover active sessions from Supabase without sending duplicate welcome messages,
      // and clean up any tickets confirmed closed during downtime.
      await sessionManager.recoverActiveSessions(async (closedChannelId) => {
        await closureObserver.confirmClosureAndCleanup(closedChannelId, 'startup_recovery');
      });
    } catch (err) {
      logger.error('Temporary Supabase error during session recovery; scheduling retry', {
        error: err instanceof Error ? err.message : 'supabase_recovery_error',
      });
      if (!shuttingDown && !recoveryRetryTimer) {
        recoveryRetryTimer = setTimeout(() => {
          recoveryRetryTimer = null;
          void runPostConnectRecovery();
        }, 10_000);
        recoveryRetryTimer.unref?.();
      }
    }
  };

  // 7. Track Discord Gateway readiness & reconnection states without exiting the HTTP server
  client.once(Events.ClientReady, (readyClient) => {
    discordConnected = true;
    logger.info('Connected to Discord Gateway as ticket conversation assistant', {
      botUserId: readyClient.user?.id ?? 'unknown',
      guildId: env.DISCORD_GUILD_ID,
      inviteUrl: buildLeastPrivilegeBotInviteUrl(env.DISCORD_CLIENT_ID),
      memoryMb: getMemoryUsageMb(),
    });

    void runPostConnectRecovery();
    closureObserver.startPeriodicReconciliation(env.CLOSURE_RECONCILE_INTERVAL_MS);

    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        sessionManager.pruneExpiredCandidates();
        logger.debug('Periodic bot heartbeat & memory check', {
          memoryMb: getMemoryUsageMb(),
          ...sessionManager.getMemoryStateCounts(),
          inFlightTickets: queueManager.getInFlightCount(),
        });
        void repo.updateHeartbeatAndMetrics(env.DISCORD_GUILD_ID).catch(() => undefined);
      }, env.BOT_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
    }
  });

  client.on(Events.ShardReady, () => {
    if (!shuttingDown) {
      discordConnected = true;
    }
  });

  client.on(Events.ShardResume, () => {
    if (!shuttingDown) {
      discordConnected = true;
      logger.info('Discord Gateway shard resumed', { memoryMb: getMemoryUsageMb() });
    }
  });

  client.on(Events.ShardDisconnect, (closeEvent) => {
    discordConnected = false;
    logger.warn('Discord Gateway disconnected; /healthz remains alive while Gateway reconnects', {
      closeCode: closeEvent?.code ?? null,
    });
  });

  client.on(Events.Invalidated, () => {
    discordConnected = false;
    logger.error('Discord Gateway session invalidated');
  });

  client.on(Events.Error, (err) => {
    logger.error('Discord client error observed', {
      error: err instanceof Error ? err.message : 'discord_client_error',
    });
  });

  // 6. Connect the Discord Gateway (handle temporary Gateway outages gracefully)
  const connectDiscordWithRetry = async (attempt = 1): Promise<void> => {
    if (shuttingDown) return;
    try {
      await client.login(env.DISCORD_BOT_TOKEN);
    } catch (err) {
      discordConnected = false;
      const msg = err instanceof Error ? err.message : 'discord_login_failed';
      // Fail fast only if the token itself is explicitly rejected as invalid
      if (/tokeninvalid|incorrect login details|invalid token/i.test(msg)) {
        await healthServer.stop();
        activeBotRuntime = null;
        throw err;
      }

      const backoffMs = Math.min(30_000, attempt * 3_000);
      logger.error('Temporary Discord Gateway connection failure; retrying while /healthz stays up', {
        attempt,
        backoffMs,
        error: msg,
      });
      if (!shuttingDown) {
        loginRetryTimer = setTimeout(() => {
          loginRetryTimer = null;
          void connectDiscordWithRetry(attempt + 1);
        }, backoffMs);
        loginRetryTimer.unref?.();
      }
    }
  };

  // Ordered graceful shutdown (Section 9)
  const shutdown = async (reason = 'manual'): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    discordConnected = false;

    logger.info('Graceful shutdown initiated; preserving active ticket data in Supabase', {
      reason,
      inFlightTickets: queueManager.getInFlightCount(),
      memoryMb: getMemoryUsageMb(),
    });

    // Step 1: Stop accepting new HTTP requests where appropriate
    healthServer.markShuttingDown();

    // Step 2: Stop accepting new ticket processing tasks
    queueManager.beginShutdown();

    // Cancel background timers
    closureObserver.stopPeriodicReconciliation();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (loginRetryTimer) {
      clearTimeout(loginRetryTimer);
      loginRetryTimer = null;
    }
    if (recoveryRetryTimer) {
      clearTimeout(recoveryRetryTimer);
      recoveryRetryTimer = null;
    }

    // Step 3: Allow in-flight ticket operations a bounded time to finish
    const drainResult = await queueManager.waitForInFlightTasks(env.SHUTDOWN_TIMEOUT_MS);
    if (!drainResult.completedCleanly) {
      logger.warn('Bounded shutdown timeout reached; aborted remaining in-flight operations', {
        remainingCount: drainResult.remainingCount,
      });
    }

    // Cancel any stale pending external lookup timers
    playerAdapter.cancelAllPendingLookups();

    // Step 4: Close the Discord client
    try {
      client.destroy();
    } catch {
      // Ignore client destroy errors during shutdown
    }

    // Step 5: Close the HTTP server
    await healthServer.stop();

    // Step 6: Clear temporary in-memory state (never deleting active Supabase ticket rows)
    sessionManager.clearMemoryState();
    queueManager.clearMemoryState();

    if (options.registerProcessSignals !== false) {
      process.off('SIGTERM', onSigTerm);
      process.off('SIGINT', onSigInt);
    }

    activeBotRuntime = null;
    logger.info('Graceful shutdown complete');
  };

  const onSigTerm = () => {
    void shutdown('SIGTERM').finally(() => process.exit(0));
  };
  const onSigInt = () => {
    void shutdown('SIGINT').finally(() => process.exit(0));
  };

  if (options.registerProcessSignals !== false) {
    process.once('SIGTERM', onSigTerm);
    process.once('SIGINT', onSigInt);
  }

  const runtime: RunningAssistantBot = {
    env,
    healthServer,
    boundAddress,
    queueManager,
    sessionManager,
    isDiscordConnected: () => !shuttingDown && discordConnected && Boolean(client.isReady()),
    shutdown,
  };
  activeBotRuntime = runtime;

  await connectDiscordWithRetry();

  return runtime;
}

// Run automatically when executed directly as entrypoint
const normalizedArgv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
const isDirectExecution =
  normalizedArgv1.endsWith('/apps/bot/src/index.ts') ||
  normalizedArgv1.endsWith('/apps/bot/dist/index.js') ||
  normalizedArgv1 === 'src/index.ts' ||
  normalizedArgv1 === 'dist/index.js';

if (isDirectExecution) {
  startAssistantBot().catch((err) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        component: 'bootstrap',
        msg: 'Fatal startup error',
        error: err instanceof Error ? err.message : 'unknown_startup_error',
      })
    );
    process.exit(1);
  });
}
