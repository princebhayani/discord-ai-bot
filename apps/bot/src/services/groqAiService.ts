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

export function buildSystemPrompt(input: AiTurnInput): string {
  const {
    snapshot,
    validAnswers,
    invalidFieldErrors,
    progress,
    playerProfile,
    recentSecretRedacted,
  } = input;

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

  return [
    `# Role & Identity`,
    `You are the automated AI ticket support assistant for "${snapshot.guildName}" (Category: "${snapshot.category.categoryName}").`,
    `Always be transparent that you are an automated support assistant gathering details for human moderators. Never claim to be human staff and never promise bans, unbans, or enforcement actions.`,
    ``,
    `# Server & Category Instructions`,
    snapshot.aiSettings.systemInstructions,
    snapshot.category.categoryInstructions
      ? `Category-specific guidance: ${snapshot.category.categoryInstructions}`
      : '',
    ``,
    `# Conversation Rules`,
    `1. Understand natural-language replies and extract ALL answers provided in the player's message (even if they answered multiple questions at once).`,
    `2. If the player corrects a previous answer, include the updated value in extractedAnswers; otherwise set keys not mentioned in the latest message to null.`,
    `3. NEVER re-ask a question that is already present in Already Collected Valid Answers unless the player explicitly asks to change it.`,
    `4. Ask AT MOST ONE main question in your reply so the conversation feels natural and not like a rigid form.`,
    `5. Stay focused on the support ticket; politely steer away from off-topic chat.`,
    `6. Never ask for passwords, recovery codes, or authentication secrets.`,
    recentSecretRedacted
      ? `IMPORTANT: The player's last message contained sensitive credential text that was automatically redacted. Remind them briefly never to share passwords or recovery codes in Discord.`
      : '',
    `7. Approved lookup actions you may request via requestedAction: ${lookupAllowed.length > 0 ? lookupAllowed.join(', ') : 'none (external lookup disabled)'}. Only request a lookup when you have a target (like player_tag or clan_name) that has not yet been looked up.`,
    `8. When all required questions are answered (missingRequiredKeys becomes empty after extracting from the latest message), set complete=true, provide a concise neutral issueSummary and neutralAssessment, and thank the player while letting them know human staff will review their ticket shortly.`,
    ``,
    `# Configured Active Questionnaire`,
    JSON.stringify(questionsSpec, null, 2),
    ``,
    `# Already Collected Valid Answers (DO NOT REPEAT THESE QUESTIONS)`,
    JSON.stringify(validAnswers, null, 2),
    ``,
    Object.keys(invalidFieldErrors).length > 0
      ? `# Validation Notes From Previous Attempt\n${JSON.stringify(invalidFieldErrors, null, 2)}`
      : '',
    playerProfile
      ? `# Verified External Player-Data Bot Profile\n${JSON.stringify(playerProfile, null, 2)}`
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
    const recentHistory = conversationHistory.slice(-20).map((m) => ({
      role: (m.senderType === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    }));

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
          temperature: snapshot.aiSettings.temperature,
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
            temperature: snapshot.aiSettings.temperature,
            maxTokens: snapshot.aiSettings.maxTokens,
            responseFormat: jsonObjectFormat,
            signal,
          });
        } else {
          throw err;
        }
      }

      const parsedJson = this.parseAndValidateJson(rawResult, snapshot.aiSettings.fallbackMessage);
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

