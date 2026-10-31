import type { APIEmbed } from 'discord.js';
import {
  evaluateQuestionnaireProgress,
  isUnavailableAnswer,
  sanitizeSensitiveContent,
  StaffReportPayloadSchema,
  type AnswerPrimitive,
  type ParsedPlayerProfile,
  type StaffReportPayload,
} from '@hrbot/shared';
import type { TicketQueueManager } from '../queues/ticketQueueManager.js';
import type {
  BotDatabaseRepository,
  TicketSessionRecord,
} from './databaseRepository.js';
import type { Logger } from './logger.js';
import type { DiscordMessenger } from './safeDiscordMessenger.js';
import type { SessionManager } from './sessionManager.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

/**
 * Ensures the AI assessment remains neutral and factual without automatic enforcement directives.
 */
export function enforceNeutralAssessment(rawAssessment: string | null | undefined): string {
  if (!rawAssessment || rawAssessment.trim().length === 0) {
    return 'All required intake fields collected. Ready for human moderator review.';
  }
  const cleaned = sanitizeSensitiveContent(rawAssessment.trim()).sanitizedText;
  return truncate(cleaned, 1000);
}

export class ModeratorReportService {
  constructor(
    private readonly repo: BotDatabaseRepository,
    private readonly messenger: DiscordMessenger,
    private readonly sessionManager: SessionManager,
    private readonly queueManager: TicketQueueManager,
    private readonly logger: Logger
  ) {}

