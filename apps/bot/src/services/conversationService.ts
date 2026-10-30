import {
  evaluateQuestionnaireProgress,
  sanitizeSensitiveContent,
  validateAnswerValue,
  type AnswerPrimitive,
  type ParsedPlayerProfile,
} from '@hrbot/shared';
import type { ConfigService } from '../config/configService.js';
import {
  extractOpenerFromBotMessages,
  resolveOpenerFromChannelMetadata,
} from '../handlers/ticketDetector.js';
import type { PlayerDataBotAdapter } from '../integrations/playerDataBotAdapter.js';
import type { TicketQueueManager } from '../queues/ticketQueueManager.js';
import type {
  BotDatabaseRepository,
  TicketSessionRecord,
} from './databaseRepository.js';
import type { GroqAiService } from './groqAiService.js';
import type { Logger } from './logger.js';
import type {
  DiscordMessenger,
  NormalizedDiscordMessage,
} from './safeDiscordMessenger.js';
import type { SessionManager } from './sessionManager.js';

export type ReportTriggerCallback = (params: {
  session: TicketSessionRecord;
  issueSummary: string | null;
  neutralAssessment: string | null;
  signal: AbortSignal;
}) => Promise<void>;

export class ConversationService {
  private onReadyForReport?: ReportTriggerCallback;

  constructor(
    private readonly repo: BotDatabaseRepository,
    private readonly sessionManager: SessionManager,
    private readonly groqService: GroqAiService,
    private readonly playerAdapter: PlayerDataBotAdapter,
    private readonly messenger: DiscordMessenger,
    private readonly queueManager: TicketQueueManager,
    private readonly logger: Logger,
    private readonly configService?: ConfigService
  ) {}

  setReportCallback(cb: ReportTriggerCallback): void {
    this.onReadyForReport = cb;
  }

