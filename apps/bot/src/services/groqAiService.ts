import Groq from 'groq-sdk';
import {
  AiTurnResponseSchema,
  getGroqModelCapabilities,
  isUnavailableAnswer,
  resolveActiveGroqModelId,
  type AiTurnResponse,
  type AnswerPrimitive,
  type ParsedPlayerProfile,
  type QuestionnaireProgress,
  type QuestionnaireQuestion,
  type SessionConfigSnapshot,
} from '@hrbot/shared';
import type { GlobalSemaphore } from '../queues/ticketQueueManager.js';
import type { TicketMessageRecord } from './databaseRepository.js';
import type { Logger } from './logger.js';

export interface AiTurnInput {
  snapshot: SessionConfigSnapshot;
  conversationHistory: TicketMessageRecord[];
  validAnswers: Record<string, AnswerPrimitive>;
  invalidFieldErrors: Record<string, string>;
  progress: QuestionnaireProgress;
  playerProfile: ParsedPlayerProfile | null;
  recentSecretRedacted: boolean;
  justMarkedUnavailableKeys?: string[];
  awaitingUnavailableBackupContext?: boolean;
  isPostIntakePhase?: boolean;
  signal?: AbortSignal;
}

export interface AiTurnUsage {
  promptTokens: number;
  completionTokens: number;
  modelUsed: string;
  structuredFormatUsed: 'json_schema' | 'json_object' | 'fallback';
}

export interface AiTurnOutput {
  turn: AiTurnResponse;
  usage: AiTurnUsage;
}

export interface RawGroqChatRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  responseFormat:
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          strict: boolean;
          schema: Record<string, unknown>;
        };
      }
    | { type: 'json_object' };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  signal?: AbortSignal;
}

export interface RawGroqChatResult {
  content: string;
  toolCalls?: Array<{ name: string; argumentsJson: string }>;
  promptTokens: number;
  completionTokens: number;
}

export interface GroqCompletionClient {
  complete(req: RawGroqChatRequest): Promise<RawGroqChatResult>;
}

/**
 * Official groq-sdk wrapper using Chat Completions API with structured outputs & tool definitions.
 */
export class OfficialGroqSdkClient implements GroqCompletionClient {
  private readonly client: Groq;

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  async complete(req: RawGroqChatRequest): Promise<RawGroqChatResult> {
    const isGptOssReasoning = req.model.startsWith('openai/gpt-oss-');
    const response = await this.client.chat.completions.create(
      {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_completion_tokens: req.maxTokens,
        ...(isGptOssReasoning ? { reasoning_effort: 'low' as const } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- groq-sdk response_format union supports json_schema & json_object
        response_format: req.responseFormat as any,
        ...(req.tools && req.tools.length > 0 ? { tools: req.tools, tool_choice: 'auto' as const } : {}),
      },
      req.signal ? { signal: req.signal } : undefined
    );

    const choice = response.choices[0];
    const message = choice?.message;
    const toolCalls = message?.tool_calls?.map((tc) => ({
      name: tc.function.name,
      argumentsJson: tc.function.arguments,
    }));

    return {
      content: message?.content ?? '{}',
      toolCalls,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}

/**
 * Dynamically constructs a strict JSON Schema matching Groq's constrained decoding specification
 * (`additionalProperties: false` and explicit `required` keys on all objects).
 */
export function buildStrictTurnJsonSchema(
  questions: QuestionnaireQuestion[]
): Record<string, unknown> {
  const answerProperties: Record<string, unknown> = {};
  const requiredAnswerKeys: string[] = [];

  for (const q of questions) {
    requiredAnswerKeys.push(q.key);
    if (q.type === 'number') {
      answerProperties[q.key] = { type: ['number', 'null'] };
    } else if (q.type === 'boolean') {
      answerProperties[q.key] = { type: ['boolean', 'null'] };
    } else {
      answerProperties[q.key] = { type: ['string', 'null'] };
    }
  }

  return {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Natural, helpful support assistant reply to send to the player in Discord.',
      },
      extractedAnswers: {
        type: 'object',
        properties: answerProperties,
        required: requiredAnswerKeys,
        additionalProperties: false,
      },
      unavailableFields: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Question keys the opener stated they do not have, do not know, or cannot check right now.',
      },
      missingFields: {
        type: 'array',
        items: { type: 'string' },
      },
      requestedAction: {
        type: 'string',
        enum: [
          'none',
          'lookup_player',
          'lookup_clan',
          'lookup_profile',
          'handoff_to_staff',
        ],
      },
      lookupTarget: {
        type: ['string', 'null'],
      },
      issueSummary: {
        type: ['string', 'null'],
      },
      neutralAssessment: {
        type: ['string', 'null'],
      },
      complete: {
        type: 'boolean',
      },
    },
    required: [
      'reply',
      'extractedAnswers',
      'unavailableFields',
      'missingFields',
      'requestedAction',
      'lookupTarget',
      'issueSummary',
      'neutralAssessment',
      'complete',
    ],
    additionalProperties: false,
  };
}