  async generateAndDeliverReport(params: {
    session: TicketSessionRecord;
    issueSummary: string | null;
    neutralAssessment: string | null;
    signal?: AbortSignal;
  }): Promise<StaffReportPayload | null> {
    const { session, issueSummary, neutralAssessment, signal } = params;
    if (signal?.aborted || this.queueManager.isClosingOrAborted(session.channelId)) {
      return null;
    }

    const [messages, answers, lookups] = await Promise.all([
      this.repo.listTicketMessages(session.id),
      this.repo.listTicketAnswers(session.id),
      this.repo.listPlayerLookups(session.id),
    ]);

    const structuredAnswers: Record<string, AnswerPrimitive> = {};
    for (const ans of answers) {
      if (ans.validated) {
        structuredAnswers[ans.questionKey] = ans.answerValue;
      }
    }

    const progress = evaluateQuestionnaireProgress(
      session.configSnapshot.category.questions,
      structuredAnswers
    );

    const playerMessages = messages.filter((m) => m.senderType === 'player');
    const firstPlayerIssue =
      (typeof structuredAnswers.issue === 'string' ? structuredAnswers.issue : null) ??
      (typeof structuredAnswers.description === 'string'
        ? structuredAnswers.description
        : null) ??
      playerMessages[0]?.content ??
      null;

    const followUpHighlights = playerMessages
      .slice(1, 5)
      .map((m) => truncate(m.content, 220));

    // Merge verified player lookup profile + fallback from collected questionnaire fields & chat
    const rawTagAnswer =
      typeof structuredAnswers.player_tag === 'string' ? structuredAnswers.player_tag : null;
    const rawClanAnswer =
      typeof structuredAnswers.clan_name === 'string' ? structuredAnswers.clan_name : null;

    let selfReportedTh: string | null = null;
    for (const pm of playerMessages) {
      const thMatch = /\b(?:th|town\s*hall)\s*[:=-]?\s*(\d{1,2})\b/i.exec(pm.content);
      if (thMatch?.[1]) {
        selfReportedTh = `${thMatch[1]} (self-reported)`;
        break;
      }
    }

    const mergedProfile: ParsedPlayerProfile = {
      playerTag: rawTagAnswer
        ? isUnavailableAnswer(rawTagAnswer)
          ? 'Unavailable (not provided)'
          : rawTagAnswer
        : null,
      townHallLevel: selfReportedTh,
      clanName: rawClanAnswer && !isUnavailableAnswer(rawClanAnswer) ? rawClanAnswer : null,
      extraFields: {},
    };

    for (const lookup of lookups) {
      if (lookup.status === 'completed' && lookup.parsedData) {
        const pd = lookup.parsedData;
        if (pd.playerTag) mergedProfile.playerTag = pd.playerTag;
        if (pd.playerName) mergedProfile.playerName = pd.playerName;
        if (pd.townHallLevel !== undefined && pd.townHallLevel !== null) {
          mergedProfile.townHallLevel = pd.townHallLevel;
        }
        if (pd.clanName) mergedProfile.clanName = pd.clanName;
        if (pd.donations !== undefined && pd.donations !== null) {
          mergedProfile.donations = pd.donations;
        }
        if (pd.trophies !== undefined && pd.trophies !== null) {
          mergedProfile.trophies = pd.trophies;
        }
        Object.assign(mergedProfile.extraFields, pd.extraFields);
      }
    }

    const outstandingQuestions = [
      ...progress.missingRequiredQuestions.map((q) => `[Required] ${q.question}`),
      ...progress.missingOptionalQuestions.map((q) => `[Optional] ${q.question}`),
    ];

    const payload: StaffReportPayload = StaffReportPayloadSchema.parse({
      ticketDetails: {
        sessionId: session.id,
        channelId: session.channelId,
        parentChannelId: session.parentChannelId,
        isThread: session.isThread,
        categoryId: session.categoryId,
        categoryName: session.categoryName,
        playerDiscordId: session.playerDiscordId,
        playerUsername: session.playerUsername,
        openedAt: session.openedAt,
      },
      playerInformation: mergedProfile,
      issueDetails: {
        originalIssue: firstPlayerIssue ? truncate(firstPlayerIssue, 1000) : null,
        structuredAnswers,
        aiSummary: truncate(
          issueSummary?.trim() ||
            firstPlayerIssue ||
            'Player completed support intake questionnaire.',
          1000
        ),
        followUpHighlights,
      },
      investigation: {
        commandsRequested: lookups.map((l) => l.approvedCommand),
        lookupResults: lookups
          .filter((l) => l.status === 'completed')
          .map((l) => ({
            actionType: l.actionType,
            queryTarget: l.queryTarget,
            status: l.status,
            summary: truncate(l.parsedData?.rawSummary ?? 'Profile verified', 300),
          })),
        failedLookups: lookups
          .filter((l) => l.status !== 'completed')
          .map(
            (l) =>
              `${l.actionType} (${l.queryTarget}): ${l.status}${l.errorReason ? ` — ${l.errorReason}` : ''}`
          ),
        outstandingQuestions,
      },
      assessment: {
        neutralSummary: enforceNeutralAssessment(neutralAssessment),
      },
    });

    const reportSettings = session.configSnapshot.reportSettings;
    const configuredStaffChannelId = (
      session.configSnapshot.category.reportChannelOverrideId?.trim() ||
      reportSettings.staffReportChannelId.trim()
    );

    let deliveredMessageId: string | null = null;
    let destinationUsed: string | null = null;
    let playerSummaryMessageId: string | null = null;
    let deliveryStatus: 'delivered' | 'failed' | 'pending' = 'pending';
    let deliveryError: string | null = null;

    if (signal?.aborted || this.queueManager.isClosingOrAborted(session.channelId)) {
      return null;
    }

    if (reportSettings.destinationMode === 'none') {
      this.logger.debug('Report delivery to staff disabled by configuration (destinationMode is none)', {
        sessionId: session.id,
      });
      return payload;
    }

    // 1. Confidential Staff Channel Destination (NEVER create channels; NEVER post confidential report in player-visible ticket channel)
    const shouldSendToStaffChannel =
      reportSettings.destinationMode === 'staff_channel' ||
      reportSettings.destinationMode === 'both';

    if (shouldSendToStaffChannel && configuredStaffChannelId) {
      if (configuredStaffChannelId === session.channelId) {
        deliveryStatus = 'failed';
        deliveryError =
          'Refused to publish confidential staff report into the player-visible ticket channel.';
        this.logger.error(deliveryError, { sessionId: session.id });
      } else {
        const destMeta = await this.messenger.fetchChannelMetadata(configuredStaffChannelId);
        if (!destMeta.exists) {
          deliveryStatus = 'failed';
          deliveryError = `Configured existing staff report channel ${configuredStaffChannelId} does not exist.`;
          this.logger.warn(deliveryError, { sessionId: session.id });
        } else {
          const staffEmbed = this.buildConfidentialStaffEmbed(payload, session);
          const roleMentions = reportSettings.staffRoleIds.map((r) => `<@&${r}>`).join(' ');
          const sent = await this.messenger.sendMessage(configuredStaffChannelId, {
            content: roleMentions ? `${roleMentions} New ticket intake report ready:` : undefined,
            embeds: [staffEmbed],
          });
          deliveredMessageId = sent.messageId;
          destinationUsed = configuredStaffChannelId;
          deliveryStatus = 'delivered';
        }
      }
    }

    // 2. Existing Private Ticket Thread Destination (ONLY if thread already exists & configured)
    const observedChildStaffThreadId = this.sessionManager.getObservedStaffThreadId(
      session.channelId
    );
    const candidatePrivateThreadId =
      session.isThread && session.isPrivateThread
        ? session.channelId
        : observedChildStaffThreadId;

    const shouldSendToExistingPrivateThread = Boolean(
      (reportSettings.destinationMode === 'existing_private_thread' ||
        reportSettings.destinationMode === 'both') &&
        reportSettings.allowVerifiedPrivateThreadDestination &&
        candidatePrivateThreadId
    );

    if (shouldSendToExistingPrivateThread && candidatePrivateThreadId) {
      const threadMeta = await this.messenger.fetchChannelMetadata(candidatePrivateThreadId);
      if (threadMeta.exists && threadMeta.isThread && threadMeta.isPrivateThread) {
        const playerIsParticipant = Boolean(
          session.playerDiscordId &&
            (!threadMeta.memberIds || threadMeta.memberIds.includes(session.playerDiscordId))
        );

        // SAFETY RULE: Never publish confidential staff analysis if the player can see the thread!
        const embedForThread = playerIsParticipant
          ? this.buildPlayerSafeSummaryEmbed(payload)
          : this.buildConfidentialStaffEmbed(payload, session);

        const roleMentions = !playerIsParticipant
          ? reportSettings.staffRoleIds.map((r) => `<@&${r}>`).join(' ')
          : '';
        const sentInThread = await this.messenger.sendMessage(candidatePrivateThreadId, {
          content: roleMentions ? `${roleMentions} Ticket intake summary:` : undefined,
          embeds: [embedForThread],
        });
        if (!deliveredMessageId) {
          deliveredMessageId = sentInThread.messageId;
          destinationUsed = candidatePrivateThreadId;
          deliveryStatus = 'delivered';
        }
      }
    }

    // 3. Optional Player-Visible Summary in the Existing Ticket Channel (strictly non-confidential)
    if (
      reportSettings.includePlayerSummaryInTicket &&
      !shouldSendToExistingPrivateThread &&
      !signal?.aborted &&
      !this.queueManager.isClosingOrAborted(session.channelId)
    ) {
      const playerEmbed = this.buildPlayerSafeSummaryEmbed(payload);
      const sentSummary = await this.messenger.sendMessage(session.channelId, {
        embeds: [playerEmbed],
      });
      playerSummaryMessageId = sentSummary.messageId;
      if (deliveryStatus === 'pending') {
        deliveryStatus = 'delivered';
        destinationUsed = session.channelId;
      }
    }

    if (deliveryStatus === 'pending') {
      deliveryStatus = 'failed';
      deliveryError =
        deliveryError ?? 'No valid pre-existing report destination channel was configured.';
    }

    await this.repo.upsertStaffReport({
      sessionId: session.id,
      destinationChannelId: destinationUsed,
      deliveredMessageId,
      playerSummaryMessageId,
      reportPayload: payload,
      deliveryStatus,
      deliveryError,
    });

    if (deliveryStatus === 'delivered') {
      const updated = await this.repo.updateTicketSession(session.id, {
        reportDelivered: true,
      });
      if (updated) {
        this.sessionManager.setSessionInMemory(updated);
      }
      await this.repo.updateHeartbeatAndMetrics(session.guildId, {
        reportsDelivered: 1,
      });
    }

    return payload;
  }

