import 'dotenv/config';
import http from 'node:http';
import { Events } from 'discord.js';
import { buildLeastPrivilegeBotInviteUrl } from '@hrbot/shared';
import { ConfigService } from './config/configService.js';
import { loadBotEnv } from './config/env.js';
import { registerDiscordEvents } from './events/registerDiscordEvents.js';
import { PlayerDataBotAdapter } from './integrations/playerDataBotAdapter.js';
import { GlobalSemaphore, TicketQueueManager } from './queues/ticketQueueManager.js';
import { ClosureObserverService } from './services/closureObserverService.js';
import { ConversationService } from './services/conversationService.js';
import { SupabaseBotRepository } from './services/databaseRepository.js';
import { GroqAiService, OfficialGroqSdkClient } from './services/groqAiService.js';
import { Logger } from './services/logger.js';
import { ModeratorReportService } from './services/moderatorReportService.js';
import {
  createTicketObserverClient,
  DiscordjsSafeMessenger,
} from './services/safeDiscordMessenger.js';
import { SessionManager } from './services/sessionManager.js';

export async function startAssistantBot(): Promise<{ shutdown: () => Promise<void> }> {
  const env = loadBotEnv();
  const logger = new Logger(env.LOG_LEVEL, 'ticket-ai-bot');

  const repo = new SupabaseBotRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const client = createTicketObserverClient();
  const messenger = new DiscordjsSafeMessenger(client);
  const queueManager = new TicketQueueManager();
  const globalSemaphore = new GlobalSemaphore(5);
  const configService = new ConfigService(repo, env.DISCORD_GUILD_ID, env.GROQ_MODEL);

  const sessionManager = new SessionManager(
    env.DISCORD_GUILD_ID,
    repo,
    configService,
    messenger,
    queueManager,
    logger.child('session')
  );

  const groqClient = new OfficialGroqSdkClient(env.GROQ_API_KEY);
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

  conversationService.setReportCallback(async ({ session, issueSummary, neutralAssessment, signal }) => {
    await reportService.generateAndDeliverReport({
      session,
      issueSummary,
      neutralAssessment,
      signal,
    });
  });

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

  registerDiscordEvents({
    client,
    expectedGuildId: env.DISCORD_GUILD_ID,
    sessionManager,
    conversationService,
    closureObserver,
    logger: logger.child('events'),
  });

  let heartbeatTimer: NodeJS.Timeout | null = null;
  let webhookServer: http.Server | null = null;

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info('Connected to Discord Gateway as ticket conversation assistant', {
      botUserId: readyClient.user.id,
      guildId: env.DISCORD_GUILD_ID,
      inviteUrl: buildLeastPrivilegeBotInviteUrl(env.DISCORD_CLIENT_ID),
    });

    await repo.ensureServerSettings(env.DISCORD_GUILD_ID, env.GROQ_MODEL);
    await repo.updateHeartbeatAndMetrics(env.DISCORD_GUILD_ID);

    // Recover active sessions from Supabase & clean up tickets closed during downtime
    await sessionManager.recoverActiveSessions(async (closedChannelId) => {
      await closureObserver.confirmClosureAndCleanup(closedChannelId, 'startup_recovery');
    });

    closureObserver.startPeriodicReconciliation(env.CLOSURE_RECONCILE_INTERVAL_MS);

    heartbeatTimer = setInterval(() => {
      void repo.updateHeartbeatAndMetrics(env.DISCORD_GUILD_ID).catch(() => undefined);
    }, env.BOT_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  });

  // Optional signed webhook listener (disabled by default; Northflank core worker needs no HTTP port)
  if (env.WEBHOOK_PORT && env.WEBHOOK_PORT > 0 && env.TICKET_WEBHOOK_SECRET) {
    webhookServer = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/webhooks/ticket') {
        res.writeHead(404).end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const sig = req.headers['x-ticket-signature'];
        const sigStr = Array.isArray(sig) ? sig[0] : sig;

        void closureObserver
          .handleSignedWebhook({
            rawBody,
            signatureHeader: sigStr,
            secret: env.TICKET_WEBHOOK_SECRET,
          })
          .then((outcome) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(outcome));
          })
          .catch(() => {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_webhook' }));
          });
      });
    });

    webhookServer.listen(env.WEBHOOK_PORT, () => {
      logger.info('Optional signed ticket webhook listener started', {
        port: env.WEBHOOK_PORT,
      });
    });
  }

  await client.login(env.DISCORD_BOT_TOKEN);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Graceful shutdown initiated; preserving active session state in Supabase');

    closureObserver.stopPeriodicReconciliation();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (webhookServer) {
      await new Promise<void>((resolve) => webhookServer?.close(() => resolve()));
      webhookServer = null;
    }

    client.destroy();
    logger.info('Discord client destroyed cleanly');
  };

  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));

  return { shutdown };
}

// Run automatically when executed directly as entrypoint
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'));

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

