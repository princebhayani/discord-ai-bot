import Groq from 'groq-sdk';
import {
  AiTurnResponseSchema,
  getGroqModelCapabilities,
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
    const response = await this.client.chat.completions.create(
      {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_completion_tokens: req.maxTokens,
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

export function buildSystemPrompt(input: AiTurnInput, now = new Date()): string {
  const {
    snapshot,
    validAnswers,
    invalidFieldErrors,
    progress,
    playerProfile,
    recentSecretRedacted,
  } = input;

  const ai = snapshot.aiSettings;
  const humanize = ai.humanizeConversation !== false;
  const personaDisplay = ai.personaName?.trim()
    ? `${ai.personaName.trim()} (for "${snapshot.guildName}")`
    : `a recruiter & ticket helper for "${snapshot.guildName}"`;

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

  const knowledge = ai.serverKnowledge;
  const knowledgeBlocks = [
    knowledge?.serverOverview?.trim()
      ? `## About ${snapshot.guildName}\n${knowledge.serverOverview.trim()}`
      : '',
    knowledge?.clanRequirementsAndRules?.trim()
      ? `## Clans, Requirements & Rules\n${knowledge.clanRequirementsAndRules.trim()}`
      : '',
    knowledge?.joiningProcessAndTiming?.trim()
      ? `## How Joining Works & Expected Leader Response Time\n${knowledge.joiningProcessAndTiming.trim()}`
      : '',
    knowledge?.additionalNotes?.trim()
      ? `## Extra Server Details\n${knowledge.additionalNotes.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const customInstructions =
    humanize && ai.systemInstructions.trim() === LEGACY_ROBOTIC_INSTRUCTIONS
      ? 'Chat naturally like a real, chill Discord clan recruiter and helper. Keep messages short (1-2 sentences), friendly, and down-to-earth.'
      : ai.systemInstructions;

  const toneDirective =
    ai.toneStyle === 'professional'
      ? 'Tone: Friendly, clear, and respectful without stiff corporate jargon.'
      : ai.toneStyle === 'warm_friendly'
        ? 'Tone: Warm, welcoming, upbeat Discord community style.'
        : 'Tone: Natural, casual Discord chat—like a real human recruiter/moderator typing in Discord (short sentences, natural contractions like "you\'re", "we\'ll", "gotcha", "no rush").';

  const humanStyleSection = humanize
    ? [
        `# Human Discord Voice Rules (CRITICAL)`,
        `- ${toneDirective}`,
        `- Keep replies concise: usually 1–2 short sentences (never a wall of text).`,
        `- STRICTLY BANNED AI CLICHÉS — NEVER write phrases like:`,
        `  * "Could you please provide..." or "Could you please share..." (say "What's your player tag?" or "Drop your player tag (#...) whenever you're ready!")`,
        `  * "How can I help you today?" or "How may I assist you?" (say "Hey! Looking to join ${snapshot.guildName}, or need help with something?")`,
        `  * "Thanks for providing your player tag." or "Thank you for your patience!"`,
        `  * "A staff member will review your request shortly." (vary it naturally, e.g., "Got it! I've passed your tag to the leaders—someone will check your profile and ping you right here soon.")`,
        `- NEVER repeat yourself: Check your previous message! If you just asked for their tag and they say "sure", "ok", "wait", or "one sec", DO NOT ask the question again—just say something natural like "No rush, drop it whenever you're ready 👍" or "Go for it!".`,
        `- Small talk & awareness: Today is ${currentDateText}. If the opener asks a quick casual question (like what day it is or how joining works), answer it naturally like a normal person and smoothly continue.`,
        `- Honesty boundary: Never claim you personally can accept/kick/ban in-game (leaders handle invites & final decisions), and if directly asked whether you're a bot, be honest casually without sounding robotic.`,
      ].join('\n')
    : `Today's date (UTC): ${currentDateText}.\n${toneDirective}`;

  const intakeStateNote = progress.isComplete
    ? `INTAKE STATUS: ALL REQUIRED ANSWERS ARE ALREADY COLLECTED! Do NOT repeat "a staff member will review your request shortly" if you already said that. Answer any follow-up question (like "but when?" or clan questions) naturally using the Server Knowledge below (if timing isn't specified, let them know leaders check open tickets as soon as they hop online and will ping them right here), and keep complete=true.`
    : `INTAKE STATUS: Still gathering required info (${progress.missingRequiredQuestions.map((q) => q.key).join(', ') || 'none'}).`;

  return [
    `# Role & Persona`,
    `You are ${personaDisplay} chatting with the ticket opener inside category "${snapshot.category.categoryName}".`,
    `There is strictly ONE ticket opener in this ticket—all user messages in this conversation come from that ticket opener.`,
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
    `4. NEVER re-ask a question already present in Already Collected Valid Answers unless the player asks to change it.`,
    `5. Ask AT MOST ONE natural question at a time.`,
    `6. Never ask for passwords, recovery codes, or authentication secrets.`,
    recentSecretRedacted
      ? `IMPORTANT: The player's last message contained sensitive credential text that was automatically redacted. Remind them casually never to share passwords or recovery codes on Discord.`
      : '',
    `7. Approved lookup actions via requestedAction: ${lookupAllowed.length > 0 ? lookupAllowed.join(', ') : 'none (external lookup disabled)'}. Request lookup_player as soon as a player_tag is shared if not yet looked up.`,
    `8. When all required questions are answered, set complete=true, write a concise factual issueSummary and neutralAssessment for leaders, and let the opener know naturally that you've passed their details to leadership.`,
    ``,
    `# Configured Active Questionnaire`,
    JSON.stringify(questionsSpec, null, 2),
    ``,
    `# Already Collected Valid Answers (DO NOT REPEAT THESE QUESTIONS)`,
    JSON.stringify(validAnswers, null, 2),
    ``,
    Object.keys(invalidFieldErrors).length > 0
      ? `# Validation Notes From Previous Attempt (ask casually to double-check)\n${JSON.stringify(invalidFieldErrors, null, 2)}`
      : '',
    playerProfile
      ? `# Verified In-Game Player Profile (from DOT command lookup)\n${JSON.stringify(playerProfile, null, 2)}`
      : '',
    `# Category FAQs`,
    faqText,
    ``,
    `# Output Format`,
    `Respond strictly with a single valid JSON object matching keys: reply (string), extractedAnswers (object mapping question keys to extracted value or null), missingFields (string[]), requestedAction ("none" | "lookup_player" | "lookup_clan" | "lookup_profile" | "handoff_to_staff"), lookupTarget (string | null), issueSummary (string | null), neutralAssessment (string | null), complete (boolean).`,
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
    const model = snapshot.aiSettings.model.trim() || this.defaultModel;
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
          maxTokens: snapshot.aiSettings.maxTokens,
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
            maxTokens: snapshot.aiSettings.maxTokens,
            responseFormat: jsonObjectFormat,
            signal,
          });
        } else {
          throw err;
        }
      }

      const parsedJson = this.parseAndValidateJson(rawResult, effectiveFallback);
      return {
        turn: parsedJson.turn,
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

