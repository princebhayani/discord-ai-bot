import {
  LookupActionSchema,
  ParsedPlayerProfileSchema,
  parseQuickDotCommands,
  type LookupAction,
  type ParsedPlayerProfile,
  type ParserConfig,
  type PlayerIntegrationConfig,
} from '@hrbot/shared';
import type {
  BotDatabaseRepository,
  PlayerLookupRecord,
  TicketSessionRecord,
} from '../services/databaseRepository.js';
import type { Logger } from '../services/logger.js';
import type {
  DiscordMessenger,
  NormalizedDiscordMessage,
} from '../services/safeDiscordMessenger.js';

interface PendingLookupWaiter {
  lookupId: string;
  sessionId: string;
  executionChannelId: string;
  expectedExternalBotId: string;
  queryTarget: string;
  parserConfig: ParserConfig;
  resolve: (msg: NormalizedDiscordMessage | null) => void;
  timer: NodeJS.Timeout;
}

const SAFE_LOOKUP_TARGET_REGEX = /^[#@A-Za-z0-9 _-]{2,64}$/;

/**
 * Validates and normalizes a lookup target so AI output can NEVER inject arbitrary
 * dot-commands, newlines, mentions (@everyone/@here), or shell characters.
 */
export function sanitizeLookupTarget(action: LookupAction, rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes('@everyone') || lower.includes('@here') || trimmed.startsWith('.') || trimmed.startsWith('/')) {
    return null;
  }

  if (action === 'lookup_player') {
    let tag = trimmed.toUpperCase().replace(/\s+/g, '');
    if (!tag.startsWith('#')) {
      tag = `#${tag}`;
    }
    if (!/^#[A-Z0-9]{3,16}$/.test(tag)) {
      return null;
    }
    return tag;
  }

  if (!SAFE_LOOKUP_TARGET_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Builds an approved external bot command strictly from configured templates
 * (supporting 1-line `quickCommandLine` definitions as well as explicit templates).
 */
export function renderApprovedCommand(
  config: PlayerIntegrationConfig,
  action: LookupAction,
  sanitizedTarget: string
): string | null {
  let effectivePrefix = config.commandPrefix;
  let effectiveSupported = config.supportedActions;
  let effectiveTemplates = config.commandTemplates;

  if (config.quickCommandLine && config.quickCommandLine.trim().length > 0) {
    const parsedQuick = parseQuickDotCommands(config.quickCommandLine, config.commandPrefix);
    if (parsedQuick.valid) {
      effectivePrefix = parsedQuick.commandPrefix;
      effectiveSupported = parsedQuick.supportedActions;
      effectiveTemplates = parsedQuick.commandTemplates;
    }
  }

  if (!effectiveSupported.includes(action)) {
    return null;
  }

  const template = effectiveTemplates[action];
  if (!template) {
    return null;
  }

  const rendered = template
    .replace(/\{prefix\}/g, effectivePrefix)
    .replace(/\{target\}/g, sanitizedTarget)
    .replace(/\{tag\}/gi, sanitizedTarget)
    .replace(/\{player_tag\}/g, sanitizedTarget)
    .replace(/\{clan_name\}/g, sanitizedTarget)
    .trim();

  if (rendered.includes('\n') || !rendered.startsWith(effectivePrefix)) {
    return null;
  }

  return rendered;
}

/**
 * Extracts structured player fields from an external data bot's embed and/or plain text response.
 */
export function parseExternalBotResponse(
  message: NormalizedDiscordMessage,
  parserConfig: ParserConfig
): ParsedPlayerProfile {
  const result: Record<string, unknown> = {
    extraFields: {} as Record<string, string>,
  };
  const extraFields: Record<string, string> = {};

  if (parserConfig.strategy === 'embed_and_regex' || parserConfig.strategy === 'embed_only') {
    for (const embed of message.embeds) {
      if (embed.title && !result.playerName) {
        result.playerName = embed.title.trim();
      }
      for (const field of embed.fields) {
        const cleanName = field.name.replace(/[*_:`]/g, '').trim();
        const cleanVal = field.value.replace(/[*_`]/g, '').trim();

        let matchedKnown = false;
        for (const [canonicalKey, aliases] of Object.entries(parserConfig.fieldMappings)) {
          if (aliases.some((a) => a.toLowerCase() === cleanName.toLowerCase())) {
            matchedKnown = true;
            if (
              ['townHallLevel', 'donations', 'trophies'].includes(canonicalKey)
            ) {
              const numeric = Number(cleanVal.replace(/[^0-9.-]/g, ''));
              result[canonicalKey] = Number.isFinite(numeric) && cleanVal.match(/\d/) ? numeric : cleanVal;
            } else {
              result[canonicalKey] = cleanVal;
            }
            break;
          }
        }

        if (!matchedKnown && cleanName && cleanVal) {
          extraFields[cleanName] = cleanVal.slice(0, 200);
        }
      }
    }
  }

  const fullText = [
    message.content,
    ...message.embeds.flatMap((e) => [
      e.title ?? '',
      e.description ?? '',
      e.footerText ?? '',
      ...e.fields.map((f) => `${f.name}: ${f.value}`),
    ]),
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  if (parserConfig.strategy === 'embed_and_regex' || parserConfig.strategy === 'regex_only') {
    for (const [canonicalKey, patternStr] of Object.entries(parserConfig.regexPatterns)) {
      if (result[canonicalKey] !== undefined && result[canonicalKey] !== null) {
        continue;
      }
      try {
        const re = new RegExp(patternStr, 'i');
        const m = re.exec(fullText);
        if (m) {
          const captured = (m[1] ?? m[0]).trim();
          if (['townHallLevel', 'donations', 'trophies'].includes(canonicalKey)) {
            const num = Number(captured.replace(/,/g, ''));
            result[canonicalKey] = Number.isFinite(num) ? num : captured;
          } else {
            result[canonicalKey] = captured;
          }
        }
      } catch {
        // Ignore malformed custom regex in config
      }
    }
  }

  result.extraFields = extraFields;
  result.rawSummary = fullText.slice(0, 900);

  return ParsedPlayerProfileSchema.parse(result);
}

/**
 * Dedicated adapter for safely communicating with an existing player-data Discord bot
 * (or approved external webhook/API endpoint when bots cannot invoke slash commands).
 */
export class PlayerDataBotAdapter {
  private readonly pendingWaiters = new Map<string, PendingLookupWaiter>();

  constructor(
    private readonly repo: BotDatabaseRepository,
    private readonly messenger: DiscordMessenger,
    private readonly logger: Logger
  ) {}

  /**
   * Observes incoming guild messages to capture responses ONLY from the configured external data bot.
   * Prevents bot-to-bot loops by ignoring our own bot, human users, and unconfigured bots.
   */
  observeExternalBotMessage(message: NormalizedDiscordMessage): boolean {
    const ourBotId = this.messenger.getBotUserId();
    if (ourBotId && message.authorId === ourBotId) {
      return false;
    }

    for (const [lookupId, waiter] of this.pendingWaiters.entries()) {
      if (
        message.channelId === waiter.executionChannelId &&
        message.authorId === waiter.expectedExternalBotId
      ) {
        clearTimeout(waiter.timer);
        this.pendingWaiters.delete(lookupId);
        waiter.resolve(message);
        return true;
      }
    }

    return false;
  }

  cancelPendingLookupsForSession(sessionId: string): void {
    for (const [lookupId, waiter] of this.pendingWaiters.entries()) {
      if (waiter.sessionId === sessionId) {
        clearTimeout(waiter.timer);
        this.pendingWaiters.delete(lookupId);
        waiter.resolve(null);
      }
    }
  }

  /**
   * Cancels all pending external bot lookup timers during graceful process shutdown.
   */
  cancelAllPendingLookups(): void {
    for (const [lookupId, waiter] of this.pendingWaiters.entries()) {
      clearTimeout(waiter.timer);
      this.pendingWaiters.delete(lookupId);
      waiter.resolve(null);
    }
  }

  async executeLookup(params: {
    session: TicketSessionRecord;
    rawAction: string;
    rawTarget: string;
    signal?: AbortSignal;
  }): Promise<PlayerLookupRecord | null> {
    const { session, rawAction, rawTarget, signal } = params;
    const config = session.configSnapshot.playerIntegrationConfig;

    if (!config.enabled || !session.configSnapshot.category.playerLookupEnabled) {
      return null;
    }

    const parsedAction = LookupActionSchema.safeParse(rawAction);
    if (!parsedAction.success) {
      return null;
    }
    const action = parsedAction.data;

    const sanitizedTarget = sanitizeLookupTarget(action, rawTarget);
    if (!sanitizedTarget) {
      return this.repo.createPlayerLookup({
        sessionId: session.id,
        actionType: action,
        queryTarget: rawTarget.slice(0, 64),
        approvedCommand: '[REJECTED_INVALID_TARGET]',
        status: 'failed',
        errorReason: 'Target failed strict format validation',
      });
    }

    const existingLookups = await this.repo.listPlayerLookups(session.id);
    const alreadyCompleted = existingLookups.find(
      (l) =>
        l.actionType === action &&
        l.queryTarget.toLowerCase() === sanitizedTarget.toLowerCase() &&
        l.status === 'completed'
    );
    if (alreadyCompleted) {
      return alreadyCompleted;
    }

    if (existingLookups.length >= config.maxLookupsPerTicket) {
      this.logger.warn('Maximum player lookups reached for ticket session', {
        sessionId: session.id,
      });
      return null;
    }

    const approvedCommand = renderApprovedCommand(config, action, sanitizedTarget);
    if (!approvedCommand) {
      return this.repo.createPlayerLookup({
        sessionId: session.id,
        actionType: action,
        queryTarget: sanitizedTarget,
        approvedCommand: '[UNSUPPORTED_ACTION]',
        status: 'unsupported',
        errorReason: 'Action is not enabled or has no approved command template',
      });
    }

    // Prevent self-loop: never configure our own bot ID as externalBotUserId
    const ourBotId = this.messenger.getBotUserId();
    if (config.externalBotUserId && ourBotId && config.externalBotUserId === ourBotId) {
      return this.repo.createPlayerLookup({
        sessionId: session.id,
        actionType: action,
        queryTarget: sanitizedTarget,
        approvedCommand,
        status: 'failed',
        errorReason: 'externalBotUserId cannot match assistant bot ID (loop protection)',
      });
    }

    // Option A: Approved external API/webhook integration (when external bot ignores bot accounts)
    if (config.externalApiWebhookUrl && config.externalApiWebhookUrl.trim() !== '') {
      const lookupRec = await this.repo.createPlayerLookup({
        sessionId: session.id,
        actionType: action,
        queryTarget: sanitizedTarget,
        approvedCommand: `API:${action}:${sanitizedTarget}`,
        status: 'pending',
      });

      try {
        const res = await fetch(config.externalApiWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, target: sanitizedTarget }),
          signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as unknown;
        const parsed = ParsedPlayerProfileSchema.parse(json);
        await this.repo.updateHeartbeatAndMetrics(session.guildId, {
          playerLookupsSucceeded: 1,
        });
        return await this.repo.updatePlayerLookup(lookupRec.id, {
          status: 'completed',
          parsedData: parsed,
          completedAt: new Date().toISOString(),
        });
      } catch (err) {
        await this.repo.updateHeartbeatAndMetrics(session.guildId, {
          playerLookupsFailed: 1,
        });
        return await this.repo.updatePlayerLookup(lookupRec.id, {
          status: 'failed',
          errorReason: err instanceof Error ? err.message : 'External API lookup failed',
          completedAt: new Date().toISOString(),
        });
      }
    }

    // Option B: Approved Discord command channel integration (dedicated channel OR current ticket channel)
    const targetExecutionChannelId =
      config.executionChannelMode === 'ticket_channel'
        ? session.channelId
        : config.executionChannelId;

    if (!targetExecutionChannelId || !config.externalBotUserId) {
      return this.repo.createPlayerLookup({
        sessionId: session.id,
        actionType: action,
        queryTarget: sanitizedTarget,
        approvedCommand,
        status: 'unsupported',
        errorReason: 'targetExecutionChannelId or externalBotUserId is not configured',
      });
    }

    const lookupRec = await this.repo.createPlayerLookup({
      sessionId: session.id,
      actionType: action,
      queryTarget: sanitizedTarget,
      approvedCommand,
      status: 'pending',
    });

    if (signal?.aborted) {
      return this.repo.updatePlayerLookup(lookupRec.id, {
        status: 'failed',
        errorReason: 'Session closed prior to lookup execution',
        completedAt: new Date().toISOString(),
      });
    }

    const responsePromise = new Promise<NormalizedDiscordMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingWaiters.delete(lookupRec.id);
        resolve(null);
      }, config.timeoutMs);

      const waiter: PendingLookupWaiter = {
        lookupId: lookupRec.id,
        sessionId: session.id,
        executionChannelId: targetExecutionChannelId,
        expectedExternalBotId: config.externalBotUserId,
        queryTarget: sanitizedTarget,
        parserConfig: config.parserConfig,
        resolve,
        timer,
      };
      this.pendingWaiters.set(lookupRec.id, waiter);

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            if (this.pendingWaiters.has(lookupRec.id)) {
              clearTimeout(timer);
              this.pendingWaiters.delete(lookupRec.id);
              resolve(null);
            }
          },
          { once: true }
        );
      }
    });

    try {
      const sentCmd = await this.messenger.sendMessage(targetExecutionChannelId, {
        content: approvedCommand,
      });
      await this.repo.updatePlayerLookup(lookupRec.id, {
        commandMessageId: sentCmd.messageId,
      });
    } catch (err) {
      this.cancelPendingLookupsForSession(session.id);
      await this.repo.updateHeartbeatAndMetrics(session.guildId, {
        playerLookupsFailed: 1,
      });
      return this.repo.updatePlayerLookup(lookupRec.id, {
        status: 'failed',
        errorReason:
          err instanceof Error
            ? `Failed sending command to execution channel: ${err.message}`
            : 'Command send failure',
        completedAt: new Date().toISOString(),
      });
    }

    const botResponseMsg = await responsePromise;
    if (!botResponseMsg) {
      await this.repo.updateHeartbeatAndMetrics(session.guildId, {
        playerLookupsFailed: 1,
      });
      return this.repo.updatePlayerLookup(lookupRec.id, {
        status: 'timed_out',
        errorReason: signal?.aborted
          ? 'Cancelled due to ticket closure'
          : 'Timed out waiting for configured external bot response (external bot may be offline or ignore bot accounts)',
        completedAt: new Date().toISOString(),
      });
    }

    const parsedProfile = parseExternalBotResponse(botResponseMsg, config.parserConfig);
    await this.repo.updateHeartbeatAndMetrics(session.guildId, {
      playerLookupsSucceeded: 1,
    });

    return this.repo.updatePlayerLookup(lookupRec.id, {
      responseMessageId: botResponseMsg.id,
      status: 'completed',
      parsedData: parsedProfile,
      completedAt: new Date().toISOString(),
    });
  }
}
