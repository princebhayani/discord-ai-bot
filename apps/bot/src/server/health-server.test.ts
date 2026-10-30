import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Events } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';
import { CategoryConfigSchema, ServerSettingsSchema } from '@hrbot/shared';
import { startAssistantBot, type RunningAssistantBot } from '../index.js';
import { InMemoryBotRepository } from '../services/databaseRepository.js';
import type {
  DiscordMessenger,
  ObservedChannelMetadata,
  OutgoingMessagePayload,
} from '../services/safeDiscordMessenger.js';
import { HealthServer } from './health-server.js';

class FakeDiscordGatewayClient extends EventEmitter {
  public readyState = false;
  public loginCalls = 0;
  public destroyCalls = 0;
  public user = { id: '555555555555555555' };
  private readonly loginImpl?: () => Promise<string>;

  constructor(loginImpl?: () => Promise<string>) {
    super();
    this.loginImpl = loginImpl;
  }

  isReady(): boolean {
    return this.readyState;
  }

  async login(token?: string): Promise<string> {
    this.loginCalls++;
    if (this.loginImpl) {
      return this.loginImpl();
    }
    this.readyState = true;
    this.emit(Events.ClientReady, this);
    return token ?? 'ok';
  }

  destroy(): void {
    this.readyState = false;
    this.destroyCalls++;
  }
}

async function getFreeTcpPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed allocating ephemeral test port')));
        return;
      }
      const assignedPort = addr.port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(assignedPort);
      });
    });
  });
}

function collectBotSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      files.push(...collectBotSourceFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Render Free Hosting: HTTP Health Server, Port Binding, Singletons & SIGTERM Recovery', () => {
  let activeRuntime: RunningAssistantBot | null = null;
  let standaloneHealthServer: HealthServer | null = null;

  afterEach(async () => {
    if (activeRuntime) {
      await activeRuntime.shutdown('test_cleanup');
      activeRuntime = null;
    }
    if (standaloneHealthServer) {
      await standaloneHealthServer.stop();
      standaloneHealthServer = null;
    }
  });

  it('HTTP HEALTH: serves /healthz (GET & HEAD), /readyz (503 <-> 200), 404 on unknown paths, Cache-Control: no-store, and leaks zero secrets', async () => {
    let discordReady = false;
    standaloneHealthServer = new HealthServer({
      port: 0,
      host: '0.0.0.0',
      isDiscordReady: () => discordReady,
    });

    const bound = await standaloneHealthServer.start();
    expect(bound.host).toBe('0.0.0.0');
    expect(bound.port).toBeGreaterThan(0);

    const baseUrl = `http://127.0.0.1:${bound.port}`;

    // 1. Before Discord connects: /healthz -> 200 {"status":"ok"}, /readyz -> 503
    const healthRes = await fetch(`${baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('content-type')).toContain('application/json');
    expect(healthRes.headers.get('cache-control')).toBe('no-store');
    const healthJson = (await healthRes.json()) as Record<string, unknown>;
    expect(healthJson).toEqual({ status: 'ok' });

    // HEAD /healthz
    const headHealthRes = await fetch(`${baseUrl}/healthz`, { method: 'HEAD' });
    expect(headHealthRes.status).toBe(200);
    expect(await headHealthRes.text()).toBe('');

    const notReadyRes = await fetch(`${baseUrl}/readyz`);
    expect(notReadyRes.status).toBe(503);
    expect(notReadyRes.headers.get('cache-control')).toBe('no-store');
    expect(await notReadyRes.json()).toEqual({
      status: 'not_ready',
      discordConnected: false,
    });

    // 2. After Discord connects: /readyz -> 200 {"status":"ready","discordConnected":true}
    discordReady = true;
    const readyRes = await fetch(`${baseUrl}/readyz`);
    expect(readyRes.status).toBe(200);
    expect(await readyRes.json()).toEqual({
      status: 'ready',
      discordConnected: true,
    });

    // 3. Unknown paths return 404
    const unknownRes = await fetch(`${baseUrl}/admin/secrets`);
    expect(unknownRes.status).toBe(404);
    expect(await unknownRes.json()).toEqual({ error: 'not_found' });
  });

  it('RENDER COMPATIBILITY: starts in production mode on process.env.PORT bound to 0.0.0.0, serves /healthz BEFORE Discord finishes connecting, survives Gateway disconnects, leaks zero secrets, and blocks duplicate startup', async () => {
    const assignedRenderPort = await getFreeTcpPort();
    const FAKE_TOKEN = 'SECRET_DISCORD_TOKEN_DO_NOT_LEAK_999';
    const FAKE_GROQ_KEY = 'gsk_SECRET_GROQ_API_KEY_DO_NOT_LEAK_999';
    const FAKE_SUPABASE_SECRET = 'sb_secret_SUPER_CONFIDENTIAL_DB_KEY_999';

    let completeDiscordLogin!: () => void;
    const loginGate = new Promise<void>((resolve) => {
      completeDiscordLogin = resolve;
    });

    const fakeClient = new FakeDiscordGatewayClient(async () => {
      await loginGate;
      fakeClient.readyState = true;
      fakeClient.emit(Events.ClientReady, fakeClient);
      return FAKE_TOKEN;
    });

    const repo = new InMemoryBotRepository();
    const messenger: DiscordMessenger = {
      getBotUserId: () => fakeClient.user.id,
      async sendMessage() {
        return { messageId: 'm-1' };
      },
      async sendTyping() {},
      async fetchChannelMetadata(channelId) {
        return {
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
        };
      },
      async fetchRecentMessages() {
        return [];
      },
    };

    // Start bot WITHOUT awaiting login completion yet so we verify /healthz is reachable while Discord connects!
    const startupPromise = startAssistantBot({
      rawEnv: {
        NODE_ENV: 'production',
        PORT: String(assignedRenderPort),
        DISCORD_BOT_TOKEN: FAKE_TOKEN,
        DISCORD_CLIENT_ID: '123456789012345678',
        DISCORD_GUILD_ID: '111111111111111111',
        GROQ_API_KEY: FAKE_GROQ_KEY,
        GROQ_MODEL: 'openai/gpt-oss-20b',
        SUPABASE_URL: 'https://example-project.supabase.co',
        SUPABASE_SECRET_KEY: FAKE_SUPABASE_SECRET,
        LOG_LEVEL: 'error',
      },
      repo,
      discordClient: fakeClient as never,
      messenger,
      groqClient: {
        async complete() {
          throw new Error('Groq must never be called by health checks');
        },
      },
      registerProcessSignals: false,
    });

    const baseUrl = `http://127.0.0.1:${assignedRenderPort}`;

    // Poll briefly until HTTP health server binds (happens BEFORE loginGate resolves!)
    let preConnectHealth: Response | null = null;
    for (let i = 0; i < 25; i++) {
      try {
        preConnectHealth = await fetch(`${baseUrl}/healthz`);
        if (preConnectHealth.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    expect(preConnectHealth?.status).toBe(200);
    const preConnectBody = await preConnectHealth!.text();
    expect(JSON.parse(preConnectBody)).toEqual({ status: 'ok' });

    // While Discord is still connecting, /readyz MUST return 503
    const preConnectReady = await fetch(`${baseUrl}/readyz`);
    expect(preConnectReady.status).toBe(503);
    const preReadyBody = await preConnectReady.text();
    expect(JSON.parse(preReadyBody)).toEqual({
      status: 'not_ready',
      discordConnected: false,
    });

    // Now allow Discord Gateway login to succeed
    completeDiscordLogin();
    activeRuntime = await startupPromise;

    expect(activeRuntime.env.NODE_ENV).toBe('production');
    expect(activeRuntime.boundAddress.host).toBe('0.0.0.0');
    expect(activeRuntime.boundAddress.port).toBe(assignedRenderPort);
    expect(fakeClient.loginCalls).toBe(1);

    // Attempting to start a second bot/HTTP instance in the same process must fail immediately
    await expect(
      startAssistantBot({
        rawEnv: {
          NODE_ENV: 'production',
          PORT: '0',
          DISCORD_BOT_TOKEN: FAKE_TOKEN,
          DISCORD_CLIENT_ID: '123456789012345678',
          DISCORD_GUILD_ID: '111111111111111111',
          GROQ_API_KEY: FAKE_GROQ_KEY,
          GROQ_MODEL: 'openai/gpt-oss-20b',
          SUPABASE_URL: 'https://example-project.supabase.co',
          SUPABASE_SECRET_KEY: FAKE_SUPABASE_SECRET,
          LOG_LEVEL: 'error',
        },
        repo,
        discordClient: fakeClient as never,
        messenger,
        registerProcessSignals: false,
      })
    ).rejects.toThrow(/already active/i);

    // /readyz is now 200
    const postConnectReady = await fetch(`${baseUrl}/readyz`);
    expect(postConnectReady.status).toBe(200);
    expect(await postConnectReady.json()).toEqual({
      status: 'ready',
      discordConnected: true,
    });

    // Simulate temporary Discord Gateway disconnection
    fakeClient.readyState = false;
    fakeClient.emit(Events.ShardDisconnect, { code: 1006 });

    const duringDisconnectHealth = await fetch(`${baseUrl}/healthz`);
    expect(duringDisconnectHealth.status).toBe(200);
    expect(await duringDisconnectHealth.json()).toEqual({ status: 'ok' });

    const duringDisconnectReady = await fetch(`${baseUrl}/readyz`);
    expect(duringDisconnectReady.status).toBe(503);
    expect(await duringDisconnectReady.json()).toEqual({
      status: 'not_ready',
      discordConnected: false,
    });

    // Simulate Gateway ShardResume
    fakeClient.readyState = true;
    fakeClient.emit(Events.ShardResume, 0, 5);

    const resumedReady = await fetch(`${baseUrl}/readyz`);
    expect(resumedReady.status).toBe(200);

    // Verify ZERO secrets ever appeared in any HTTP payload
    for (const body of [preConnectBody, preReadyBody]) {
      expect(body).not.toContain(FAKE_TOKEN);
      expect(body).not.toContain(FAKE_GROQ_KEY);
      expect(body).not.toContain(FAKE_SUPABASE_SECRET);
      expect(body).not.toContain('supabase.co');
    }
  });

  it('STATIC RENDER AUDIT: only one http.createServer exists in bot codebase, zero self-ping keep-alive loops exist, and no hardcoded production port bindings exist', () => {
    const botSrcDir = path.resolve(__dirname, '..');
    const files = collectBotSourceFiles(botSrcDir);

    let createServerCount = 0;
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      const matches = code.match(/http\.createServer\s*\(/g);
      if (matches) {
        createServerCount += matches.length;
        expect(path.basename(file)).toBe('health-server.ts');
      }

      // Must never bind exclusively to localhost / 127.0.0.1 or hardcode a numeric port in .listen(...)
      expect(/\.listen\s*\(\s*\d+/.test(code), `Hardcoded port in ${file}`).toBe(false);
      expect(
        /\.listen\s*\([^)]*['"](localhost|127\.0\.0\.1)['"]/.test(code),
        `Localhost-only binding in ${file}`
      ).toBe(false);

      // Must never self-ping /healthz or onrender.com in an internal loop
      expect(code).not.toContain('onrender.com/healthz');
    }

    expect(createServerCount).toBe(1);
  });

  it('SIGTERM RECOVERY & SESSION RESTORATION: drains in-flight ticket task, preserves active Supabase session across restart, and restores without duplicate welcome messages', async () => {
    const GUILD_ID = '111111111111111111';
    const CAT_ID = '222222222222222222';
    const TICKET_CH = '777777777777777777';

    const repo = new InMemoryBotRepository();
    repo.setServerSettings(
      ServerSettingsSchema.parse({
        guildId: GUILD_ID,
        guildName: 'Render Guild',
        botEnabled: true,
        defaultWelcomeMessage: 'Welcome! I am the automated assistant.',
        ticketDetectionConfig: { requireProviderVerification: false },
        aiSettings: { model: 'openai/gpt-oss-20b' },
        playerIntegrationConfig: { enabled: false },
        reportSettings: {},
      })
    );
    repo.setCategoryConfigs(GUILD_ID, [
      CategoryConfigSchema.parse({
        guildId: GUILD_ID,
        categoryId: CAT_ID,
        categoryName: 'Support',
        enabled: true,
        welcomeMessage: 'Hello from Support Assistant!',
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

    const sentPayloads: OutgoingMessagePayload[] = [];
    const ticketChannelMeta: ObservedChannelMetadata = {
      exists: true,
      channelId: TICKET_CH,
      guildId: GUILD_ID,
      name: 'ticket-player1',
      topic: null,
      categoryId: CAT_ID,
      parentChannelId: null,
      isThread: false,
      isPrivateThread: false,
      ownerId: null,
      archived: false,
      locked: false,
    };

    const messenger: DiscordMessenger = {
      getBotUserId: () => '555555555555555555',
      async sendMessage(_channelId, payload) {
        sentPayloads.push(payload);
        return { messageId: `msg-${sentPayloads.length}` };
      },
      async sendTyping() {},
      async fetchChannelMetadata(channelId) {
        if (channelId === TICKET_CH) return ticketChannelMeta;
        return {
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
        };
      },
      async fetchRecentMessages() {
        return [];
      },
    };

    // --- Instance 1: Start bot, open ticket, enqueue an in-flight task, then simulate SIGTERM ---
    const client1 = new FakeDiscordGatewayClient();
    const port1 = await getFreeTcpPort();
    activeRuntime = await startAssistantBot({
      rawEnv: {
        NODE_ENV: 'production',
        PORT: String(port1),
        SHUTDOWN_TIMEOUT_MS: '3000',
        DISCORD_BOT_TOKEN: 'test-token-1',
        DISCORD_CLIENT_ID: '123456789012345678',
        DISCORD_GUILD_ID: GUILD_ID,
        GROQ_API_KEY: 'test-groq-key',
        GROQ_MODEL: 'openai/gpt-oss-20b',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'test-supabase-secret',
        LOG_LEVEL: 'error',
      },
      repo,
      discordClient: client1 as never,
      messenger,
      registerProcessSignals: false,
    });

    // Wait briefly for post-connect recovery to settle
    await new Promise((r) => setTimeout(r, 30));

    // Observe ticket creation -> sends 1 welcome message & persists active session + answer
    const session = await activeRuntime.sessionManager.observeChannelOrThreadCreated(ticketChannelMeta);
    expect(session).not.toBeNull();
    expect(sentPayloads).toHaveLength(1);

    await repo.upsertTicketAnswer({
      sessionId: session!.id,
      questionKey: 'player_tag',
      answerValue: '#ABC123',
      rawText: 'My tag is #ABC123',
      validated: true,
      validationNote: null,
    });

    // Start an in-flight ticket operation that takes 60ms
    let inFlightFinished = false;
    const inFlightPromise = activeRuntime.queueManager.enqueueForTicket(TICKET_CH, async () => {
      await new Promise((r) => setTimeout(r, 60));
      inFlightFinished = true;
      return 'done';
    });

    // Simulate SIGTERM shutdown while in-flight operation is running
    const shutdownPromise = activeRuntime.shutdown('SIGTERM');

    // New tasks enqueued after shutdown begins must be rejected/ignored safely
    const postShutdownTask = await activeRuntime.queueManager.enqueueForTicket(
      TICKET_CH,
      async () => 'should_not_run'
    );
    expect(postShutdownTask).toBeUndefined();

    await shutdownPromise;
    await inFlightPromise;
    const stoppedRuntime = activeRuntime;
    activeRuntime = null;

    // Verify graceful drain completed the in-flight operation, destroyed Discord client, closed HTTP server, and cleared memory
    expect(inFlightFinished).toBe(true);
    expect(client1.destroyCalls).toBe(1);
    expect(stoppedRuntime.healthServer.isRunning()).toBe(false);
    expect(stoppedRuntime.sessionManager.getMemoryStateCounts().activeSessions).toBe(0);

    // CRITICAL: Active ticket session and questionnaire answers MUST still exist in Supabase after SIGTERM!
    const persistedSession = await repo.getTicketSessionByChannel(TICKET_CH);
    expect(persistedSession).not.toBeNull();
    expect(persistedSession?.welcomeSent).toBe(true);
    const persistedAnswers = await repo.listTicketAnswers(session!.id);
    expect(persistedAnswers).toHaveLength(1);
    expect(persistedAnswers[0]?.answerValue).toBe('#ABC123');

    // --- Instance 2: Restart bot on new Render container and verify seamless restoration ---
    const client2 = new FakeDiscordGatewayClient();
    const port2 = await getFreeTcpPort();
    activeRuntime = await startAssistantBot({
      rawEnv: {
        NODE_ENV: 'production',
        PORT: String(port2),
        DISCORD_BOT_TOKEN: 'test-token-1',
        DISCORD_CLIENT_ID: '123456789012345678',
        DISCORD_GUILD_ID: GUILD_ID,
        GROQ_API_KEY: 'test-groq-key',
        GROQ_MODEL: 'openai/gpt-oss-20b',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'test-supabase-secret',
        LOG_LEVEL: 'error',
      },
      repo,
      discordClient: client2 as never,
      messenger,
      registerProcessSignals: false,
    });

    // Wait for async ClientReady -> runPostConnectRecovery()
    await new Promise((r) => setTimeout(r, 50));

    // Active session restored into memory WITHOUT sending a duplicate welcome message!
    expect(sentPayloads).toHaveLength(1);
    const restoredInMem = activeRuntime.sessionManager.getActiveSessionInMemory(TICKET_CH);
    expect(restoredInMem).toBeDefined();
    expect(restoredInMem?.id).toBe(session!.id);
  });
});
