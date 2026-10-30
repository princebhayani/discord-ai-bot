import { z } from 'zod';

export const SnowflakeSchema = z
  .string()
  .trim()
  .regex(/^\d{15,22}$/, 'Invalid Discord Snowflake ID');

export const OptionalSnowflakeSchema = z
  .string()
  .trim()
  .refine((val) => val === '' || /^\d{15,22}$/.test(val), 'Must be empty or a valid Discord Snowflake ID');

export const QuestionTypeSchema = z.enum([
  'text',
  'long_text',
  'number',
  'boolean',
  'choice',
  'player_tag',
  'date',
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const LookupActionSchema = z.enum([
  'lookup_player',
  'lookup_clan',
  'lookup_profile',
]);
export type LookupAction = z.infer<typeof LookupActionSchema>;

export const RequestedAiActionSchema = z.enum([
  'none',
  'lookup_player',
  'lookup_clan',
  'lookup_profile',
  'handoff_to_staff',
]);
export type RequestedAiAction = z.infer<typeof RequestedAiActionSchema>;

export const ConditionOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'truthy',
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export const QuestionConditionSchema = z.object({
  dependsOnKey: z.string().min(1),
  operator: ConditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type QuestionCondition = z.infer<typeof QuestionConditionSchema>;

export const QuestionValidationSchema = z.object({
  regex: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  customError: z.string().max(240).optional(),
});
export type QuestionValidation = z.infer<typeof QuestionValidationSchema>;

export const QuestionnaireQuestionSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,48}$/, 'Question key must be snake_case alphanumeric'),
  question: z.string().trim().min(2).max(500),
  type: QuestionTypeSchema,
  required: z.boolean().default(true),
  choices: z.array(z.string().trim().min(1)).optional(),
  helpText: z.string().max(300).optional(),
  validation: QuestionValidationSchema.optional(),
  condition: QuestionConditionSchema.optional(),
  triggerLookupAction: LookupActionSchema.optional(),
});
export type QuestionnaireQuestion = z.infer<typeof QuestionnaireQuestionSchema>;

export const FaqItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().trim().min(2).max(300),
  answer: z.string().trim().min(2).max(1500),
});
export type FaqItem = z.infer<typeof FaqItemSchema>;

export const ThreadClosurePolicySchema = z.enum([
  'locked_only',
  'archived_and_locked',
  'archived_or_locked',
  'delete_only',
]);
export type ThreadClosurePolicy = z.infer<typeof ThreadClosurePolicySchema>;

export const TicketDetectionConfigSchema = z.object({
  providerBotIds: z.array(SnowflakeSchema).default([]),
  channelNamePrefixes: z.array(z.string().trim().min(1)).default(['ticket-', 'support-']),
  topicMarkers: z.array(z.string().trim().min(1)).default(['ticket', 'opened by']),
  knownEmbedKeywords: z.array(z.string().trim().min(1)).default(['ticket', 'support']),
  requireProviderVerification: z.boolean().default(true),
  waitForProviderEmbedMs: z.number().int().min(1000).max(30000).default(8000),
  threadClosurePolicy: ThreadClosurePolicySchema.default('locked_only'),
  webhookEnabled: z.boolean().default(false),
  ignorePrivateThreads: z.boolean().default(true),
  mentionUserOnWelcome: z.boolean().default(true),
});
export type TicketDetectionConfig = z.infer<typeof TicketDetectionConfigSchema>;

export const ToneStyleSchema = z.enum([
  'human_casual',
  'warm_friendly',
  'professional',
]);
export type ToneStyle = z.infer<typeof ToneStyleSchema>;

export const ServerKnowledgeSchema = z.object({
  serverOverview: z.string().max(4000).default(''),
  clanRequirementsAndRules: z.string().max(6000).default(''),
  joiningProcessAndTiming: z.string().max(4000).default(''),
  additionalNotes: z.string().max(4000).default(''),
});
export type ServerKnowledge = z.infer<typeof ServerKnowledgeSchema>;

