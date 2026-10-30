import type { LookupAction } from './schemas.js';

export interface ParsedQuickDotCommands {
  valid: boolean;
  commandPrefix: string;
  supportedActions: LookupAction[];
  commandTemplates: Record<LookupAction, string>;
  previews: Partial<Record<LookupAction, string>>;
  error?: string;
}

const DEFAULT_TEMPLATES: Record<LookupAction, string> = {
  lookup_player: '{prefix}player {target}',
  lookup_clan: '{prefix}clan {target}',
  lookup_profile: '{prefix}profile {target}',
};

const SAMPLE_TARGETS: Record<LookupAction, string> = {
  lookup_player: '#9RQU2YQPL',
  lookup_clan: '#2PP',
  lookup_profile: '123456789012345678',
};

function inferActionFromCommand(cmdName: string, argPart: string): LookupAction {
  const lowerCmd = cmdName.toLowerCase();
  const lowerArg = argPart.toLowerCase();

  if (
    lowerCmd === 'c' ||
    lowerCmd.includes('clan') ||
    lowerArg.includes('{clan') ||
    lowerArg.includes('<clan') ||
    lowerArg.includes('[clan')
  ) {
    return 'lookup_clan';
  }

  if (
    lowerCmd === 'whois' ||
    lowerCmd === 'discord' ||
    lowerCmd.includes('profile') ||
    lowerCmd.includes('member') ||
    lowerArg.includes('{user') ||
    lowerArg.includes('{discord') ||
    lowerArg.includes('<user')
  ) {
    return 'lookup_profile';
  }

  return 'lookup_player';
}

function normalizeArgTemplate(argPart: string): string {
  const trimmed = argPart.trim();
  if (!trimmed) {
    return '{target}';
  }

  // Replace common user-friendly placeholders like {tag}, {player}, {clan}, {user}, <tag>, [tag]
  const replacedPlaceholders = trimmed
    .replace(
      /\{(?:tag|player|player_tag|clan|clan_tag|clan_name|user|discord|id|target)\}/gi,
      '{target}'
    )
    .replace(
      /<(?:tag|player|player_tag|clan|clan_tag|clan_name|user|discord|id|target)>/gi,
      '{target}'
    )
    .replace(
      /\[(?:tag|player|player_tag|clan|clan_tag|clan_name|user|discord|id|target)\]/gi,
      '{target}'
    );

  if (replacedPlaceholders.includes('{target}')) {
    return replacedPlaceholders;
  }

  // If the admin pasted an example Clash tag like "#9RQU2YQPL", turn that example into {target}
  const replacedExampleTag = replacedPlaceholders.replace(/#[A-Z0-9]{3,16}\b/i, '{target}');
  if (replacedExampleTag.includes('{target}')) {
    return replacedExampleTag;
  }

  return `${replacedPlaceholders} {target}`.trim();
}

/**
 * Parses a simple 1-line (or comma/newline-separated) DOT command definition such as:
 *   `.p {tag}`
 *   `.player #9RQU2YQPL`
 *   `.p`
 *   `.p {tag}, .clan {clan}`
 * into strict prefix, supportedActions, and commandTemplates.
 */
export function parseQuickDotCommands(
  rawInput: string,
  fallbackPrefix = '.'
): ParsedQuickDotCommands {
  const segments = rawInput
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      valid: false,
      commandPrefix: fallbackPrefix,
      supportedActions: [],
      commandTemplates: { ...DEFAULT_TEMPLATES },
      previews: {},
      error: 'Enter a DOT command like .player {tag} or .p {tag}',
    };
  }

  let detectedPrefix: string | null = null;
  const supportedActions: LookupAction[] = [];
  const commandTemplates: Record<LookupAction, string> = { ...DEFAULT_TEMPLATES };
  const previews: Partial<Record<LookupAction, string>> = {};

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (lower.includes('@everyone') || lower.includes('@here') || /[;`|&]/.test(segment)) {
      return {
        valid: false,
        commandPrefix: fallbackPrefix,
        supportedActions: [],
        commandTemplates: { ...DEFAULT_TEMPLATES },
        previews: {},
        error: 'Command contains disallowed mentions or special characters.',
      };
    }

    const normalizedSeg = segment.replace(/^\{prefix\}/i, fallbackPrefix);
    const match = /^([.!$?~>%+-]{1,5})?\s*([a-zA-Z0-9_-]{1,32})(?:\s+(.+))?$/.exec(normalizedSeg);

    if (!match) {
      return {
        valid: false,
        commandPrefix: fallbackPrefix,
        supportedActions: [],
        commandTemplates: { ...DEFAULT_TEMPLATES },
        previews: {},
        error: `Could not parse "${segment}". Try format like: .player {tag} or .p {tag}`,
      };
    }

    const prefixPart: string = (match[1] ?? '').trim() || detectedPrefix || fallbackPrefix || '.';
    const cmdName = match[2]!.trim();
    const argPart = (match[3] ?? '').trim();

    if (!detectedPrefix) {
      detectedPrefix = prefixPart;
    }
    const activePrefix: string = detectedPrefix;

    const action = inferActionFromCommand(cmdName, argPart);
    const argTemplate = normalizeArgTemplate(argPart);
    const finalTemplate = `{prefix}${cmdName} ${argTemplate}`.trim();

    if (!supportedActions.includes(action)) {
      supportedActions.push(action);
    }
    commandTemplates[action] = finalTemplate;
    previews[action] = finalTemplate
      .replace(/\{prefix\}/g, activePrefix)
      .replace(/\{target\}/g, SAMPLE_TARGETS[action]);
  }

  const finalPrefix = detectedPrefix ?? fallbackPrefix;
  return {
    valid: true,
    commandPrefix: finalPrefix,
    supportedActions,
    commandTemplates,
    previews,
  };
}

/**
 * Formats an existing PlayerIntegrationConfig back into a clean one-line string
 * for the simplified Dashboard input when `quickCommandLine` has not been set yet.
 */
export function deriveQuickCommandLineFromConfig(params: {
  quickCommandLine?: string;
  commandPrefix: string;
  supportedActions: LookupAction[];
  commandTemplates: Partial<Record<LookupAction, string>>;
}): string {
  if (params.quickCommandLine && params.quickCommandLine.trim().length > 0) {
    return params.quickCommandLine.trim();
  }

  const active = params.supportedActions.length > 0 ? params.supportedActions : (['lookup_player'] as LookupAction[]);
  // Default single-line display if only default templates exist: show the primary player lookup one-liner
  if (
    active.length === 3 &&
    params.commandTemplates.lookup_player === '{prefix}player {target}' &&
    params.commandTemplates.lookup_clan === '{prefix}clan {target}' &&
    params.commandTemplates.lookup_profile === '{prefix}profile {target}'
  ) {
    return `${params.commandPrefix}player {tag}`;
  }

  return active
    .map((action) => {
      const tpl = params.commandTemplates[action] ?? DEFAULT_TEMPLATES[action];
      const friendlyPlaceholder =
        action === 'lookup_clan' ? '{clan}' : action === 'lookup_profile' ? '{user}' : '{tag}';
      return tpl
        .replace(/\{prefix\}/g, params.commandPrefix)
        .replace(/\{(?:target|player_tag|clan_name)\}/g, friendlyPlaceholder);
    })
    .join(', ');
}