  /**
   * Handles incoming MessageCreate events strictly for active eligible ticket sessions.
   * Never stores messages from general channels, disabled categories, or unrelated tickets.
   */
  async handleIncomingMessage(message: NormalizedDiscordMessage): Promise<void> {
    // 1. First let external player-data bot adapter inspect if this is a pending lookup reply
    this.playerAdapter.observeExternalBotMessage(message);

    // 2. Ignore bot messages for conversational turns (prevents bot-to-bot loops)
    if (message.authorBot) {
      await this.sessionManager.tryPromotePendingCandidateOnMessage(message);
      return;
    }

    // 3. Check if channel has an active AI ticket session (never store unrelated channel messages)
    const activeCheck = await this.sessionManager.resolveActiveSession(message.channelId);
    if (!activeCheck) {
      return;
    }

    if (
      activeCheck.status === 'closing' ||
      activeCheck.status === 'human_handoff' ||
      this.queueManager.isClosingOrAborted(message.channelId)
    ) {
      return;
    }

    // Duplicate message protection
    if (!this.queueManager.markMessageSeen(message.id)) {
      return;
    }

    await this.queueManager.enqueueForTicket(message.channelId, async (signal) => {
      if (signal.aborted) return;

      let currentSession = await this.sessionManager.resolveActiveSession(message.channelId);
      if (
        !currentSession ||
        currentSession.status === 'closing' ||
        currentSession.status === 'human_handoff'
      ) {
        return;
      }

      const reportSettings = currentSession.configSnapshot.reportSettings;
      const ourBotId = this.messenger.getBotUserId();
      const externalBotId =
        currentSession.configSnapshot.playerIntegrationConfig.externalBotUserId || null;

      // 1. Ensure the SINGLE ticket opener (`playerDiscordId`) is locked in before classifying the speaker
      if (!currentSession.playerDiscordId) {
        let providerBotIds: string[] = [];
        if (this.configService) {
          try {
            const guildCfg = await this.configService.getGuildConfiguration();
            providerBotIds = guildCfg.serverSettings.ticketDetectionConfig.providerBotIds;
          } catch {
            providerBotIds = [];
          }
        }

        const knownBotIds = new Set<string>(
          [ourBotId, externalBotId, ...providerBotIds].filter((id): id is string => Boolean(id))
        );

        let discoveredOpenerId: string | null = null;
        let chanMeta = null;
        try {
          const [recentMsgs, fetchedMeta] = await Promise.all([
            this.messenger.fetchRecentMessages(currentSession.channelId, 10),
            this.messenger.fetchChannelMetadata(currentSession.channelId),
          ]);
          chanMeta = fetchedMeta;
          discoveredOpenerId =
            extractOpenerFromBotMessages({
              messages: recentMsgs,
              knownBotIds,
              ourBotUserId: ourBotId,
              externalDataBotId: externalBotId,
              staffUserIds: reportSettings.staffUserIds,
            }) ??
            resolveOpenerFromChannelMetadata({
              channel: fetchedMeta,
              knownBotIds,
              staffUserIds: reportSettings.staffUserIds,
            });
        } catch {
          discoveredOpenerId = null;
        }

        if (!discoveredOpenerId) {
          const authorHasStaffRole = Boolean(
            message.authorRoleIds?.some((r) => reportSettings.staffRoleIds.includes(r))
          );
          const authorLooksLikeAdmin =
            reportSettings.staffUserIds.includes(message.authorId) ||
            authorHasStaffRole ||
            Boolean(message.authorHasModeratorPermissions);

          const soleHumanMemberOverwrite =
            chanMeta?.permissionMemberIds?.length === 1 &&
            chanMeta.permissionMemberIds[0] === message.authorId;

          // Only lock the speaker as ticket opener if they are NOT an admin/staff member
          // (unless they personally opened the ticket and are the sole member overwrite)
          if (!authorLooksLikeAdmin || soleHumanMemberOverwrite) {
            discoveredOpenerId = message.authorId;
          }
        }

        if (discoveredOpenerId) {
          const updatedOpener = await this.repo.updateTicketSession(currentSession.id, {
            playerDiscordId: discoveredOpenerId,
            playerUsername:
              discoveredOpenerId === message.authorId
                ? message.authorUsername
                : currentSession.playerUsername,
          });
          if (updatedOpener) {
            currentSession = updatedOpener;
            this.sessionManager.setSessionInMemory(currentSession);
          }
        }
      }

      // 2. Enforce Single Ticket Opener Rule:
      // Every ticket has ONE ticket opener (`playerDiscordId`). Anyone else speaking in the ticket
      // is an Admin / Staff member and must NEVER be treated as the player!
      const isTicketOpener =
        Boolean(currentSession.playerDiscordId) &&
        message.authorId === currentSession.playerDiscordId;

      if (!isTicketOpener) {
        const trimmedContent = message.content.trim();
        const cmdPrefix =
          currentSession.configSnapshot.playerIntegrationConfig.commandPrefix || '.';
        const isBotCommandInvocation =
          trimmedContent.startsWith(cmdPrefix) ||
          trimmedContent.startsWith('.') ||
          trimmedContent.startsWith('!') ||
          trimmedContent.startsWith('/') ||
          trimmedContent.startsWith('?');

        if (isBotCommandInvocation) {
          this.logger.debug('Ignored admin/staff bot command inside ticket', {
            sessionId: currentSession.id,
            channelId: currentSession.channelId,
          });
          return;
        }

        const sanitizedStaff = sanitizeSensitiveContent(message.content);
        await this.repo.appendTicketMessage({
          sessionId: currentSession.id,
          discordMessageId: message.id,
          senderType: 'staff',
          senderDiscordId: message.authorId,
          content: sanitizedStaff.sanitizedText,
          redacted: sanitizedStaff.redacted,
        });

        const handedOff = await this.repo.updateTicketSession(currentSession.id, {
          status: 'human_handoff',
          lastProcessedMessageId: message.id,
        });
        if (handedOff) {
          this.sessionManager.setSessionInMemory(handedOff);
        }
        this.logger.info('Admin/staff member replied in ticket; handed off to human staff', {
          sessionId: currentSession.id,
          channelId: currentSession.channelId,
        });
        return;
      }

      // 3. Message is confirmed from the single ticket opener!
      // If intake is already complete & report delivered, respect post-completion follow-up setting
      if (
        currentSession.status === 'ready_for_review' &&
        currentSession.reportDelivered &&
        currentSession.configSnapshot.aiSettings.answerPostCompletionQuestions === false
      ) {
        return;
      }

      // Per-ticket rate limit protection
      const withinRateLimit = this.queueManager.checkTicketRateLimit(
        message.channelId,
        currentSession.configSnapshot.aiSettings.perTicketRateLimitPerMinute
      );
      if (!withinRateLimit) {
        this.logger.warn('Per-ticket message rate limit reached', {
          sessionId: currentSession.id,
          channelId: currentSession.channelId,
        });
        return;
      }

      // Redact passwords, recovery codes, or tokens BEFORE storing or sending to Groq
      const sanitized = sanitizeSensitiveContent(message.content);
      const storedMsg = await this.repo.appendTicketMessage({
        sessionId: currentSession.id,
        discordMessageId: message.id,
        senderType: 'player',
        senderDiscordId: message.authorId,
        content: sanitized.sanitizedText,
        redacted: sanitized.redacted,
      });

      if (storedMsg.duplicate) {
        return;
      }

      const updatedMeta = await this.repo.updateTicketSession(currentSession.id, {
        playerUsername: currentSession.playerUsername ?? message.authorUsername,
        lastProcessedMessageId: message.id,
      });
      if (updatedMeta) {
        currentSession = updatedMeta;
        this.sessionManager.setSessionInMemory(currentSession);
      }

      await this.messenger.sendTyping(currentSession.channelId);

      // Load current session state
      const [history, answerRecords, lookupRecords] = await Promise.all([
        this.repo.listTicketMessages(currentSession.id),
        this.repo.listTicketAnswers(currentSession.id),
        this.repo.listPlayerLookups(currentSession.id),
      ]);

      const validAnswers: Record<string, AnswerPrimitive> = {};
      const invalidFieldErrors: Record<string, string> = {};
      for (const ans of answerRecords) {
        if (ans.validated && ans.answerValue !== null) {
          validAnswers[ans.questionKey] = ans.answerValue;
        } else if (!ans.validated && ans.validationNote) {
          invalidFieldErrors[ans.questionKey] = ans.validationNote;
        }
      }

      const latestProfile = this.mergeCompletedLookups(lookupRecords.map((l) => l.parsedData));
      const initialProgress = evaluateQuestionnaireProgress(
        currentSession.configSnapshot.category.questions,
        validAnswers
      );

      let aiOutput;
      try {
        aiOutput = await this.groqService.generateTurn({
          snapshot: currentSession.configSnapshot,
          conversationHistory: history,
          validAnswers,
          invalidFieldErrors,
          progress: initialProgress,
          playerProfile: latestProfile,
          recentSecretRedacted: sanitized.redacted,
          signal,
        });

        await this.repo.updateHeartbeatAndMetrics(currentSession.guildId, {
          groqRequests: 1,
          groqPromptTokens: aiOutput.usage.promptTokens,
          groqCompletionTokens: aiOutput.usage.completionTokens,
        });
      } catch (err) {
        if (signal.aborted) return;
        this.logger.error('Groq turn generation failed', {
          sessionId: currentSession.id,
          error: err instanceof Error ? err.message : 'unknown_error',
        });
        await this.repo.updateHeartbeatAndMetrics(currentSession.guildId, {
          errorEntry: {
            timestamp: new Date().toISOString(),
            code: 'GROQ_ERROR',
            component: 'ConversationService',
            message: 'Groq completion call failed; sent fallback reply',
          },
        });
        if (!signal.aborted && !this.queueManager.isClosingOrAborted(currentSession.channelId)) {
          await this.messenger.sendMessage(currentSession.channelId, {
            content: currentSession.configSnapshot.aiSettings.fallbackMessage,
          });
        }
        return;
      }

      if (signal.aborted || this.queueManager.isClosingOrAborted(currentSession.channelId)) {
        return;
      }

      // Deterministically validate extracted answers against configured question schemas
      const questionsByKey = new Map(
        currentSession.configSnapshot.category.questions.map((q) => [q.key, q])
      );

      const newValidationErrors: string[] = [];
      let autoTriggeredLookup: { action: string; target: string } | null = null;

      for (const [key, extractedVal] of Object.entries(aiOutput.turn.extractedAnswers)) {
        if (extractedVal === null || extractedVal === undefined || String(extractedVal).trim() === '') {
          continue;
        }
        const qDef = questionsByKey.get(key);
        if (!qDef) continue;

        const check = validateAnswerValue(qDef, extractedVal);
        if (check.valid) {
          validAnswers[key] = check.normalizedValue;
          delete invalidFieldErrors[key];
          await this.repo.upsertTicketAnswer({
            sessionId: currentSession.id,
            questionKey: key,
            answerValue: check.normalizedValue,
            rawText: String(extractedVal),
            validated: true,
            validationNote: null,
          });

          if (qDef.triggerLookupAction && check.normalizedValue !== null) {
            autoTriggeredLookup = {
              action: qDef.triggerLookupAction,
              target: String(check.normalizedValue),
            };
          } else if (qDef.type === 'player_tag' && check.normalizedValue !== null) {
            autoTriggeredLookup = {
              action: 'lookup_player',
              target: String(check.normalizedValue),
            };
          }
        } else {
          newValidationErrors.push(`${qDef.question} (${check.error ?? 'Invalid value'})`);
          await this.repo.upsertTicketAnswer({
            sessionId: currentSession.id,
            questionKey: key,
            answerValue: null,
            rawText: String(extractedVal),
            validated: false,
            validationNote: check.error ?? 'Invalid format',
          });
        }
      }

      // Execute approved external player-data bot lookup if requested by AI or triggered by player_tag
      const requestedLookupAction =
        aiOutput.turn.requestedAction === 'lookup_player' ||
        aiOutput.turn.requestedAction === 'lookup_clan' ||
        aiOutput.turn.requestedAction === 'lookup_profile'
          ? aiOutput.turn.requestedAction
          : autoTriggeredLookup?.action ?? null;

      const requestedLookupTarget =
        aiOutput.turn.lookupTarget ??
        autoTriggeredLookup?.target ??
        (typeof validAnswers.player_tag === 'string' ? validAnswers.player_tag : null);

      if (
        requestedLookupAction &&
        requestedLookupTarget &&
        currentSession.configSnapshot.playerIntegrationConfig.enabled &&
        currentSession.configSnapshot.category.playerLookupEnabled
      ) {
        const pendingState = await this.repo.updateTicketSession(currentSession.id, {
          status: 'lookup_pending',
        });
        if (pendingState) {
          currentSession = pendingState;
          this.sessionManager.setSessionInMemory(currentSession);
        }

        await this.playerAdapter.executeLookup({
          session: currentSession,
          rawAction: requestedLookupAction,
          rawTarget: requestedLookupTarget,
          signal,
        });

        if (signal.aborted || this.queueManager.isClosingOrAborted(currentSession.channelId)) {
          return;
        }

        const restoredState = await this.repo.updateTicketSession(currentSession.id, {
          status: 'active',
        });
        if (restoredState) {
          currentSession = restoredState;
          this.sessionManager.setSessionInMemory(currentSession);
        }
      }

      // Re-evaluate deterministic questionnaire progress after applying answers
      const updatedProgress = evaluateQuestionnaireProgress(
        currentSession.configSnapshot.category.questions,
        validAnswers
      );

      let finalReply = aiOutput.turn.reply;

      // Guardrail: If AI claimed completion while required questions or validation errors remain, ask the next missing question naturally
      if (newValidationErrors.length > 0 && aiOutput.turn.complete) {
        finalReply = `Hmm, that didn't look quite right — ${newValidationErrors[0]}. Mind double-checking and sending it again?`;
      } else if (!updatedProgress.isComplete && aiOutput.turn.complete && updatedProgress.nextRecommendedQuestion) {
        finalReply = `${aiOutput.turn.reply}\n\nReal quick before I pass this over — ${updatedProgress.nextRecommendedQuestion.question}`;
      }

      const isReadyForReview =
        (updatedProgress.isComplete && newValidationErrors.length === 0 && aiOutput.turn.complete) ||
        (updatedProgress.isComplete &&
          updatedProgress.missingOptionalQuestions.length === 0 &&
          newValidationErrors.length === 0) ||
        aiOutput.turn.requestedAction === 'handoff_to_staff';

      if (signal.aborted || this.queueManager.isClosingOrAborted(currentSession.channelId)) {
        return;
      }

      const sentReply = await this.messenger.sendMessage(currentSession.channelId, {
        content: finalReply,
      });

      await this.repo.appendTicketMessage({
        sessionId: currentSession.id,
        discordMessageId: sentReply.messageId,
        senderType: 'assistant',
        senderDiscordId: this.messenger.getBotUserId(),
        content: finalReply,
        redacted: false,
      });

      if (isReadyForReview) {
        const nextStatus =
          aiOutput.turn.requestedAction === 'handoff_to_staff'
            ? 'human_handoff'
            : 'ready_for_review';
        const completedSession = await this.repo.updateTicketSession(currentSession.id, {
          status: nextStatus,
        });
        if (completedSession) {
          currentSession = completedSession;
          this.sessionManager.setSessionInMemory(currentSession);
        }

        if (this.onReadyForReport && !currentSession.reportDelivered && !signal.aborted) {
          await this.onReadyForReport({
            session: currentSession,
            issueSummary: aiOutput.turn.issueSummary,
            neutralAssessment: aiOutput.turn.neutralAssessment,
            signal,
          });
        }
      }
    });
  }

  private mergeCompletedLookups(
    profiles: Array<ParsedPlayerProfile | null>
  ): ParsedPlayerProfile | null {
    const valid = profiles.filter((p): p is ParsedPlayerProfile => p !== null);
    if (valid.length === 0) return null;

    const merged: ParsedPlayerProfile = { extraFields: {} };
    for (const p of valid) {
      if (p.playerTag) merged.playerTag = p.playerTag;
      if (p.playerName) merged.playerName = p.playerName;
      if (p.townHallLevel !== undefined && p.townHallLevel !== null) {
        merged.townHallLevel = p.townHallLevel;
      }
      if (p.clanName) merged.clanName = p.clanName;
      if (p.donations !== undefined && p.donations !== null) merged.donations = p.donations;
      if (p.trophies !== undefined && p.trophies !== null) merged.trophies = p.trophies;
      if (p.rawSummary) merged.rawSummary = p.rawSummary;
      Object.assign(merged.extraFields, p.extraFields);
    }
    return merged;
  }
}