export const AiSettingsSchema = z.object({
  model: z.string().trim().default(''),
  personaName: z.string().trim().max(80).default(''),
  toneStyle: ToneStyleSchema.default('human_casual'),
  humanizeConversation: z.boolean().default(true),
  answerPostCompletionQuestions: z.boolean().default(true),
  serverKnowledge: ServerKnowledgeSchema.default({}),
  systemInstructions: z
    .string()
    .max(4000)
    .default(
      'Chat naturally like a real, friendly Discord recruiter and support helper. Keep replies short (1-2 sentences), casual, and conversational. Ask one question at a time, never repeat answered questions, and never promise bans or leadership decisions.'
    ),
  maxTokens: z.number().int().min(128).max(4096).default(900),
  temperature: z.number().min(0).max(1.5).default(0.55),
  globalConcurrencyLimit: z.number().int().min(1).max(25).default(5),
  perTicketRateLimitPerMinute: z.number().int().min(2).max(60).default(12),
  structuredOutputsEnabled: z.boolean().default(true),
  fallbackMessage: z
    .string()
    .min(5)
    .max(1000)
    .default('Hang tight—one of our team members will jump in here to help you out soon!'),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const ParserConfigSchema = z.object({
  strategy: z.enum(['embed_and_regex', 'embed_only', 'regex_only']).default('embed_and_regex'),
  fieldMappings: z
    .record(z.string(), z.array(z.string()))
    .default({
      playerTag: ['Player Tag', 'Tag'],
      playerName: ['Name', 'Player', 'IGN'],
      townHallLevel: ['Town Hall', 'TH', 'TH Level'],
      clanName: ['Clan'],
      donations: ['Donations', 'Donated'],
      trophies: ['Trophies'],
    }),
  regexPatterns: z
    .record(z.string(), z.string())
    .default({
      playerTag: '#[A-Z0-9]{3,16}',
      townHallLevel: '(?:TH|Town\\s*Hall)[:\\s]*(\\d{1,2})',
      trophies: '(?:Trophies)[:\\s]*([\\d,]+)',
    }),
});
export type ParserConfig = z.infer<typeof ParserConfigSchema>;

export const ExecutionChannelModeSchema = z.enum([
  'dedicated_channel',
  'ticket_channel',
]);
export type ExecutionChannelMode = z.infer<typeof ExecutionChannelModeSchema>;

export const PlayerIntegrationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  quickCommandLine: z.string().max(500).default(''),
  executionChannelMode: ExecutionChannelModeSchema.default('dedicated_channel'),
  externalBotUserId: OptionalSnowflakeSchema.default(''),
  commandPrefix: z.string().trim().min(1).max(5).default('.'),
  executionChannelId: OptionalSnowflakeSchema.default(''),
  timeoutMs: z.number().int().min(2000).max(60000).default(12000),
  maxLookupsPerTicket: z.number().int().min(1).max(10).default(3),
  supportedActions: z.array(LookupActionSchema).default([
    'lookup_player',
    'lookup_clan',
    'lookup_profile',
  ]),
  commandTemplates: z
    .record(LookupActionSchema, z.string().min(2).max(120))
    .default({
      lookup_player: '{prefix}player {target}',
      lookup_clan: '{prefix}clan {target}',
      lookup_profile: '{prefix}profile {target}',
    }),
  parserConfig: ParserConfigSchema.default({}),
  externalApiWebhookUrl: z.string().url().optional().or(z.literal('')),
});
export type PlayerIntegrationConfig = z.infer<typeof PlayerIntegrationConfigSchema>;

export const ReportDestinationModeSchema = z.enum([
  'staff_channel',
  'existing_private_thread',
  'both',
]);
export type ReportDestinationMode = z.infer<typeof ReportDestinationModeSchema>;

export const ReportSettingsSchema = z.object({
  destinationMode: ReportDestinationModeSchema.default('staff_channel'),
  staffReportChannelId: OptionalSnowflakeSchema.default(''),
  allowVerifiedPrivateThreadDestination: z.boolean().default(false),
  includePlayerSummaryInTicket: z.boolean().default(false),
  staffRoleIds: z.array(SnowflakeSchema).default([]),
  staffUserIds: z.array(SnowflakeSchema).default([]),
  includeRawAnswers: z.boolean().default(true),
  includeLookupDetails: z.boolean().default(true),
  privacyRedactionEnabled: z.boolean().default(true),
});
export type ReportSettings = z.infer<typeof ReportSettingsSchema>;

export const OperationalErrorEntrySchema = z.object({
  timestamp: z.string(),
  code: z.string(),
  component: z.string(),
  message: z.string().max(300),
});
export type OperationalErrorEntry = z.infer<typeof OperationalErrorEntrySchema>;

export const OperationalMetricsSchema = z.object({
  groqRequestsTotal: z.number().int().nonnegative().default(0),
  groqPromptTokensTotal: z.number().int().nonnegative().default(0),
  groqCompletionTokensTotal: z.number().int().nonnegative().default(0),
  playerLookupsSucceeded: z.number().int().nonnegative().default(0),
  playerLookupsFailed: z.number().int().nonnegative().default(0),
  reportsDelivered: z.number().int().nonnegative().default(0),
  sessionsCleanedUp: z.number().int().nonnegative().default(0),
  recentErrors: z.array(OperationalErrorEntrySchema).max(25).default([]),
});
export type OperationalMetrics = z.infer<typeof OperationalMetricsSchema>;

export const CategoryConfigSchema = z.object({
  id: z.string().uuid().optional(),
  guildId: SnowflakeSchema,
  categoryId: SnowflakeSchema,
  categoryName: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(false),
  welcomeMessage: z.string().max(2000).nullable().optional(),
  categoryInstructions: z.string().max(3000).default(''),
  faqs: z.array(FaqItemSchema).default([]),
  questions: z.array(QuestionnaireQuestionSchema).default([]),
  playerLookupEnabled: z.boolean().default(false),
  reportChannelOverrideId: OptionalSnowflakeSchema.nullable().optional(),
  configVersion: z.number().int().positive().default(1),
});
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;