  private buildConfidentialStaffEmbed(
    payload: StaffReportPayload,
    session: TicketSessionRecord
  ): APIEmbed {
    const { ticketDetails, playerInformation, issueDetails, investigation, assessment } = payload;
    const reportSettings = session.configSnapshot.reportSettings;

    const playerLines = [
      `**Tag:** ${playerInformation.playerTag ?? 'N/A'}`,
      `**Name:** ${playerInformation.playerName ?? 'N/A'}`,
      `**Town Hall:** ${playerInformation.townHallLevel ?? 'N/A'}`,
      `**Clan:** ${playerInformation.clanName ?? 'N/A'}`,
      `**Donations:** ${playerInformation.donations ?? 'N/A'}`,
      `**Trophies:** ${playerInformation.trophies ?? 'N/A'}`,
      ...Object.entries(playerInformation.extraFields)
        .slice(0, 5)
        .map(([k, v]) => `**${k}:** ${v}`),
    ].join('\n');

    const answersLines = reportSettings.includeRawAnswers
      ? Object.entries(issueDetails.structuredAnswers)
          .map(([k, v]) => `• **${k}:** ${truncate(String(v), 180)}`)
          .join('\n') || 'None collected'
      : 'Hidden by report privacy settings';

    const investigationLines = reportSettings.includeLookupDetails
      ? [
          `**Commands Run:** ${investigation.commandsRequested.join(', ') || 'None'}`,
          `**Verified Lookups:** ${investigation.lookupResults.length}`,
          investigation.failedLookups.length > 0
            ? `**Failed Lookups:** ${truncate(investigation.failedLookups.join('; '), 250)}`
            : null,
          investigation.outstandingQuestions.length > 0
            ? `**Outstanding:** ${truncate(investigation.outstandingQuestions.join('; '), 250)}`
            : '**Outstanding:** None',
        ]
          .filter(Boolean)
          .join('\n')
      : 'Lookup diagnostics omitted';

    return {
      title: `Ticket Investigation Report — ${ticketDetails.categoryName}`,
      color: 0x2563eb,
      fields: [
        {
          name: 'Ticket Details',
          value: [
            `**Ticket:** <#${ticketDetails.channelId}> (\`${ticketDetails.channelId}\`)`,
            `**Category:** ${ticketDetails.categoryName}`,
            `**Player:** ${ticketDetails.playerDiscordId ? `<@${ticketDetails.playerDiscordId}> (\`${ticketDetails.playerDiscordId}\`)` : 'Unknown'} (${ticketDetails.playerUsername ?? 'N/A'})`,
            `**Opened:** ${ticketDetails.openedAt}`,
          ].join('\n'),
        },
        {
          name: 'Player Information',
          value: truncate(playerLines, 1020),
        },
        {
          name: 'Issue Summary',
          value: truncate(issueDetails.aiSummary, 1020),
        },
        {
          name: 'Collected Answers',
          value: truncate(answersLines, 1020),
        },
        {
          name: 'Investigation & Lookups',
          value: truncate(investigationLines, 1020),
        },
        {
          name: 'Neutral Staff Assessment',
          value: truncate(assessment.neutralSummary, 1020),
        },
      ],
      footer: {
        text: 'Automated Intake Report • Human moderator review required',
      },
      timestamp: new Date().toISOString(),
    };
  }

  private buildPlayerSafeSummaryEmbed(payload: StaffReportPayload): APIEmbed {
    const answerSummary =
      Object.entries(payload.issueDetails.structuredAnswers)
        .map(([k, v]) => `• **${k}:** ${truncate(String(v), 150)}`)
        .join('\n') || 'Details recorded.';

    return {
      title: 'Ticket Details Collected',
      description:
        'Thank you! I have organized your responses below for our human moderation team.',
      color: 0x10b981,
      fields: [
        {
          name: 'Submitted Information',
          value: truncate(answerSummary, 1020),
        },
      ],
      footer: {
        text: 'Automated Support Assistant • A staff member will reply here',
      },
      timestamp: new Date().toISOString(),
    };
  }
}

