import crypto from 'node:crypto';
import {
  TicketWebhookPayloadSchema,
  type CategoryConfig,
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

const USER_MENTION_OR_ID_REGEX = /<@!?(\d{15,22})>|(?:user(?:\s*id)?|opener|opened\s*by)[:\s#]*(\d{15,22})/i;

export function extractOpenerIdFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = USER_MENTION_OR_ID_REGEX.exec(text);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
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

  // Thread-specific verification: never confuse ordinary user discussion threads with tickets
  if (channel.isThread) {
    if (channel.archived || channel.locked) {
      return { status: 'ignored', reason: 'Thread is already archived or locked' };
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
  const openerFromTopic = extractOpenerIdFromText(channel.topic);

  if (matchesTopicMarker(channel.topic, detection.topicMarkers)) {
    // If providerBotIds are configured AND requireProviderVerification is true,
    // wait for provider bot's opening panel message if we also want strict bot-author proof;
    // otherwise topic marker + prefix is a strong ticket indicator when providerBotIds is empty.
    if (!detection.requireProviderVerification || detection.providerBotIds.length === 0) {
      return {
        status: 'eligible',
        verifiedBy: 'topic_marker',
        categoryConfig,
        detectedOpenerId: openerFromTopic,
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
      detectedOpenerId: openerFromTopic,
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

