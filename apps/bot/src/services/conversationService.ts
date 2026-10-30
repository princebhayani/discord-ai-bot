import {
  evaluateQuestionnaireProgress,
  sanitizeSensitiveContent,
  validateAnswerValue,
  type AnswerPrimitive,
  type ParsedPlayerProfile,
} from '@hrbot/shared';
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
    private readonly logger: Logger
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

      const session = await this.sessionManager.resolveActiveSession(message.channelId);
      if (!session || session.status === 'closing' || session.status === 'human_handoff') {
        return;
      }

      // Check if message author is a configured staff moderator stepping in
      const isStaffAuthor = session.configSnapshot.reportSettings.staffUserIds.includes(
        message.authorId
      );
      if (isStaffAuthor && session.status === 'ready_for_review') {
        const handedOff = await this.repo.updateTicketSession(session.id, {
          status: 'human_handoff',
          lastProcessedMessageId: message.id,
        });
        if (handedOff) this.sessionManager.setSessionInMemory(handedOff);
        return;
      }

      // If ticket is already ready_for_review and report was delivered, stay quiet so human staff can handle
      if (session.status === 'ready_for_review' && session.reportDelivered) {
        return;
      }

      // Per-ticket rate limit protection
      const withinRateLimit = this.queueManager.checkTicketRateLimit(
        message.channelId,
        session.configSnapshot.aiSettings.perTicketRateLimitPerMinute
      );
      if (!withinRateLimit) {
        this.logger.warn('Per-ticket message rate limit reached', {
          sessionId: session.id,
          channelId: session.channelId,
        });
        return;
      }

      // Redact passwords, recovery codes, or tokens BEFORE storing or sending to Groq
      const sanitized = sanitizeSensitiveContent(message.content);
      const storedMsg = await this.repo.appendTicketMessage({
        sessionId: session.id,
        discordMessageId: message.id,
        senderType: isStaffAuthor ? 'staff' : 'player',
        senderDiscordId: message.authorId,
        content: sanitized.sanitizedText,
        redacted: sanitized.redacted,
      });

      if (storedMsg.duplicate) {
        return;
      }

      // Record player identity if not yet captured
      let currentSession = session;
      if (!currentSession.playerDiscordId && !isStaffAuthor) {
        const updatedPlayer = await this.repo.updateTicketSession(currentSession.id, {
          playerDiscordId: message.authorId,
          playerUsername: message.authorUsername,
          lastProcessedMessageId: message.id,
        });
        if (updatedPlayer) {
          currentSession = updatedPlayer;
          this.sessionManager.setSessionInMemory(currentSession);
        }
      } else {
        const updatedMsgId = await this.repo.updateTicketSession(currentSession.id, {
          lastProcessedMessageId: message.id,
        });
        if (updatedMsgId) {
          currentSession = updatedMsgId;
          this.sessionManager.setSessionInMemory(currentSession);
        }
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

      // Guardrail: If AI claimed completion while required questions or validation errors remain, ask the next missing question
      if (newValidationErrors.length > 0 && aiOutput.turn.complete) {
        finalReply = `I couldn't quite validate part of that response: ${newValidationErrors[0]}`;
      } else if (!updatedProgress.isComplete && aiOutput.turn.complete && updatedProgress.nextRecommendedQuestion) {
        finalReply = `${aiOutput.turn.reply}\n\nBefore I pass this to our team, ${updatedProgress.nextRecommendedQuestion.question}`;
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

