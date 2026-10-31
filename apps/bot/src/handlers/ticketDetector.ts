import crypto from 'node:crypto';
import {
  TicketWebhookPayloadSchema,
  validateAnswerValue,
  type AnswerPrimitive,
  type CategoryConfig,
  type QuestionnaireQuestion,
  type ServerSettings,
  type TicketDetectionConfig,
  type TicketWebhookPayload,
} from '@hrbot/shared';
import type {
  NormalizedDiscordMessage,
  ObservedChannelMetadata,
} from '../services/safeDiscordMessenger.js';

export type DetectionDisposition =
  | {
      status: 'eligible';
      verifiedBy:
        | 'provider_bot_owner'
        | 'provider_message'
        | 'topic_marker'
        | 'channel_prefix'
        | 'category_match'
        | 'signed_webhook';
      categoryConfig: CategoryConfig;
      detectedOpenerId: string | null;
    }
  | {
      status: 'awaiting_provider_message';
      reason: string;
      categoryConfig: CategoryConfig;
    }
  | {
      status: 'ignored';
      reason: string;
    };

const USER_MENTION_OR_ID_REGEX = /<@!?(\d{15,22})>|(?:user(?:\s*id)?|opener|opened\s*by|creator|ticket\s*owner)[:\s#]*(\d{15,22})/i;
const EXPLICIT_OPENER_LABEL_REGEX = /(?:opened\s*by|creator|ticket\s*owner|opener|user|welcome|hey|hello)[^<\d]{0,30}<@!?(\d{15,22})>/i;

export function extractOpenerIdFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const labeled = EXPLICIT_OPENER_LABEL_REGEX.exec(text);
  if (labeled?.[1]) return labeled[1];
  const match = USER_MENTION_OR_ID_REGEX.exec(text);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * Selects the single human ticket opener from channel permission overwrites or topic,
 * filtering out known bot accounts and prioritizing non-admin member overwrites.
 */
export function resolveOpenerFromChannelMetadata(params: {
  channel: ObservedChannelMetadata;
  knownBotIds: ReadonlySet<string>;
  staffUserIds?: readonly string[];
}): string | null {
  const { channel, knownBotIds, staffUserIds = [] } = params;

  const fromTopic = extractOpenerIdFromText(channel.topic);
  if (fromTopic && !knownBotIds.has(fromTopic)) {
    return fromTopic;
  }

  const nonAdminCandidates = (channel.nonAdminPermissionMemberIds ?? []).filter(
    (id) => !knownBotIds.has(id) && !staffUserIds.includes(id)
  );
  if (nonAdminCandidates.length > 0) {
    return nonAdminCandidates[0]!;
  }

  const nonStaffMemberCandidates = (channel.permissionMemberIds ?? []).filter(
    (id) => !knownBotIds.has(id) && !staffUserIds.includes(id)
  );
  if (nonStaffMemberCandidates.length > 0) {
    return nonStaffMemberCandidates[0]!;
  }

  // Fallback when an admin opened a ticket themselves (so their ID is in permissionMemberIds)
  const anyHumanMemberCandidates = (channel.permissionMemberIds ?? []).filter(
    (id) => !knownBotIds.has(id)
  );
  if (anyHumanMemberCandidates.length === 1) {
    return anyHumanMemberCandidates[0]!;
  }

  return null;
}

/**
 * Extracts the single ticket opener's Discord ID from opening panel messages sent by
 * the server's existing ticket bot (e.g. "Welcome <@USER_ID>!").
 */
export function extractOpenerFromBotMessages(params: {
  messages: readonly NormalizedDiscordMessage[];
  knownBotIds: ReadonlySet<string>;
  ourBotUserId: string | null;
  externalDataBotId?: string | null;
  staffUserIds?: readonly string[];
}): string | null {
  const { messages, knownBotIds, ourBotUserId, externalDataBotId, staffUserIds = [] } = params;

  for (const msg of messages) {
    if (!msg.authorBot) continue;
    if (ourBotUserId && msg.authorId === ourBotUserId) continue;
    if (externalDataBotId && msg.authorId === externalDataBotId) continue;

    const combinedText = [
      msg.content,
      ...msg.embeds.flatMap((e) => [
        e.title ?? '',
        e.description ?? '',
        e.footerText ?? '',
        ...e.fields.flatMap((f) => [f.name, f.value]),
      ]),
    ]
      .join('\n')
      .trim();

    // 1. Prefer non-staff mentioned user ID
    const nonStaffMention = msg.mentionsUserIds.find(
      (id) => !knownBotIds.has(id) && id !== msg.authorId && !staffUserIds.includes(id)
    );
    if (nonStaffMention) {
      return nonStaffMention;
    }

    // 2. Check explicit text / embed mention
    const extracted = extractOpenerIdFromText(combinedText);
    if (extracted && !knownBotIds.has(extracted) && extracted !== msg.authorId) {
      return extracted;
    }

    // 3. Fallback if an admin opened a test ticket and was mentioned by the ticket bot
    const anyHumanMention = msg.mentionsUserIds.find(
      (id) => !knownBotIds.has(id) && id !== msg.authorId
    );
    if (anyHumanMention) {
      return anyHumanMention;
    }
  }

  return null;
}

export interface ExtractedOpeningEmbedData {
  playerTag: string | null;
  hasPlayerTagField: boolean;
  fieldsByNormalizedLabel: Record<string, string>;
  matchedQuestionAnswers: Record<string, AnswerPrimitive>;
  rawSummaryLines: string[];
}

const CONTAINER_SECTION_HEADERS = new Set([
  'application',
  'form',
  'answers',
  'questions',
  'responses',
  'submission',
  'details',
  'ticket details',
  'information',
]);

const IGNORED_META_LABELS = new Set([
  'opened by',
  'created by',
  'claimed by',
  'ticket',
  'open ticket',
  'status',
  'category',
  'panel',
]);

const TAG_STOPWORDS = new Set([
  'TICKET',
  'OPEN',
  'CLOSED',
  'SUPPORT',
  'GENERAL',
  'WELCOME',
  'RULES',
  'CLAN',
  'APPLY',
  'APPLICATION',
  'HELP',
  'NONE',
  'NULL',
  'NOPE',
]);

function stripDiscordMarkdownDecorations(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^[>┃│▎▍▌|\s]+/, '')
    .replace(/^(?:-#|#{1,4})\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

function normalizeFieldLabel(rawLabel: string): string {
  return stripDiscordMarkdownDecorations(rawLabel)
    .toLowerCase()
    .replace(/[?:!.,-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlayerTagLabel(normalizedLabel: string): boolean {
  if (!normalizedLabel) return false;
  if (/\b(?:discord|ticket|channel|user)\s*(?:id|tag|#)\b/i.test(normalizedLabel)) {
    return false;
  }
  return /\b(?:player\s*tag|in\s*game\s*tag|clash\s*tag|coc\s*tag|account\s*tag|your\s*tag|game\s*tag)\b|^tag$/i.test(
    normalizedLabel
  );
}

/**
 * Extracts and normalizes a valid player tag (e.g. `#9RQU2YQPL`) while rejecting ticket numbers
 * like `Open Ticket · #0111`, Discord mentions, and non-tag words like `idk` or `none`.
 */
export function parseCandidatePlayerTag(
  rawValue: string,
  allowUnprefixed = false
): string | null {
  if (!rawValue) return null;

  const withoutNoise = rawValue
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(
      /\b(?:open\s*ticket|ticket(?:\s*(?:id|no|num|number))?)[\s·•:=-]*#[A-Z0-9]+\b/gi,
      ' '
    );

  // 1. Check explicit `#TAG` tokens
  const hashRegex = /#([A-Z0-9]{3,16})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = hashRegex.exec(withoutNoise)) !== null) {
    const candidate = (match[1] ?? '').toUpperCase();
    if (!candidate) continue;
    if (/^0\d{1,5}$/.test(candidate)) continue; // Ticket counters like #0111
    if (/^\d{1,4}$/.test(candidate)) continue; // Short numeric IDs like #111
    if (TAG_STOPWORDS.has(candidate)) continue;
    return `#${candidate}`;
  }

  // 2. Under an explicit `player tag` label, also accept unprefixed tags like `9rqu2yqpl`
  if (allowUnprefixed) {
    const cleaned = stripDiscordMarkdownDecorations(withoutNoise).toUpperCase();
    if (/^[A-Z0-9]{4,16}$/.test(cleaned) && !TAG_STOPWORDS.has(cleaned)) {
      const hasLetter = /[A-Z]/.test(cleaned);
      const hasDigit = /[0-9]/.test(cleaned);
      const isSupercellTag = /^[0289PYLQGRJCUV]{5,14}$/.test(cleaned);
      if ((hasLetter && hasDigit) || isSupercellTag) {
        return `#${cleaned}`;
      }
    }
  }

  return null;
}

function parseMarkdownQaPairsFromBlock(text: string): Array<{ label: string; value: string }> {
  const pairs: Array<{ label: string; value: string }> = [];
  const rawLines = text.split(/\r?\n/);

  let inMultiLineBlockquote = false;
  const quoteGroup: string[] = [];

  const flushQuoteGroup = () => {
    let i = 0;
    while (i < quoteGroup.length) {
      const line = quoteGroup[i]!;
      if (!line) {
        i += 1;
        continue;
      }

      const inlineColon = /^([^:#\n]{2,55}):\s*(.*)$/.exec(line);
      if (inlineColon && !/^https?$/i.test(inlineColon[1]!.trim())) {
        pairs.push({
          label: inlineColon[1]!.trim(),
          value: inlineColon[2]!.trim(),
        });
        i += 1;
        continue;
      }

      const nextLine = quoteGroup[i + 1];
      if (
        nextLine !== undefined &&
        !line.startsWith('#') &&
        line.length <= 65 &&
        !CONTAINER_SECTION_HEADERS.has(normalizeFieldLabel(line))
      ) {
        pairs.push({ label: line, value: nextLine });
        i += 2;
        continue;
      }

      if (isPlayerTagLabel(normalizeFieldLabel(line))) {
        pairs.push({ label: line, value: '' });
      }
      i += 1;
    }
    quoteGroup.length = 0;
  };

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (quoteGroup.length % 2 === 1) {
        quoteGroup.push('');
      }
      flushQuoteGroup();
      continue;
    }

    if (trimmed.startsWith('>>>')) {
      inMultiLineBlockquote = true;
      const afterArrow = stripDiscordMarkdownDecorations(trimmed.slice(3));
      if (afterArrow) quoteGroup.push(afterArrow);
      continue;
    }

    if (inMultiLineBlockquote || /^[>┃│▎▍▌]/.test(trimmed)) {
      const cleaned = stripDiscordMarkdownDecorations(trimmed);
      if (cleaned) {
        quoteGroup.push(cleaned);
      } else {
        if (quoteGroup.length % 2 === 1) {
          quoteGroup.push('');
        }
        flushQuoteGroup();
      }
      continue;
    }

    flushQuoteGroup();

    const cleanedPlain = stripDiscordMarkdownDecorations(trimmed);
    const plainColon = /^([^:#<]{2,55}):\s*(.+)$/.exec(cleanedPlain);
    if (plainColon && !/^https?$/i.test(plainColon[1]!.trim())) {
      const normLbl = normalizeFieldLabel(plainColon[1]!);
      if (!IGNORED_META_LABELS.has(normLbl)) {
        pairs.push({
          label: plainColon[1]!.trim(),
          value: plainColon[2]!.trim(),
        });
      }
    }
  }

  flushQuoteGroup();
  return pairs;
}

/**
 * Extracts application form answers and player tags (e.g. ClashDuke's `Application -> player tag -> #9rqu2yqpl`)
 * from the ticket provider bot's initial opening embed messages.
 */
export function extractTicketOpeningEmbedData(params: {
  messages: readonly NormalizedDiscordMessage[];
  questions?: readonly QuestionnaireQuestion[];
  ourBotUserId: string | null;
  externalDataBotId?: string | null;
}): ExtractedOpeningEmbedData {
  const { messages, questions = [], ourBotUserId, externalDataBotId } = params;

  const fieldsByNormalizedLabel: Record<string, string> = {};
  const rawSummaryLines: string[] = [];
  let hasPlayerTagField = false;
  let playerTag: string | null = null;

  const recordPair = (rawLabel: string, rawVal: string) => {
    const normLabel = normalizeFieldLabel(rawLabel);
    if (!normLabel || IGNORED_META_LABELS.has(normLabel)) return;
    const cleanedVal = stripDiscordMarkdownDecorations(rawVal);

    if (isPlayerTagLabel(normLabel)) {
      hasPlayerTagField = true;
      const parsedTag = parseCandidatePlayerTag(rawVal, true);
      if (parsedTag && !playerTag) {
        playerTag = parsedTag;
      }
    }

    if (cleanedVal && fieldsByNormalizedLabel[normLabel] === undefined) {
      fieldsByNormalizedLabel[normLabel] = cleanedVal;
      rawSummaryLines.push(`${normLabel}: ${cleanedVal}`);
    }
  };

  for (const msg of messages) {
    if (!msg.authorBot) continue;
    if (ourBotUserId && msg.authorId === ourBotUserId) continue;
    if (externalDataBotId && msg.authorId === externalDataBotId) continue;

    for (const embed of msg.embeds) {
      for (const field of embed.fields) {
        const normName = normalizeFieldLabel(field.name);
        if (
          CONTAINER_SECTION_HEADERS.has(normName) ||
          /^[>┃│]/.test(field.value.trim()) ||
          field.value.trim().startsWith('>>>')
        ) {
          for (const pair of parseMarkdownQaPairsFromBlock(field.value)) {
            recordPair(pair.label, pair.value);
          }
        } else {
          recordPair(field.name, field.value);
        }
      }

      if (embed.description) {
        for (const pair of parseMarkdownQaPairsFromBlock(embed.description)) {
          recordPair(pair.label, pair.value);
        }
      }

      // Unlabeled fallback scan on description + field values ONLY (never embed.title like "Open Ticket · #0111")
      if (!playerTag && !hasPlayerTagField) {
        const bodyOnly = [
          embed.description ?? '',
          ...embed.fields.map((f) => f.value),
        ].join('\n');
        const unlabeledTag = parseCandidatePlayerTag(bodyOnly, false);
        if (unlabeledTag) {
          playerTag = unlabeledTag;
        }
      }
    }
  }

  const matchedQuestionAnswers: Record<string, AnswerPrimitive> = {};

  for (const q of questions) {
    if (q.type === 'player_tag' || q.key === 'player_tag') {
      if (playerTag) {
        const check = validateAnswerValue(q, playerTag);
        if (check.valid && check.normalizedValue !== null) {
          matchedQuestionAnswers[q.key] = check.normalizedValue;
        }
      }
      continue;
    }

    const keyLabel = q.key.toLowerCase().replace(/_/g, ' ').trim();
    const questionNorm = normalizeFieldLabel(q.question);

    let candidateRaw: string | undefined =
      fieldsByNormalizedLabel[keyLabel] ?? fieldsByNormalizedLabel[questionNorm];

    if (candidateRaw === undefined) {
      for (const [lbl, val] of Object.entries(fieldsByNormalizedLabel)) {
        if (lbl.includes(keyLabel) || keyLabel.includes(lbl) || questionNorm.includes(lbl)) {
          candidateRaw = val;
          break;
        }
      }
    }

    if (candidateRaw !== undefined && candidateRaw !== '') {
      const check = validateAnswerValue(q, candidateRaw);
      if (check.valid && check.normalizedValue !== null) {
        matchedQuestionAnswers[q.key] = check.normalizedValue;
      }
    }
  }

  // Always populate `player_tag` when found in the opening embed, even if category.questions is []
  if (playerTag && matchedQuestionAnswers.player_tag === undefined) {
    matchedQuestionAnswers.player_tag = playerTag;
  }

  return {
    playerTag,
    hasPlayerTagField,
    fieldsByNormalizedLabel,
    matchedQuestionAnswers,
    rawSummaryLines,
  };
}

function matchesPrefix(name: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return false;
  const lower = name.toLowerCase();
  return prefixes.some((p) => lower.startsWith(p.toLowerCase()));
}

function matchesTopicMarker(topic: string | null, markers: string[]): boolean {
  if (!topic || markers.length === 0) return false;
  const lower = topic.toLowerCase();
  return markers.some((m) => lower.includes(m.toLowerCase()));
}

/**
 * Evaluates whether a newly observed Discord text channel or thread is an eligible ticket
 * created by the existing ticket provider inside an enabled category.
 */
export function evaluateObservedTicketCandidate(params: {
  channel: ObservedChannelMetadata;
  expectedGuildId: string;
  serverSettings: ServerSettings;
  categoriesById: ReadonlyMap<string, CategoryConfig>;
}): DetectionDisposition {
  const { channel, expectedGuildId, serverSettings, categoriesById } = params;

  if (!channel.exists || !channel.guildId || channel.guildId !== expectedGuildId) {
    return { status: 'ignored', reason: 'Guild mismatch or non-existent channel' };
  }

  if (!serverSettings.botEnabled) {
    return { status: 'ignored', reason: 'AI assistant globally disabled in server settings' };
  }

  if (!channel.categoryId) {
    return { status: 'ignored', reason: 'Channel/thread has no parent category' };
  }

  const categoryConfig = categoriesById.get(channel.categoryId);
  if (!categoryConfig || !categoryConfig.enabled) {
    return { status: 'ignored', reason: 'Parent category is not enabled for AI assistance' };
  }

  const detection: TicketDetectionConfig = serverSettings.ticketDetectionConfig;

  // Thread-specific verification: never confuse private staff threads or user discussion threads with tickets
  if (channel.isThread) {
    if (channel.archived || channel.locked) {
      return { status: 'ignored', reason: 'Thread is already archived or locked' };
    }

    if (channel.isPrivateThread && detection.ignorePrivateThreads) {
      return {
        status: 'ignored',
        reason: 'Private threads are ignored (reserved for internal staff discussion)',
      };
    }

    // Never treat a sub-thread created inside a ticket text channel as a second ticket
    if (
      channel.parentChannelName &&
      detection.channelNamePrefixes.length > 0 &&
      matchesPrefix(channel.parentChannelName, detection.channelNamePrefixes)
    ) {
      return {
        status: 'ignored',
        reason: 'Thread was created inside an existing ticket text channel',
      };
    }

    if (detection.providerBotIds.length > 0) {
      if (channel.ownerId && detection.providerBotIds.includes(channel.ownerId)) {
        return {
          status: 'eligible',
          verifiedBy: 'provider_bot_owner',
          categoryConfig,
          detectedOpenerId: null,
        };
      }
      // If thread owner is a regular user or unrelated bot, reject immediately!
      if (channel.ownerId && !detection.providerBotIds.includes(channel.ownerId)) {
        return {
          status: 'ignored',
          reason: 'Thread was not created by a configured ticket provider bot',
        };
      }
    }

    if (matchesPrefix(channel.name, detection.channelNamePrefixes)) {
      return {
        status: 'eligible',
        verifiedBy: 'channel_prefix',
        categoryConfig,
        detectedOpenerId: null,
      };
    }

    if (detection.requireProviderVerification) {
      return {
        status: 'awaiting_provider_message',
        reason: 'Waiting for ticket provider bot opening message in thread',
        categoryConfig,
      };
    }

    return {
      status: 'eligible',
      verifiedBy: 'category_match',
      categoryConfig,
      detectedOpenerId: null,
    };
  }

  // Standard guild text channel verification
  const knownBots = new Set<string>([
    ...detection.providerBotIds,
    ...(serverSettings.playerIntegrationConfig.externalBotUserId
      ? [serverSettings.playerIntegrationConfig.externalBotUserId]
      : []),
  ]);
  const openerFromChannel = resolveOpenerFromChannelMetadata({
    channel,
    knownBotIds: knownBots,
    staffUserIds: serverSettings.reportSettings.staffUserIds,
  });

  if (matchesTopicMarker(channel.topic, detection.topicMarkers)) {
    // If providerBotIds are configured AND requireProviderVerification is true,
    // wait for provider bot's opening panel message if we also want strict bot-author proof;
    // otherwise topic marker + prefix is a strong ticket indicator when providerBotIds is empty.
    if (!detection.requireProviderVerification || detection.providerBotIds.length === 0) {
      return {
        status: 'eligible',
        verifiedBy: 'topic_marker',
        categoryConfig,
        detectedOpenerId: openerFromChannel,
      };
    }
  }

  if (
    !detection.requireProviderVerification &&
    (matchesPrefix(channel.name, detection.channelNamePrefixes) ||
      (detection.channelNamePrefixes.length === 0 && detection.topicMarkers.length === 0))
  ) {
    return {
      status: 'eligible',
      verifiedBy: matchesPrefix(channel.name, detection.channelNamePrefixes)
        ? 'channel_prefix'
        : 'category_match',
      categoryConfig,
      detectedOpenerId: openerFromChannel,
    };
  }

  if (
    detection.providerBotIds.length > 0 ||
    detection.knownEmbedKeywords.length > 0
  ) {
    // Only hold in pending candidate buffer if name or topic looks plausible OR no prefixes configured
    const namePlausible =
      detection.channelNamePrefixes.length === 0 ||
      matchesPrefix(channel.name, detection.channelNamePrefixes) ||
      matchesTopicMarker(channel.topic, detection.topicMarkers);

    if (namePlausible) {
      return {
        status: 'awaiting_provider_message',
        reason: 'Waiting to observe opening message/embed from configured ticket provider bot',
        categoryConfig,
      };
    }
  }

  return {
    status: 'ignored',
    reason: 'Channel did not satisfy ticket provider verification rules',
  };
}

/**
 * Verifies whether an incoming Discord message in a pending candidate channel/thread
 * proves the channel was created by the existing ticket management bot.
 */
export function verifyProviderOpeningMessage(params: {
  message: NormalizedDiscordMessage;
  detectionConfig: TicketDetectionConfig;
  ourBotUserId: string | null;
}): { verified: boolean; detectedOpenerId: string | null } {
  const { message, detectionConfig, ourBotUserId } = params;

  if (ourBotUserId && message.authorId === ourBotUserId) {
    return { verified: false, detectedOpenerId: null };
  }

  // Must come from a configured ticket provider bot if providerBotIds are specified
  if (detectionConfig.providerBotIds.length > 0) {
    if (!detectionConfig.providerBotIds.includes(message.authorId)) {
      return { verified: false, detectedOpenerId: null };
    }
  } else if (!message.authorBot) {
    return { verified: false, detectedOpenerId: null };
  }

  const combinedText = [
    message.content,
    ...message.embeds.flatMap((e) => [
      e.title ?? '',
      e.description ?? '',
      e.footerText ?? '',
      ...e.fields.flatMap((f) => [f.name, f.value]),
    ]),
  ]
    .join('\n')
    .trim();

  if (detectionConfig.knownEmbedKeywords.length > 0 && detectionConfig.providerBotIds.length === 0) {
    const lower = combinedText.toLowerCase();
    const hasKeyword = detectionConfig.knownEmbedKeywords.some((kw) =>
      lower.includes(kw.toLowerCase())
    );
    if (!hasKeyword) {
      return { verified: false, detectedOpenerId: null };
    }
  }

  const openerId =
    message.mentionsUserIds.find((id) => id !== ourBotUserId && id !== message.authorId) ??
    extractOpenerIdFromText(combinedText);

  return {
    verified: true,
    detectedOpenerId: openerId ?? null,
  };
}

/**
 * Verifies an optional HMAC-SHA256 signed webhook from the existing ticket bot.
 */
export function verifySignedTicketWebhook(params: {
  rawBody: string;
  signatureHeader: string | undefined;
  secret: string;
}): TicketWebhookPayload {
  const { rawBody, signatureHeader, secret } = params;
  if (!secret || !signatureHeader) {
    throw new Error('Missing webhook secret or signature header');
  }

  const cleanedSig = signatureHeader.replace(/^sha256=/i, '').trim();
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  const sigBuf = Buffer.from(cleanedSig, 'hex');
  const expBuf = Buffer.from(expectedHex, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid ticket webhook HMAC signature');
  }

  const parsedJson: unknown = JSON.parse(rawBody);
  return TicketWebhookPayloadSchema.parse(parsedJson);
}