const LEGACY_ROBOTIC_INSTRUCTIONS =
  'You are a polite, concise, automated Discord ticket support assistant. Never pretend to be human staff. Ask one main question at a time, never repeat answered questions, and stay focused on gathering ticket information.';

const LEGACY_ROBOTIC_FALLBACK =
  'Thank you for your message. A human moderator will follow up with you shortly.';

function normalizeSentenceForComparison(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/^\s*(?:no\s+worries|all\s+good|got\s+it|gotcha|sure|hey)\b[!,.:\s-]*/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic post-processor that strips dead-giveaway LLM artifacts, placeholder symbols,
 * hallucinated Clash UI instructions, hallucinated staff channels (#admins), repetitive canned
 * acknowledgments ("thanks for the info", "thanks for sharing"), and verbatim sentence clones.
 */
export function polishHumanDiscordReply(
  rawReply: string,
  previousAssistantReplies: string[] = []
): string {
  let text = rawReply.trim();
  if (!text) return rawReply;

  // 1. Strip robotic parenthetical tag hints like "(#...)" or "(e.g., #ABC123)"
  text = text
    .replace(/\s*\(#\.{2,}\)/g, '')
    .replace(/\s*\((?:e\.?g\.?,?\s*|like\s+)?#[A-Z0-9.]{2,12}\)/gi, '');

  // 2. Replace AI em-dashes and spaced en-dashes with casual Discord hyphens
  text = text.replace(/\s*—\s*/g, ' - ').replace(/\s+–\s+/g, ' - ');

  // 3. Catch hallucinated Clash of Clans "three dots" profile UI instructions
  if (/\bthree\s+dots\b/i.test(text) && /\b(?:tag|profile)\b/i.test(text)) {
    return "in clash, tap your xp level in the top-left corner to open your profile - your # tag is right under your name with a small share/copy icon next to it. all good if you can't grab it right now though.";
  }

  // 4. Catch hallucinated staff channel directs (e.g. "admins are in the #admins channel", "hop over to #admins")
  if (/(?:#admins|admins\s+channel|hop\s+over\s+there|drop\s+a\s+message\s+if\s+you\s+need)/i.test(text)) {
    return "leadership reviews tickets directly in this channel, so one of them will drop in here soon.";
  }

  // 5. Catch hallucinated "get a tag from one of our clans"
  if (/\b(?:get a tag from one of our clans|find a tag from our clans)\b/i.test(text)) {
    return "leadership will review your details right here in this ticket and get you set up with the right clan once they hop in.";
  }

  // 6. Rewrite dead-giveaway corporate brush-offs
  text = text
    .replace(
      /\bwe['’]?ll keep you in mind(?:[^.!?]*)[.!?]?/gi,
      "i've passed your info over to the leaders so someone can hop in here soon."
    )
    .replace(
      /\ba staff member will review your (?:request|ticket)(?:[^.!?]*)[.!?]?/gi,
      "i've passed your info over to the leaders - one of them will check in here soon."
    );

  // 7. Anti-duplicate whole reply check: if the entire generated reply is identical or nearly identical to a recent bot reply
  const currentNormalized = normalizeSentenceForComparison(text);
  const recentNorms = previousAssistantReplies.slice(-3).map(normalizeSentenceForComparison);
  if (recentNorms.includes(currentNormalized) && currentNormalized.length > 0) {
    return "my bad for repeating myself - leadership has your details and one of them will jump in here soon. let me know if you need anything while waiting.";
  }

  // 8. Prevent repeating "thanks for the info" / "thanks for sharing" across turns
  const recentUsedThanks = previousAssistantReplies
    .slice(-3)
    .some((r) => /\bthanks\s+for\s+(?:the\s+info|sharing|the\s+heads-?up|letting\s+me\s+know)\b/i.test(r));

  if (recentUsedThanks && /\bthanks\s+for\s+(?:the\s+info|sharing|the\s+heads-?up|letting\s+me\s+know)[!,.:\s-]*/i.test(text)) {
    text = text
      .replace(/\b(?:nice,?\s*)?thanks\s+for\s+(?:the\s+info|sharing|the\s+heads-?up|letting\s+me\s+know)[!,.:\s-]*/gi, '')
      .trim();
    if (!text || text.length < 5) {
      return "sounds good! let me know if you have any questions while waiting.";
    }
  }

  // 9. Anti-verbatim-clone guard: drop sentences (>=10 normalized chars) copied from recent bot turns
  if (previousAssistantReplies.length > 0) {
    const prevNorms: string[] = [];
    for (const prev of previousAssistantReplies.slice(-3)) {
      const prevSentences = prev.match(/[^.!?]+[.!?]*/g) ?? [prev];
      for (const ps of prevSentences) {
        const norm = normalizeSentenceForComparison(ps);
        if (norm.length >= 10) {
          prevNorms.push(norm);
        }
      }
    }

    if (prevNorms.length > 0) {
      const currentSentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
      const kept = currentSentences.filter((cs) => {
        const norm = normalizeSentenceForComparison(cs);
        if (norm.length < 10) return true;
        return !prevNorms.some(
          (pn) => norm === pn || (norm.length >= 15 && (norm.includes(pn) || pn.includes(norm)))
        );
      });

      if (kept.length === 0) {
        return "my bad for repeating myself - leadership has your details and one of them will jump in here soon. let me know if you need anything while waiting.";
      }
      text = kept.join(' ').trim();
    }
  }

  // 10. Prevent repeating "No worries" if already used in recent replies
  const recentUsedNoWorries = previousAssistantReplies
    .slice(-3)
    .some((r) => /^\s*no\s+worries\b/i.test(r));
  if (recentUsedNoWorries && /^\s*no\s+worries[!,.:\s-]*/i.test(text)) {
    const remainder = text.replace(/^\s*no\s+worries[!,.:\s-]*/i, '').trim();
    if (remainder.length > 0) {
      const loweredStart =
        /^(?:I\b|TH\d|CWL\b)/.test(remainder)
          ? remainder
          : `${remainder.charAt(0).toLowerCase()}${remainder.slice(1)}`;
      text = `all good, ${loweredStart}`;
    }
  }

  // 11. Prevent repeating "All good" opener if already used in last reply
  const lastReply = previousAssistantReplies[previousAssistantReplies.length - 1] ?? '';
  if (/^\s*all\s+good\b/i.test(lastReply) && /^\s*all\s+good[!,.:\s-]*/i.test(text)) {
    const remainder = text.replace(/^\s*all\s+good[!,.:\s-]*/i, '').trim();
    if (remainder.length > 0) {
      const loweredStart =
        /^(?:I\b|TH\d|CWL\b)/.test(remainder)
          ? remainder
          : `${remainder.charAt(0).toLowerCase()}${remainder.slice(1)}`;
      text = `sounds good, ${loweredStart}`;
    } else {
      text = "sounds good! feel free to ask if you need anything while waiting.";
    }
  }

  // 12. Cap exclamation-mark spam (at most 1 "!" per message)
  let seenExclamation = false;
  text = text.replace(/!+/g, () => {
    if (!seenExclamation) {
      seenExclamation = true;
      return '!';
    }
    return '.';
  });

  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();

  return text || rawReply.trim();
}

export function buildSystemPrompt(input: AiTurnInput, now = new Date()): string {
  const {
    snapshot,
    conversationHistory,
    validAnswers,
    invalidFieldErrors,
    progress,
    playerProfile,
    recentSecretRedacted,
    justMarkedUnavailableKeys = [],
    awaitingUnavailableBackupContext = false,
  } = input;

  const ai = snapshot.aiSettings;
  const humanize = ai.humanizeConversation !== false;
  const personaDisplay = ai.personaName?.trim()
    ? `${ai.personaName.trim()} (front-desk recruiter & ticket helper for "${snapshot.guildName}")`
    : `a front-desk recruiter & ticket helper for "${snapshot.guildName}"`;

  const currentDateText = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  const faqText =
    snapshot.category.faqs.length > 0
      ? snapshot.category.faqs
          .map((f, idx) => `${idx + 1}. Q: ${f.question}\n   A: ${f.answer}`)
          .join('\n')
      : 'None configured.';

  const questionsSpec = progress.activeQuestions.map((q) => ({
    key: q.key,
    question: q.question,
    type: q.type,
    required: q.required,
    choices: q.choices ?? undefined,
    helpText: q.helpText ?? undefined,
  }));

  const lookupAllowed =
    snapshot.playerIntegrationConfig.enabled &&
    snapshot.category.playerLookupEnabled
      ? snapshot.playerIntegrationConfig.supportedActions
      : [];

  const unavailableKeys = Object.entries(validAnswers)
    .filter(([, val]) => isUnavailableAnswer(val))
    .map(([key]) => key);

  const collectedPlayerTag =
    typeof validAnswers.player_tag === 'string' && !isUnavailableAnswer(validAnswers.player_tag)
      ? validAnswers.player_tag
      : null;

  const previousAssistantReplies = conversationHistory
    .filter((m) => m.senderType === 'assistant')
    .map((m) => m.content)
    .slice(-5);

  const knowledge = ai.serverKnowledge;
  const defaultServerOverview = `## About ${snapshot.guildName}\n${snapshot.guildName} is an active Discord and gaming community. Tickets are used for applicant intake, recruitment, and player support.`;
  const defaultJoiningProcess = `## How Joining Works & Expected Leader Response Time\nAdmins and leadership review applications and finalize clan placements directly inside this ticket channel. Once staff is available, they will review your answers and provide clan invites or next steps right here. Response times vary depending on active hours, but tickets are checked regularly.`;

  const knowledgeBlocks = [
    knowledge?.serverOverview?.trim()
      ? `## About ${snapshot.guildName}\n${knowledge.serverOverview.trim()}`
      : defaultServerOverview,
    knowledge?.clanRequirementsAndRules?.trim()
      ? `## Clans, Requirements & Rules\n${knowledge.clanRequirementsAndRules.trim()}`
      : '',
    knowledge?.joiningProcessAndTiming?.trim()
      ? `## How Joining Works & Expected Leader Response Time\n${knowledge.joiningProcessAndTiming.trim()}`
      : defaultJoiningProcess,
    knowledge?.additionalNotes?.trim()
      ? `## Extra Server Details\n${knowledge.additionalNotes.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const customInstructions =
    humanize && ai.systemInstructions.trim() === LEGACY_ROBOTIC_INSTRUCTIONS
      ? 'Chat naturally like a real, chill Discord community helper and front-desk greeter. Keep messages short (1-2 sentences), friendly, and down-to-earth.'
      : ai.systemInstructions;

  const toneDirective =
    ai.toneStyle === 'professional'
      ? 'Tone: Friendly, clear, and respectful without stiff corporate jargon.'
      : ai.toneStyle === 'warm_friendly'
        ? 'Tone: Warm, welcoming Discord community style.'
        : 'Tone: Chill, authentic Discord community style - short 1-2 sentence replies, relaxed flow, normal hyphens (" - "), casual words ("all good", "nice", "sweet", "gotcha"), zero corporate customer-service polish.';

  const humanStyleSection = humanize
    ? [
        `# Human Discord Cover & Voice Rules (CRITICAL)`,
        `- ${toneDirective}`,
        `- Write like a real person typing in Discord: 1-2 short sentences (10-30 words). Almost never use exclamation marks (at most ONE "!" if genuinely hyped; normal periods and question marks sound 10x more human).`,
        `- STRICTLY BANNED AI CLICHÉS - NEVER write any of these:`,
        `  * NEVER say "We'll keep you in mind", "we'll get you set up", "whenever you're ready", "whenever you have it", or "when you can".`,
        `  * NEVER repeat "No worries" across turns - vary your openers ("all good", "fair enough", "nice", "sweet", or jump straight into your reply with no filler).`,
        `  * NEVER say "Could you please provide", "How can I help you today?", "Thank you for your patience", or "A staff member will review your request shortly."`,
        `  * NEVER repeat canned acknowledgments like "All good, thanks for sharing!", "All good, thanks for the info!", or "Thanks for the heads-up!" over and over.`,
        ``,
        `# Ticket Operating Environment & Staff Direct Review (CRITICAL)`,
        `- This conversation takes place inside a dedicated private ticket channel.`,
        `- Leadership, admins, and moderators review tickets and chat DIRECTLY INSIDE THIS TICKET CHANNEL.`,
        `- ABSOLUTE PROHIBITION ON CHANNEL HALLUCINATIONS: NEVER tell applicants to go to another channel (such as "#admins", "#support", "#general", "hop over to another channel", or "DM staff"). Applicants do not have access to staff channels!`,
        `- Clan Joining Process: Clan placement and invitations are handled by leadership directly right here in this ticket. Applicants do NOT need to fetch external clan tags or perform steps elsewhere.`,
        `- Inquiring about Staff / Waiting / "anyone here?": Reassure the applicant warmly that leadership / staff has their notes and will drop into this ticket channel to finalize everything as soon as someone is free.`,
        `- Ban on Repetitive Parrot Phrases: When the applicant sends short fillers ("yeah", "okay", "cool"), reply casually like a real person hanging out, not a robot logging data.`,
        ``,
        `# Conversational Intake & Scope Guidelines`,
        `- Primary Purpose: Welcome the member, gather the community intake questions configured in the Active Questionnaire (e.g. what they are looking forward to, how active they are, their goals/vibe), and answer any general questions about ${snapshot.guildName} using the Knowledge Base.`,
        `- Open-Ended Conversational Flow: If the member asks follow-up questions, wants to chat, or asks about server events/community life, chat with them naturally! Never shut down conversation or say "I am only allowed to ask questions".`,
        `- Game Questions & Technical Placements: Human moderators will handle in-game placements, roster coordination, and game-specific questions once they join the ticket. You do NOT need to proactively ask game questions or demand player tags. HOWEVER, if the member brings up gaming details, stats, or questions themselves, do NOT say "I cannot talk about games" - chat with them warmly, acknowledge their notes, and let them know the human team will take care of game-specific details.`,
        ``,
        `# Situational Playbook`,
        `- Bare greeting ("hi", "hey", "yo"): Greet them back warmly and casually, and ask what brings them in or ask the next pending question from the questionnaire.`,
        `- Opener says they DON'T have or can't check something ("i don't have", "idk", "not sure"): Accept it immediately with zero pressure! Never re-ask an unavailable field.`,
        `- Opener says "wait", "sure", "ok", "one sec": Just say "take your time" or "go for it".`,
        `- Opener asks where staff is ("where is admins?", "anyone here?", "hello?", "when will someone come?"): Reassure them that staff has been alerted and will connect with them right here in this ticket as soon as someone is free.`,
        `- Opener asks how to join clan ("how do i join?", "what clan?"): Tell them leadership will review their info and provide the clan invite right here in this ticket.`,
        `- Opener sends short acknowledgment ("yeah", "okay", "alright", "cool", "bet"): DO NOT thank them for info! Reply casually in 1 brief sentence (e.g. "Sounds good! Just let me know if you have any questions while you wait.").`,
        `- Banter / corrections / "are you an AI?": Be chill, self-aware, and honest in one relaxed sentence (e.g. laugh it off, mention you're the server's ticket helper grabbing quick intake details for the team, and let them know a human moderator will hop in shortly).`,
        `- Awareness: Today is ${currentDateText}.`,
      ].join('\n')
    : `Today's date (UTC): ${currentDateText}.\n${toneDirective}`;

  const isPostIntakePhase =
    input.isPostIntakePhase ||
    (progress.isComplete &&
      previousAssistantReplies.length > 0 &&
      previousAssistantReplies.some(
        (r) =>
          r.toLowerCase().includes('logged your details') ||
          r.toLowerCase().includes('connect with you here') ||
          r.toLowerCase().includes('reach out soon') ||
          r.toLowerCase().includes('pass this over') ||
          r.toLowerCase().includes('noted your info') ||
          r.toLowerCase().includes('leadership team') ||
          r.toLowerCase().includes('moderators who will') ||
          r.toLowerCase().includes('one of them will') ||
          r.toLowerCase().includes('all good, thanks') ||
          r.toLowerCase().includes('thanks for sharing')
      ));

  let intakeStateNote: string;
  if (awaitingUnavailableBackupContext) {
    intakeStateNote = `INTAKE STATUS: Opener stated they do not have (${justMarkedUnavailableKeys.join(', ')}). It is now marked [Unavailable] - DO NOT ask for it again! For this turn, say "all good" casually and ask what they're looking for or how often they're active so the team has context.`;
  } else if (isPostIntakePhase) {
    intakeStateNote = `INTAKE STATUS: ALL INTAKE QUESTIONS ARE ALREADY COMPLETED & LOGGED ON EARLIER TURNS.
CURRENT PHASE: TICKET HOST & CONVERSATIONAL Q&A (WAITING FOR LEADERSHIP REVIEW).
CRITICAL RULES FOR THIS TURN:
- DO NOT ask any questionnaire questions.
- DO NOT repeat completion notices ("I have logged your details", "a staff member will reach out soon"). You already told them that.
- STRICT BAN ON ROBOTIC REPETITIONS:
  * NEVER say "All good, thanks for the info!", "Thanks for sharing!", "All good, thanks for sharing!", "Nice, thanks for the info!", or "Thanks for the heads-up!" repeatedly.
  * When the member says "yeah", "okay", "alright", "cool", "sure": DO NOT treat it as new information to thank them for! Respond casually in 1 brief sentence (e.g. "Sounds good! Just let me know if you have any questions about the server or clans while we wait for leadership.").
  * When the member asks "where is admins?", "anyone is here?", "hello?", "when will they check?": Reassure them directly that staff has been notified and one of them will jump right into this ticket channel to chat with them as soon as someone is free.
  * When the member asks how to join the clan or what's next: Explain that leadership will review their answers right here in this ticket and get them set up with the right clan once they hop in.
- Chat with the member naturally, warmly, and maturely in 1-2 casual sentences.
- Keep complete=true and requestedAction="none".`;
  } else if (progress.isComplete) {
    const unavailReminder =
      unavailableKeys.length > 0
        ? ` ABSOLUTE RULE: (${unavailableKeys.join(', ')}) was marked [Unavailable] - NEVER mention, hint at, or ask for (${unavailableKeys.join(', ')}) again!`
        : '';
    intakeStateNote = `INTAKE STATUS: ALL REQUIRED INFO IS COMPLETE!${unavailReminder} Acknowledge what they shared naturally, let them know you've noted their info for the team who will check this ticket soon, and answer any follow-up questions they have using the Server Knowledge below. Keep complete=true.`;
  } else {
    const unavailReminder =
      unavailableKeys.length > 0
        ? ` Never re-ask unavailable fields (${unavailableKeys.join(', ')}).`
        : '';
    intakeStateNote = `INTAKE STATUS: Gathering intake fields (${progress.missingRequiredQuestions.map((q) => q.key).join(', ') || 'none'}).${unavailReminder} If the opener answers questions, record them.`;
  }

  return [
    `# Role & Persona`,
    `You are ${personaDisplay} chatting with the ticket opener inside category "${snapshot.category.categoryName}".`,
    `There is strictly ONE ticket opener in this ticket - all user messages in this conversation come from that ticket opener.`,
    ``,
    humanStyleSection,
    ``,
    `# Server & Category Instructions`,
    customInstructions,
    snapshot.category.categoryInstructions
      ? `Category-specific guidance: ${snapshot.category.categoryInstructions}`
      : '',
    knowledgeBlocks ? `\n# ${snapshot.guildName} Server & Clan Knowledge Base\n${knowledgeBlocks}` : '',
    ``,
    `# Conversation & Extraction Rules`,
    `1. ${intakeStateNote}`,
    `2. Understand natural-language replies and extract ALL answers provided in the player's latest message (even if they answered multiple questions at once).`,
    `3. If the player corrects a previous answer, include the updated value in extractedAnswers; otherwise set keys not mentioned in the latest message to null.`,
    `4. NEVER re-ask any question already present in Already Collected Valid Answers (including any field marked [Unavailable]) unless the player brings it up themselves.`,
    `5. Ask AT MOST ONE natural question at a time.`,
    `6. Never ask for passwords, recovery codes, or authentication secrets.`,
    recentSecretRedacted
      ? `IMPORTANT: The player's last message contained sensitive credential text that was automatically redacted. Remind them casually never to share passwords or recovery codes on Discord.`
      : '',
    `7. Approved lookup actions via requestedAction: ${lookupAllowed.length > 0 ? lookupAllowed.join(', ') : 'none (external lookup disabled)'}. Request lookup_player ONLY when a real # player_tag is provided (never when [Unavailable]).`,
    `8. When intake is complete, set complete=true and write a concise factual issueSummary and neutralAssessment for leaders.`,
    ``,
    `# Configured Active Questionnaire`,
    JSON.stringify(questionsSpec, null, 2),
    ``,
    `# Already Collected Valid Answers (NEVER RE-ASK THESE)`,
    JSON.stringify(validAnswers, null, 2),
    ``,
    Object.keys(invalidFieldErrors).length > 0
      ? `# Validation Notes From Previous Attempt (ask casually to double-check)\n${JSON.stringify(invalidFieldErrors, null, 2)}`
      : '',
    playerProfile
      ? `# Verified In-Game Player Profile (from DOT command lookup)\n${JSON.stringify(playerProfile, null, 2)}`
      : '',
    previousAssistantReplies.length > 0
      ? `# Your Recent Replies in This Ticket (DO NOT REPEAT ANY SENTENCE OR OPENER FROM THESE)\n${previousAssistantReplies.map((r, idx) => `- Turn -${previousAssistantReplies.length - idx}: ${JSON.stringify(r)}`).join('\n')}`
      : '',
    `# Category FAQs`,
    faqText,
    ``,
    `# Output Format`,
    `Respond strictly with a single valid JSON object matching keys: reply (string), extractedAnswers (object mapping question keys to extracted value or null), unavailableFields (string[]), missingFields (string[]), requestedAction ("none" | "lookup_player" | "lookup_clan" | "lookup_profile" | "handoff_to_staff"), lookupTarget (string | null), issueSummary (string | null), neutralAssessment (string | null), complete (boolean).`,
  ]
    .filter(Boolean)
    .join('\n');
}

export class GroqAiService {
  constructor(
    private readonly client: GroqCompletionClient,
    private readonly semaphore: GlobalSemaphore,
    private readonly defaultModel: string,
    private readonly logger: Logger
  ) {}

  async generateTurn(input: AiTurnInput): Promise<AiTurnOutput> {
    const { snapshot, conversationHistory, signal } = input;
    const rawConfiguredModel = snapshot.aiSettings.model.trim() || this.defaultModel;
    const resolvedModel = resolveActiveGroqModelId(rawConfiguredModel, this.defaultModel);
    if (resolvedModel.replacedDeprecated) {
      this.logger.warn(
        'Configured Groq model is officially deprecated/decommissioned; auto-upgrading to active replacement',
        {
          deprecatedModel: rawConfiguredModel,
          activeReplacement: resolvedModel.modelId,
        }
      );
    }
    const model = resolvedModel.modelId;
    const capabilities = getGroqModelCapabilities(model);
    this.semaphore.setLimit(snapshot.aiSettings.globalConcurrencyLimit);

    const systemPrompt = buildSystemPrompt(input);
    // Filter history to player & assistant messages so any recorded staff notes don't confuse turn roles
    const recentHistory = conversationHistory
      .filter((m) => m.senderType === 'assistant' || m.senderType === 'player')
      .slice(-20)
      .map((m) => ({
        role: (m.senderType === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content,
      }));

    const effectiveTemperature =
      snapshot.aiSettings.humanizeConversation !== false && snapshot.aiSettings.temperature <= 0.25
        ? 0.55
        : snapshot.aiSettings.temperature;

    const effectiveFallback =
      snapshot.aiSettings.humanizeConversation !== false &&
      snapshot.aiSettings.fallbackMessage.trim() === LEGACY_ROBOTIC_FALLBACK
        ? 'Hang tight—one of our team members will jump in here to help you out soon!'
        : snapshot.aiSettings.fallbackMessage;

    const messages: RawGroqChatRequest['messages'] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
    ];

    const preferStrictSchema =
      snapshot.aiSettings.structuredOutputsEnabled && capabilities.supportsStrictJsonSchema;

    const strictFormat: RawGroqChatRequest['responseFormat'] = {
      type: 'json_schema',
      json_schema: {
        name: 'ticket_assistant_turn',
        strict: true,
        schema: buildStrictTurnJsonSchema(input.progress.activeQuestions),
      },
    };

    const jsonObjectFormat: RawGroqChatRequest['responseFormat'] = {
      type: 'json_object',
    };

    // Reasoning models (e.g. openai/gpt-oss-120b, qwen3.8) count chain-of-thought inside max_completion_tokens
    const effectiveMaxTokens = capabilities.isReasoningModel
      ? Math.max(snapshot.aiSettings.maxTokens, 2048)
      : snapshot.aiSettings.maxTokens;

    return this.semaphore.run(async () => {
      let rawResult: RawGroqChatResult;
      let formatUsed: 'json_schema' | 'json_object' = preferStrictSchema
        ? 'json_schema'
        : 'json_object';

      try {
        rawResult = await this.client.complete({
          model,
          messages,
          temperature: effectiveTemperature,
          maxTokens: effectiveMaxTokens,
          responseFormat: preferStrictSchema ? strictFormat : jsonObjectFormat,
          signal,
        });
      } catch (err) {
        if (signal?.aborted) {
          throw err;
        }

        // If a newly selected model rejected strict json_schema, automatically retry with json_object
        if (preferStrictSchema) {
          this.logger.warn('Strict json_schema rejected by model; retrying with json_object mode', {
            model,
          });
          formatUsed = 'json_object';
          rawResult = await this.client.complete({
            model,
            messages,
            temperature: effectiveTemperature,
            maxTokens: effectiveMaxTokens,
            responseFormat: jsonObjectFormat,
            signal,
          });
        } else {
          throw err;
        }
      }

      const parsedJson = this.parseAndValidateJson(rawResult, effectiveFallback);
      const prevAssistantMsgs = conversationHistory
        .filter((m) => m.senderType === 'assistant')
        .map((m) => m.content);
      const finalTurn =
        snapshot.aiSettings.humanizeConversation !== false
          ? {
              ...parsedJson.turn,
              reply: polishHumanDiscordReply(parsedJson.turn.reply, prevAssistantMsgs),
            }
          : parsedJson.turn;

      return {
        turn: finalTurn,
        usage: {
          promptTokens: rawResult.promptTokens,
          completionTokens: rawResult.completionTokens,
          modelUsed: model,
          structuredFormatUsed: parsedJson.usedFallback ? 'fallback' : formatUsed,
        },
      };
    }, signal);
  }

  private parseAndValidateJson(
    raw: RawGroqChatResult,
    fallbackReply: string
  ): { turn: AiTurnResponse; usedFallback: boolean } {
    try {
      const cleaned = raw.content
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/, '')
        .trim();
      const obj = JSON.parse(cleaned) as Record<string, unknown>;

      // Also honor tool_calls if a model emitted a tool call alongside JSON
      if (raw.toolCalls && raw.toolCalls.length > 0 && (!obj.requestedAction || obj.requestedAction === 'none')) {
        const tc = raw.toolCalls[0];
        if (
          tc &&
          ['lookup_player', 'lookup_clan', 'lookup_profile'].includes(tc.name)
        ) {
          obj.requestedAction = tc.name;
          try {
            const args = JSON.parse(tc.argumentsJson) as Record<string, unknown>;
            if (typeof args.target === 'string') {
              obj.lookupTarget = args.target;
            }
          } catch {
            // Keep existing lookupTarget
          }
        }
      }

      const validated = AiTurnResponseSchema.parse(obj);
      return { turn: validated, usedFallback: false };
    } catch (err) {
      this.logger.warn('Groq response failed Zod schema validation; returning safe fallback', {
        error: err instanceof Error ? err.message : 'invalid_json',
      });
      return {
        usedFallback: true,
        turn: AiTurnResponseSchema.parse({
          reply: fallbackReply,
          extractedAnswers: {},
          missingFields: [],
          requestedAction: 'none',
          lookupTarget: null,
          issueSummary: null,
          neutralAssessment: null,
          complete: false,
        }),
      };
    }
  }
}

