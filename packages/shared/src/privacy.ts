export interface SanitizationResult {
  sanitizedText: string;
  redacted: boolean;
  detectedCategories: string[];
}

interface SecretPattern {
  category: string;
  regex: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    category: 'explicit_password',
    regex: /\b(password|passwd|passcode|pin)\s*(?:is|=|:)\s*(\S+)/gi,
    replacement: '$1: [REDACTED_SECRET]',
  },
  {
    category: 'recovery_code',
    regex: /\b(recovery\s*code|backup\s*code|2fa\s*code|auth\s*code|verification\s*code)\s*(?:is|=|:)?\s*([A-Z0-9-]{6,32})\b/gi,
    replacement: '$1: [REDACTED_RECOVERY_CODE]',
  },
  {
    category: 'api_key',
    regex: /\b(gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{16,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    category: 'discord_or_jwt_token',
    regex: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    category: 'payment_card',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: '[REDACTED_CARD_NUMBER]',
  },
];

/**
 * Redacts passwords, recovery codes, authentication secrets, tokens, and payment numbers
 * before messages are stored in temporary Supabase tables or sent to Groq.
 */
export function sanitizeSensitiveContent(input: string): SanitizationResult {
  let sanitizedText = input;
  const detected = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(sanitizedText)) {
      detected.add(pattern.category);
      pattern.regex.lastIndex = 0;
      sanitizedText = sanitizedText.replace(pattern.regex, pattern.replacement);
    }
  }

  return {
    sanitizedText,
    redacted: detected.size > 0,
    detectedCategories: Array.from(detected),
  };
}

const REDACTED_LOG_KEYS = new Set([
  'content',
  'raw_text',
  'rawText',
  'messageContent',
  'reply',
  'password',
  'token',
  'apiKey',
  'groqApiKey',
  'serviceRoleKey',
  'DISCORD_BOT_TOKEN',
  'GROQ_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'TICKET_WEBHOOK_SECRET',
]);

/**
 * Strips raw conversation text and credentials from structured log metadata.
 */
export function sanitizeLogMetadata(
  meta: Record<string, unknown>
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (REDACTED_LOG_KEYS.has(key)) {
      safe[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      safe[key] = sanitizeLogMetadata(value as Record<string, unknown>);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