export const ServerSettingsSchema = z.object({
  id: z.string().uuid().optional(),
  guildId: SnowflakeSchema,
  guildName: z.string().trim().min(1).max(120).default('Discord Server'),
  botEnabled: z.boolean().default(true),
  defaultWelcomeMessage: z.string().min(5).max(2000),
  ticketDetectionConfig: TicketDetectionConfigSchema,
  aiSettings: AiSettingsSchema,
  playerIntegrationConfig: PlayerIntegrationConfigSchema,
  reportSettings: ReportSettingsSchema,
  operationalMetrics: OperationalMetricsSchema.default({}),
  botHeartbeatAt: z.string().nullable().optional(),
  configVersion: z.number().int().positive().default(1),
});
export type ServerSettings = z.infer<typeof ServerSettingsSchema>;

/**
 * Frozen snapshot pinned on ticket_sessions when a conversation begins so
 * active tickets keep their exact initial rules when admins edit dashboard configs.
 */
export const SessionConfigSnapshotSchema = z.object({
  serverConfigVersion: z.number().int().positive(),
  categoryConfigVersion: z.number().int().positive(),
  guildName: z.string(),
  welcomeMessage: z.string(),
  mentionUserOnWelcome: z.boolean().default(true),
  category: CategoryConfigSchema,
  aiSettings: AiSettingsSchema,
  playerIntegrationConfig: PlayerIntegrationConfigSchema,
  reportSettings: ReportSettingsSchema,
});
export type SessionConfigSnapshot = z.infer<typeof SessionConfigSnapshotSchema>;

export const TicketSessionStatusSchema = z.enum([
  'initializing',
  'active',
  'lookup_pending',
  'ready_for_review',
  'human_handoff',
  'closing',
]);
export type TicketSessionStatus = z.infer<typeof TicketSessionStatusSchema>;

export const AnswerPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type AnswerPrimitive = z.infer<typeof AnswerPrimitiveSchema>;

/**
 * Validated AI structured output schema for every Groq conversational turn.
 */
export const AiTurnResponseSchema = z.object({
  reply: z.string().trim().min(1).max(1900),
  extractedAnswers: z.record(z.string(), AnswerPrimitiveSchema).default({}),
  missingFields: z.array(z.string()).default([]),
  requestedAction: RequestedAiActionSchema.default('none'),
  lookupTarget: z.string().max(100).nullable().optional().default(null),
  issueSummary: z.string().max(1200).nullable().optional().default(null),
  neutralAssessment: z.string().max(1200).nullable().optional().default(null),
  complete: z.boolean().default(false),
});
export type AiTurnResponse = z.infer<typeof AiTurnResponseSchema>;

export const ParsedPlayerProfileSchema = z.object({
  playerTag: z.string().nullable().optional(),
  playerName: z.string().nullable().optional(),
  townHallLevel: z.union([z.number(), z.string()]).nullable().optional(),
  clanName: z.string().nullable().optional(),
  donations: z.union([z.number(), z.string()]).nullable().optional(),
  trophies: z.union([z.number(), z.string()]).nullable().optional(),
  extraFields: z.record(z.string(), z.string()).default({}),
  rawSummary: z.string().max(1000).optional(),
});
export type ParsedPlayerProfile = z.infer<typeof ParsedPlayerProfileSchema>;

export const StaffReportPayloadSchema = z.object({
  ticketDetails: z.object({
    sessionId: z.string().uuid(),
    channelId: SnowflakeSchema,
    parentChannelId: SnowflakeSchema.nullable().optional(),
    isThread: z.boolean(),
    categoryId: SnowflakeSchema,
    categoryName: z.string(),
    playerDiscordId: z.string().nullable(),
    playerUsername: z.string().nullable(),
    openedAt: z.string(),
  }),
  playerInformation: ParsedPlayerProfileSchema,
  issueDetails: z.object({
    originalIssue: z.string().nullable(),
    structuredAnswers: z.record(z.string(), AnswerPrimitiveSchema),
    aiSummary: z.string(),
    followUpHighlights: z.array(z.string()).default([]),
  }),
  investigation: z.object({
    commandsRequested: z.array(z.string()),
    lookupResults: z.array(
      z.object({
        actionType: z.string(),
        queryTarget: z.string(),
        status: z.string(),
        summary: z.string(),
      })
    ),
    failedLookups: z.array(z.string()),
    outstandingQuestions: z.array(z.string()),
  }),
  assessment: z.object({
    neutralSummary: z.string(),
  }),
});
export type StaffReportPayload = z.infer<typeof StaffReportPayloadSchema>;

export const TicketWebhookPayloadSchema = z.object({
  event: z.enum(['ticket.opened', 'ticket.closed']),
  guildId: SnowflakeSchema,
  channelId: SnowflakeSchema,
  categoryId: SnowflakeSchema.optional(),
  isThread: z.boolean().optional(),
  openerDiscordId: SnowflakeSchema.optional(),
  openerUsername: z.string().max(100).optional(),
  timestamp: z.number().int(),
});
export type TicketWebhookPayload = z.infer<typeof TicketWebhookPayloadSchema>;
