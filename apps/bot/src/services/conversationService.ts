import {
  detectUnavailableResponseIntent,
  evaluateQuestionnaireProgress,
  formatUnavailableAnswer,
  isUnavailableAnswer,
  sanitizeSensitiveContent,
  validateAnswerValue,
  type AnswerPrimitive,
  type ParsedPlayerProfile,
  type QuestionnaireQuestion,
} from '@hrbot/shared';
import type { ConfigService } from '../config/configService.js';
import {
  extractOpenerFromBotMessages,
  extractTicketOpeningEmbedData,
  parseCandidatePlayerTag,
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
  private readonly lastStaffMessageTimeBySession = new Map<string, number>();

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

    // 2. Ignore bot messages for conversational turns (prevents bot-to-bot loops),
    //    while promoting pending candidates OR extracting late ticket-opening embeds!
    if (message.authorBot) {
      const promoted = await this.sessionManager.tryPromotePendingCandidateOnMessage(message);
      if (!promoted && message.embeds.length > 0) {
        await this.tryIngestLateProviderOpeningEmbed(message);
      }
      return;
    }

    // 3. Check if channel has an active AI ticket session (never store unrelated channel messages)
    const activeCheck = await this.sessionManager.resolveActiveSession(message.channelId);
    if (!activeCheck) {
      return;
    }

    if (
      activeCheck.status === 'closing' ||
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
      if (!currentSession || currentSession.status === 'closing') {
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

        this.lastStaffMessageTimeBySession.set(currentSession.id, message.createdTimestamp || Date.now());

        const handedOff = await this.repo.updateTicketSession(currentSession.id, {
          status: 'human_handoff',
          lastProcessedMessageId: message.id,
        });
        if (handedOff) {
          this.sessionManager.setSessionInMemory(handedOff);
        }
        this.logger.info('Admin/staff member replied in ticket; recorded staff presence', {
          sessionId: currentSession.id,
          channelId: currentSession.channelId,
        });
        return;
      }

      // 3. Message is confirmed from the single ticket opener!
      // Check if staff has actively chatted recently (within 15 minutes)
      const STAFF_ACTIVE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
      let lastStaffTime = this.lastStaffMessageTimeBySession.get(currentSession.id);
      if (lastStaffTime === undefined) {
        const recentMessages = await this.repo.listTicketMessages(currentSession.id, 15);
        const lastStaffMsg = recentMessages.slice().reverse().find((m) => m.senderType === 'staff');
        if (lastStaffMsg) {
          lastStaffTime = Date.parse(lastStaffMsg.createdAt);
          this.lastStaffMessageTimeBySession.set(currentSession.id, lastStaffTime);
        }
      }

      const staffActiveRecently =
        lastStaffTime !== undefined &&
        Number.isFinite(lastStaffTime) &&
        Date.now() - lastStaffTime < STAFF_ACTIVE_COOLDOWN_MS;

      if (staffActiveRecently) {
        this.logger.info('Staff actively chatting in ticket within last 15m; bot yields to live staff', {
          sessionId: currentSession.id,
          channelId: currentSession.channelId,
          lastStaffTime,
        });
        return;
      }

      // If staff has not messaged recently (or never messaged), keep bot active and responsive!
      if (currentSession.status === 'human_handoff') {
        const restored = await this.repo.updateTicketSession(currentSession.id, {
          status: 'ready_for_review',
        });
        if (restored) {
          currentSession = restored;
          this.sessionManager.setSessionInMemory(currentSession);
        }
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

      // Fallback embed sync: If any configured questions haven't been recorded yet on early turns, inspect recent channel
      // messages in case the ticket provider bot posted an application embed.
      const hasMissingQuestions = currentSession.configSnapshot.category.questions.some(
        (q) => validAnswers[q.key] === undefined
      );
      if (hasMissingQuestions) {
        try {
          const recentChannelMsgs = await this.messenger.fetchRecentMessages(
            currentSession.channelId,
            10
          );
          const embedData = extractTicketOpeningEmbedData({
            messages: recentChannelMsgs,
            questions: currentSession.configSnapshot.category.questions,
            ourBotUserId: ourBotId,
            externalDataBotId: externalBotId,
          });
          for (const [qKey, qVal] of Object.entries(embedData.matchedQuestionAnswers)) {
            if (qVal !== null && qVal !== undefined && validAnswers[qKey] === undefined) {
              validAnswers[qKey] = qVal;
              delete invalidFieldErrors[qKey];
              await this.repo.upsertTicketAnswer({
                sessionId: currentSession.id,
                questionKey: qKey,
                answerValue: qVal,
                rawText: String(qVal),
                validated: true,
                validationNote: 'Extracted from ticket opening embed',
              });
            }
          }
        } catch {
          // Non-fatal fallback
        }
      }

      let initialProgress = evaluateQuestionnaireProgress(
        currentSession.configSnapshot.category.questions,
        validAnswers
      );

      // Pre-turn check: If opener explicitly says they don't have / can't check the requested info
      // (e.g. "i don't have", "idk", "can't open game"), mark that question [Unavailable] IMMEDIATELY
      // so the AI never nags or repeats the question on subsequent turns (works even when category.questions is []).
      const justMarkedUnavailableKeys: string[] = [];
      const assistantMessages = history.filter((m) => m.senderType === 'assistant');
      if (
        assistantMessages.length > 0 &&
        detectUnavailableResponseIntent(sanitized.sanitizedText)
      ) {
        const lastAssistantContent = assistantMessages[assistantMessages.length - 1]?.content ?? '';
        const targetQuestion = this.selectUnavailableTargetQuestion(
          initialProgress.missingRequiredQuestions,
          sanitized.sanitizedText,
          lastAssistantContent,
          initialProgress.nextRecommendedQuestion
        );

        const targetKey =
          targetQuestion?.key ??
          (validAnswers.player_tag === undefined &&
          /\btag\b/i.test(`${sanitized.sanitizedText} ${lastAssistantContent}`)
            ? 'player_tag'
            : null);

        if (targetKey) {
          const unavailableVal = formatUnavailableAnswer(
            'Opener said they do not have this right now'
          );
          validAnswers[targetKey] = unavailableVal;
          delete invalidFieldErrors[targetKey];
          justMarkedUnavailableKeys.push(targetKey);

          await this.repo.upsertTicketAnswer({
            sessionId: currentSession.id,
            questionKey: targetKey,
            answerValue: unavailableVal,
            rawText: sanitized.sanitizedText,
            validated: true,
            validationNote: 'Opener stated unavailable',
          });

          initialProgress = evaluateQuestionnaireProgress(
            currentSession.configSnapshot.category.questions,
            validAnswers
          );
        }
      }

      const hasNonUnavailableAnswer = Object.values(validAnswers).some(
        (v) => v !== null && v !== undefined && !isUnavailableAnswer(v)
      );
      const playerMessageContents = history
        .filter((m) => m.senderType === 'player')
        .map((m) => m.content);
      const awaitingUnavailableBackupContext =
        justMarkedUnavailableKeys.length > 0 &&
        !hasNonUnavailableAnswer &&
        initialProgress.missingRequiredQuestions.length === 0 &&
        !this.hasSubstantivePlayerContext(playerMessageContents);

      const isPostIntakePhase =
        initialProgress.isComplete &&
        (currentSession.status === 'ready_for_review' ||
          currentSession.reportDelivered ||
          assistantMessages.some(
            (r) =>
              r.content.toLowerCase().includes('logged your details') ||
              r.content.toLowerCase().includes('connect with you here') ||
              r.content.toLowerCase().includes('reach out soon') ||
              r.content.toLowerCase().includes('pass this over') ||
              r.content.toLowerCase().includes('noted your info') ||
              r.content.toLowerCase().includes('leadership team') ||
              r.content.toLowerCase().includes('moderators who will') ||
              r.content.toLowerCase().includes('one of them will') ||
              r.content.toLowerCase().includes('all good, thanks') ||
              r.content.toLowerCase().includes('thanks for sharing')
          ));

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
          justMarkedUnavailableKeys,
          awaitingUnavailableBackupContext,
          isPostIntakePhase,
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

      // Record any unavailableFields flagged by the AI turn as well
      for (const unavailKey of aiOutput.turn.unavailableFields ?? []) {
        const qDef = questionsByKey.get(unavailKey);
        if (!qDef || validAnswers[unavailKey] !== undefined) continue;
        const unavailableVal = formatUnavailableAnswer(
          'Opener stated they do not have this right now'
        );
        validAnswers[unavailKey] = unavailableVal;
        delete invalidFieldErrors[unavailKey];
        if (!justMarkedUnavailableKeys.includes(unavailKey)) {
          justMarkedUnavailableKeys.push(unavailKey);
        }
        await this.repo.upsertTicketAnswer({
          sessionId: currentSession.id,
          questionKey: unavailKey,
          answerValue: unavailableVal,
          rawText: sanitized.sanitizedText,
          validated: true,
          validationNote: 'Opener stated unavailable',
        });
      }

      const newValidationErrors: string[] = [];
      let autoTriggeredLookup: { action: string; target: string } | null = null;

      for (const [key, extractedVal] of Object.entries(aiOutput.turn.extractedAnswers)) {
        if (extractedVal === null || extractedVal === undefined || String(extractedVal).trim() === '') {
          continue;
        }
        const qDef = questionsByKey.get(key);
        if (!qDef) continue;

        const extractedText = String(extractedVal).trim();
        if (
          detectUnavailableResponseIntent(extractedText) ||
          /^(?:none|n\/a|unavailable|unknown|not\s*applicable)$/i.test(extractedText)
        ) {
          if (validAnswers[key] === undefined) {
            const unavailableVal = formatUnavailableAnswer(
              'Opener stated they do not have this right now'
            );
            validAnswers[key] = unavailableVal;
            delete invalidFieldErrors[key];
            await this.repo.upsertTicketAnswer({
              sessionId: currentSession.id,
              questionKey: key,
              answerValue: unavailableVal,
              rawText: extractedText,
              validated: true,
              validationNote: 'Opener stated unavailable',
            });
          }
          continue;
        }

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

          if (
            qDef.triggerLookupAction &&
            check.normalizedValue !== null &&
            !isUnavailableAnswer(check.normalizedValue)
          ) {
            autoTriggeredLookup = {
              action: qDef.triggerLookupAction,
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

      const aiLookupTarget =
        aiOutput.turn.lookupTarget && !isUnavailableAnswer(aiOutput.turn.lookupTarget)
          ? aiOutput.turn.lookupTarget
          : null;
      const validPlayerTagTarget =
        typeof validAnswers.player_tag === 'string' && !isUnavailableAnswer(validAnswers.player_tag)
          ? validAnswers.player_tag
          : null;

      const requestedLookupTarget =
        aiLookupTarget ?? autoTriggeredLookup?.target ?? validPlayerTagTarget;

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
        finalReply = `hmm, that didn't look quite right - ${newValidationErrors[0]}. mind double-checking and sending it again?`;
      } else if (!updatedProgress.isComplete && aiOutput.turn.complete && updatedProgress.nextRecommendedQuestion) {
        finalReply = `${aiOutput.turn.reply}\n\nreal quick before i pass this over - ${updatedProgress.nextRecommendedQuestion.question}`;
      }

      const isReadyForReview =
        aiOutput.turn.requestedAction === 'handoff_to_staff' ||
        (!awaitingUnavailableBackupContext &&
          ((updatedProgress.isComplete &&
            newValidationErrors.length === 0 &&
            aiOutput.turn.complete) ||
            (updatedProgress.isComplete &&
              updatedProgress.missingOptionalQuestions.length === 0 &&
              newValidationErrors.length === 0)));

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
        const completedSession = await this.repo.updateTicketSession(currentSession.id, {
          status: 'ready_for_review',
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

  private selectUnavailableTargetQuestion(
    missingRequired: QuestionnaireQuestion[],
    playerMessage: string,
    lastAssistantMessage: string,
    nextRecommended: QuestionnaireQuestion | null
  ): QuestionnaireQuestion | null {
    if (missingRequired.length === 0) return null;
    if (missingRequired.length === 1) return missingRequired[0] ?? null;

    const combinedContext = `${playerMessage} ${lastAssistantMessage}`.toLowerCase();
    if (/\btag\b/.test(combinedContext)) {
      const tagQ = missingRequired.find(
        (q) => q.type === 'player_tag' || q.key.toLowerCase().includes('tag')
      );
      if (tagQ) return tagQ;
    }

    for (const q of missingRequired) {
      const keyTokens = q.key.toLowerCase().split('_').filter((t) => t.length >= 3);
      if (keyTokens.some((tok) => lastAssistantMessage.toLowerCase().includes(tok))) {
        return q;
      }
    }

    return nextRecommended ?? missingRequired[0] ?? null;
  }

  private hasSubstantivePlayerContext(playerMessages: string[]): boolean {
    for (const msg of playerMessages) {
      const trimmed = msg.trim();
      if (!trimmed) continue;
      if (/^(?:hi+|hey+|hello+|yo+|sup|wassup|hola|hlo)[!.?\s]*$/i.test(trimmed)) {
        continue;
      }
      if (
        detectUnavailableResponseIntent(trimmed) &&
        trimmed.length < 40 &&
        !/\b(?:th\s*\d{1,2}|town\s*hall|join|looking\s+for|clan|cwl|war|raid|help|issue|appeal)\b/i.test(
          trimmed
        )
      ) {
        continue;
      }
      return true;
    }
    return false;
  }

  private async tryIngestLateProviderOpeningEmbed(
    message: NormalizedDiscordMessage
  ): Promise<void> {
    const ourBotId = this.messenger.getBotUserId();
    if (ourBotId && message.authorId === ourBotId) return;

    const existing = await this.sessionManager.resolveActiveSession(message.channelId);
    if (!existing || existing.status === 'closing' || existing.status === 'human_handoff') {
      return;
    }

    const externalBotId =
      existing.configSnapshot.playerIntegrationConfig.externalBotUserId || null;
    if (externalBotId && message.authorId === externalBotId) return;

    await this.queueManager.enqueueForTicket(message.channelId, async (signal) => {
      if (signal.aborted) return;
      let currentSession = await this.sessionManager.resolveActiveSession(message.channelId);
      if (!currentSession) return;

      const embedData = extractTicketOpeningEmbedData({
        messages: [message],
        questions: currentSession.configSnapshot.category.questions,
        ourBotUserId: ourBotId,
        externalDataBotId: externalBotId,
      });

      const currentAnswers = await this.repo.listTicketAnswers(currentSession.id);
      const existingKeys = new Set(currentAnswers.map((a) => a.questionKey));
      let newlyExtractedTag: string | null = null;

      for (const [qKey, qVal] of Object.entries(embedData.matchedQuestionAnswers)) {
        if (qVal === null || qVal === undefined || existingKeys.has(qKey)) continue;
        await this.repo.upsertTicketAnswer({
          sessionId: currentSession.id,
          questionKey: qKey,
          answerValue: qVal,
          rawText: String(qVal),
          validated: true,
          validationNote: 'Extracted from late ticket opening embed',
        });
        if (qKey === 'player_tag' && typeof qVal === 'string') {
          newlyExtractedTag = qVal;
        }
      }

      if (
        newlyExtractedTag &&
        currentSession.configSnapshot.playerIntegrationConfig.enabled &&
        currentSession.configSnapshot.category.playerLookupEnabled &&
        !signal.aborted
      ) {
        await this.playerAdapter.executeLookup({
          session: currentSession,
          rawAction: 'lookup_player',
          rawTarget: newlyExtractedTag,
          signal,
        });
      }
    });
  }
}

