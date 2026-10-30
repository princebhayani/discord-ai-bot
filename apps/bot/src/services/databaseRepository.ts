import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AiSettingsSchema,
  CategoryConfigSchema,
  OperationalMetricsSchema,
  ParsedPlayerProfileSchema,
  PlayerIntegrationConfigSchema,
  ReportSettingsSchema,
  ServerSettingsSchema,
  SessionConfigSnapshotSchema,
  StaffReportPayloadSchema,
  TicketDetectionConfigSchema,
  type AnswerPrimitive,
  type CategoryConfig,
  type OperationalErrorEntry,
  type OperationalMetrics,
  type ParsedPlayerProfile,
  type ServerSettings,
  type SessionConfigSnapshot,
  type StaffReportPayload,
  type TicketSessionStatus,
} from '@hrbot/shared';

export interface TicketSessionRecord {
  id: string;
  guildId: string;
  channelId: string;
  parentChannelId: string | null;
  categoryId: string;
  categoryName: string;
  isThread: boolean;
  isPrivateThread: boolean;
  providerVerifiedBy: string;
  playerDiscordId: string | null;
  playerUsername: string | null;
  status: TicketSessionStatus;
  welcomeSent: boolean;
  reportDelivered: boolean;
  configVersion: number;
  configSnapshot: SessionConfigSnapshot;
  lastProcessedMessageId: string | null;
  openedAt: string;
  updatedAt: string;
}

export interface TicketMessageRecord {
  id: string;
  sessionId: string;
  discordMessageId: string | null;
  senderType: 'player' | 'assistant' | 'staff' | 'system';
  senderDiscordId: string | null;
  content: string;
  redacted: boolean;
  createdAt: string;
}

export interface TicketAnswerRecord {
  id: string;
  sessionId: string;
  questionKey: string;
  answerValue: AnswerPrimitive;
  rawText: string | null;
  validated: boolean;
  validationNote: string | null;
  updatedAt: string;
}

export interface PlayerLookupRecord {
  id: string;
  sessionId: string;
  actionType: string;
  queryTarget: string;
  approvedCommand: string;
  commandMessageId: string | null;
  responseMessageId: string | null;
  status: 'pending' | 'completed' | 'failed' | 'timed_out' | 'unsupported';
  parsedData: ParsedPlayerProfile | null;
  errorReason: string | null;
  requestedAt: string;
  completedAt: string | null;
}

export interface StaffReportRecord {
  id: string;
  sessionId: string;
  destinationChannelId: string | null;
  deliveredMessageId: string | null;
  playerSummaryMessageId: string | null;
  reportPayload: StaffReportPayload;
  deliveryStatus: 'pending' | 'delivered' | 'failed';
  deliveryError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CleanupSessionResult {
  cleaned: boolean;
  alreadyAbsent: boolean;
  channelId: string;
  deletedMessages: number;
  deletedAnswers: number;
  deletedLookups: number;
  deletedReports: number;
}

export interface MetricsIncrement {
  groqRequests?: number;
  groqPromptTokens?: number;
  groqCompletionTokens?: number;
  playerLookupsSucceeded?: number;
  playerLookupsFailed?: number;
  reportsDelivered?: number;
  sessionsCleanedUp?: number;
  errorEntry?: OperationalErrorEntry;
}

export interface BotDatabaseRepository {
  ensureServerSettings(guildId: string, defaultModel: string): Promise<ServerSettings>;
  getCategoryConfigs(guildId: string): Promise<CategoryConfig[]>;
  updateHeartbeatAndMetrics(guildId: string, delta?: MetricsIncrement): Promise<void>;

  createOrGetTicketSession(input: {
    guildId: string;
    channelId: string;
    parentChannelId: string | null;
    categoryId: string;
    categoryName: string;
    isThread: boolean;
    isPrivateThread: boolean;
    providerVerifiedBy: string;
    playerDiscordId: string | null;
    playerUsername: string | null;
    configVersion: number;
    configSnapshot: SessionConfigSnapshot;
  }): Promise<{ session: TicketSessionRecord; created: boolean }>;

  getTicketSessionByChannel(channelId: string): Promise<TicketSessionRecord | null>;
  listActiveTicketSessions(guildId: string): Promise<TicketSessionRecord[]>;
  updateTicketSession(
    sessionId: string,
    patch: Partial<{
      playerDiscordId: string | null;
      playerUsername: string | null;
      status: TicketSessionStatus;
      welcomeSent: boolean;
      reportDelivered: boolean;
      lastProcessedMessageId: string | null;
    }>
  ): Promise<TicketSessionRecord | null>;

  appendTicketMessage(input: {
    sessionId: string;
    discordMessageId: string | null;
    senderType: 'player' | 'assistant' | 'staff' | 'system';
    senderDiscordId: string | null;
    content: string;
    redacted: boolean;
  }): Promise<{ message: TicketMessageRecord; duplicate: boolean }>;

  listTicketMessages(sessionId: string, maxRecent?: number): Promise<TicketMessageRecord[]>;

  upsertTicketAnswer(input: {
    sessionId: string;
    questionKey: string;
    answerValue: AnswerPrimitive;
    rawText: string | null;
    validated: boolean;
    validationNote: string | null;
  }): Promise<TicketAnswerRecord>;

  listTicketAnswers(sessionId: string): Promise<TicketAnswerRecord[]>;

  createPlayerLookup(input: {
    sessionId: string;
    actionType: string;
    queryTarget: string;
    approvedCommand: string;
    commandMessageId?: string | null;
    status?: PlayerLookupRecord['status'];
    errorReason?: string | null;
  }): Promise<PlayerLookupRecord>;

  updatePlayerLookup(
    lookupId: string,
    patch: Partial<{
      commandMessageId: string | null;
      responseMessageId: string | null;
      status: PlayerLookupRecord['status'];
      parsedData: ParsedPlayerProfile | null;
      errorReason: string | null;
      completedAt: string | null;
    }>
  ): Promise<PlayerLookupRecord | null>;

  listPlayerLookups(sessionId: string): Promise<PlayerLookupRecord[]>;

  upsertStaffReport(input: {
    sessionId: string;
    destinationChannelId: string | null;
    deliveredMessageId: string | null;
    playerSummaryMessageId: string | null;
    reportPayload: StaffReportPayload;
    deliveryStatus: 'pending' | 'delivered' | 'failed';
    deliveryError?: string | null;
  }): Promise<StaffReportRecord>;

  getStaffReport(sessionId: string): Promise<StaffReportRecord | null>;

  cleanupClosedTicketSession(guildId: string, channelId: string): Promise<CleanupSessionResult>;
}

function applyMetricsDelta(
  current: OperationalMetrics,
  delta?: MetricsIncrement
): OperationalMetrics {
  if (!delta) return current;
  const nextErrors = delta.errorEntry
    ? [delta.errorEntry, ...current.recentErrors].slice(0, 25)
    : current.recentErrors;

  return {
    groqRequestsTotal: current.groqRequestsTotal + (delta.groqRequests ?? 0),
    groqPromptTokensTotal: current.groqPromptTokensTotal + (delta.groqPromptTokens ?? 0),
    groqCompletionTokensTotal:
      current.groqCompletionTokensTotal + (delta.groqCompletionTokens ?? 0),
    playerLookupsSucceeded:
      current.playerLookupsSucceeded + (delta.playerLookupsSucceeded ?? 0),
    playerLookupsFailed: current.playerLookupsFailed + (delta.playerLookupsFailed ?? 0),
    reportsDelivered: current.reportsDelivered + (delta.reportsDelivered ?? 0),
    sessionsCleanedUp: current.sessionsCleanedUp + (delta.sessionsCleanedUp ?? 0),
    recentErrors: nextErrors,
  };
}

/**
 * Production Supabase PostgreSQL repository using the server-side Service Role key.
 */
export class SupabaseBotRepository implements BotDatabaseRepository {
  private readonly supabase: SupabaseClient;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /**
   * Retries transient Supabase network failures with bounded exponential backoff.
   */
  private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          const delayMs = attempt * 200;
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastErr;
  }

  private mapServerSettingsRow(row: Record<string, unknown>, defaultModel: string): ServerSettings {
    const aiRaw = (row.ai_settings as Record<string, unknown> | null) ?? {};
    const parsedAi = AiSettingsSchema.parse({
      ...aiRaw,
      model: typeof aiRaw.model === 'string' && aiRaw.model.trim() !== '' ? aiRaw.model : defaultModel,
    });

    return ServerSettingsSchema.parse({
      id: row.id,
      guildId: row.guild_id,
      guildName: row.guild_name ?? 'Discord Server',
      botEnabled: row.bot_enabled ?? true,
      defaultWelcomeMessage: row.default_welcome_message,
      ticketDetectionConfig: TicketDetectionConfigSchema.parse(row.ticket_detection_config ?? {}),
      aiSettings: parsedAi,
      playerIntegrationConfig: PlayerIntegrationConfigSchema.parse(
        row.player_integration_config ?? {}
      ),
      reportSettings: ReportSettingsSchema.parse(row.report_settings ?? {}),
      operationalMetrics: OperationalMetricsSchema.parse(row.operational_metrics ?? {}),
      botHeartbeatAt: (row.bot_heartbeat_at as string | null) ?? null,
      configVersion: Number(row.config_version ?? 1),
    });
  }

  private mapSessionRow(row: Record<string, unknown>): TicketSessionRecord {
    return {
      id: String(row.id),
      guildId: String(row.guild_id),
      channelId: String(row.channel_id),
      parentChannelId: (row.parent_channel_id as string | null) ?? null,
      categoryId: String(row.category_id),
      categoryName: String(row.category_name ?? ''),
      isThread: Boolean(row.is_thread),
      isPrivateThread: Boolean(row.is_private_thread),
      providerVerifiedBy: String(row.provider_verified_by ?? 'category'),
      playerDiscordId: (row.player_discord_id as string | null) ?? null,
      playerUsername: (row.player_username as string | null) ?? null,
      status: row.status as TicketSessionStatus,
      welcomeSent: Boolean(row.welcome_sent),
      reportDelivered: Boolean(row.report_delivered),
      configVersion: Number(row.config_version ?? 1),
      configSnapshot: SessionConfigSnapshotSchema.parse(row.config_snapshot),
      lastProcessedMessageId: (row.last_processed_message_id as string | null) ?? null,
      openedAt: String(row.opened_at),
      updatedAt: String(row.updated_at),
    };
  }

  async ensureServerSettings(guildId: string, defaultModel: string): Promise<ServerSettings> {
    return this.withRetry(async () => {
      const { data: existing, error: fetchError } = await this.supabase
        .from('server_settings')
        .select('*')
        .eq('guild_id', guildId)
        .maybeSingle();

      if (fetchError) {
        throw new Error(`Failed reading server_settings: ${fetchError.message}`);
      }

      if (existing) {
        return this.mapServerSettingsRow(existing as Record<string, unknown>, defaultModel);
      }

      const initialAi = AiSettingsSchema.parse({ model: defaultModel });
      const { data: created, error: insertError } = await this.supabase
        .from('server_settings')
        .upsert(
          {
            guild_id: guildId,
            ai_settings: initialAi,
          },
          { onConflict: 'guild_id' }
        )
        .select('*')
        .single();

      if (insertError || !created) {
        throw new Error(`Failed initializing server_settings: ${insertError?.message}`);
      }

      return this.mapServerSettingsRow(created as Record<string, unknown>, defaultModel);
    });
  }

  async getCategoryConfigs(guildId: string): Promise<CategoryConfig[]> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from('ticket_category_configs')
        .select('*')
        .eq('guild_id', guildId)
        .order('category_name', { ascending: true });

      if (error) {
        throw new Error(`Failed reading ticket_category_configs: ${error.message}`);
      }

      return (data ?? []).map((row: Record<string, unknown>) => {
        // Use published_snapshot when available so unpublished draft edits don't leak prematurely
        if (row.published_snapshot && typeof row.published_snapshot === 'object') {
          return CategoryConfigSchema.parse({
            ...(row.published_snapshot as Record<string, unknown>),
            id: row.id,
            guildId: row.guild_id,
            categoryId: row.category_id,
            configVersion: Number(row.config_version ?? 1),
          });
        }

        return CategoryConfigSchema.parse({
          id: row.id,
          guildId: row.guild_id,
          categoryId: row.category_id,
          categoryName: row.category_name,
          enabled: row.enabled,
          welcomeMessage: row.welcome_message,
          categoryInstructions: row.category_instructions ?? '',
          faqs: row.faqs ?? [],
          questions: row.questions ?? [],
          playerLookupEnabled: row.player_lookup_enabled ?? false,
          reportChannelOverrideId: row.report_channel_override_id ?? '',
          configVersion: Number(row.config_version ?? 1),
        });
      });
    });
  }

  async updateHeartbeatAndMetrics(guildId: string, delta?: MetricsIncrement): Promise<void> {
    const { data } = await this.supabase
      .from('server_settings')
      .select('operational_metrics')
      .eq('guild_id', guildId)
      .maybeSingle();

    const currentMetrics = OperationalMetricsSchema.parse(
      (data as Record<string, unknown> | null)?.operational_metrics ?? {}
    );
    const updatedMetrics = applyMetricsDelta(currentMetrics, delta);

    await this.supabase
      .from('server_settings')
      .update({
        bot_heartbeat_at: new Date().toISOString(),
        operational_metrics: updatedMetrics,
      })
      .eq('guild_id', guildId);
  }

  async createOrGetTicketSession(input: {
    guildId: string;
    channelId: string;
    parentChannelId: string | null;
    categoryId: string;
    categoryName: string;
    isThread: boolean;
    isPrivateThread: boolean;
    providerVerifiedBy: string;
    playerDiscordId: string | null;
    playerUsername: string | null;
    configVersion: number;
    configSnapshot: SessionConfigSnapshot;
  }): Promise<{ session: TicketSessionRecord; created: boolean }> {
    const existing = await this.getTicketSessionByChannel(input.channelId);
    if (existing) {
      return { session: existing, created: false };
    }

    const { data, error } = await this.supabase
      .from('ticket_sessions')
      .insert({
        guild_id: input.guildId,
        channel_id: input.channelId,
        parent_channel_id: input.parentChannelId,
        category_id: input.categoryId,
        category_name: input.categoryName,
        is_thread: input.isThread,
        is_private_thread: input.isPrivateThread,
        provider_verified_by: input.providerVerifiedBy,
        player_discord_id: input.playerDiscordId,
        player_username: input.playerUsername,
        status: 'active',
        welcome_sent: false,
        report_delivered: false,
        config_version: input.configVersion,
        config_snapshot: input.configSnapshot,
      })
      .select('*')
      .maybeSingle();

    if (error) {
      // Handle race condition if another event created it simultaneously
      const raced = await this.getTicketSessionByChannel(input.channelId);
      if (raced) {
        return { session: raced, created: false };
      }
      throw new Error(`Failed creating ticket_session: ${error.message}`);
    }

    return {
      session: this.mapSessionRow(data as Record<string, unknown>),
      created: true,
    };
  }

  async getTicketSessionByChannel(channelId: string): Promise<TicketSessionRecord | null> {
    const { data, error } = await this.supabase
      .from('ticket_sessions')
      .select('*')
      .eq('channel_id', channelId)
      .maybeSingle();

    if (error || !data) return null;
    return this.mapSessionRow(data as Record<string, unknown>);
  }

  async listActiveTicketSessions(guildId: string): Promise<TicketSessionRecord[]> {
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from('ticket_sessions')
        .select('*')
        .eq('guild_id', guildId)
        .neq('status', 'closing');

      if (error) {
        throw new Error(`Failed listing active sessions: ${error.message}`);
      }

      return (data ?? []).map((r) => this.mapSessionRow(r as Record<string, unknown>));
    });
  }

  async updateTicketSession(
    sessionId: string,
    patch: Partial<{
      playerDiscordId: string | null;
      playerUsername: string | null;
      status: TicketSessionStatus;
      welcomeSent: boolean;
      reportDelivered: boolean;
      lastProcessedMessageId: string | null;
    }>
  ): Promise<TicketSessionRecord | null> {
    const updatePayload: Record<string, unknown> = {};
    if (patch.playerDiscordId !== undefined) updatePayload.player_discord_id = patch.playerDiscordId;
    if (patch.playerUsername !== undefined) updatePayload.player_username = patch.playerUsername;
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.welcomeSent !== undefined) updatePayload.welcome_sent = patch.welcomeSent;
    if (patch.reportDelivered !== undefined) updatePayload.report_delivered = patch.reportDelivered;
    if (patch.lastProcessedMessageId !== undefined) {
      updatePayload.last_processed_message_id = patch.lastProcessedMessageId;
    }

    const { data, error } = await this.supabase
      .from('ticket_sessions')
      .update(updatePayload)
      .eq('id', sessionId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    return this.mapSessionRow(data as Record<string, unknown>);
  }

  async appendTicketMessage(input: {
    sessionId: string;
    discordMessageId: string | null;
    senderType: 'player' | 'assistant' | 'staff' | 'system';
    senderDiscordId: string | null;
    content: string;
    redacted: boolean;
  }): Promise<{ message: TicketMessageRecord; duplicate: boolean }> {
    if (input.discordMessageId) {
      const { data: existing } = await this.supabase
        .from('ticket_messages')
        .select('*')
        .eq('discord_message_id', input.discordMessageId)
        .maybeSingle();

      if (existing) {
        const row = existing as Record<string, unknown>;
        return {
          duplicate: true,
          message: {
            id: String(row.id),
            sessionId: String(row.session_id),
            discordMessageId: (row.discord_message_id as string | null) ?? null,
            senderType: row.sender_type as TicketMessageRecord['senderType'],
            senderDiscordId: (row.sender_discord_id as string | null) ?? null,
            content: String(row.content),
            redacted: Boolean(row.redacted),
            createdAt: String(row.created_at),
          },
        };
      }
    }

    const { data, error } = await this.supabase
      .from('ticket_messages')
      .insert({
        session_id: input.sessionId,
        discord_message_id: input.discordMessageId,
        sender_type: input.senderType,
        sender_discord_id: input.senderDiscordId,
        content: input.content,
        redacted: input.redacted,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed inserting ticket_message: ${error?.message}`);
    }

    const row = data as Record<string, unknown>;
    return {
      duplicate: false,
      message: {
        id: String(row.id),
        sessionId: String(row.session_id),
        discordMessageId: (row.discord_message_id as string | null) ?? null,
        senderType: row.sender_type as TicketMessageRecord['senderType'],
        senderDiscordId: (row.sender_discord_id as string | null) ?? null,
        content: String(row.content),
        redacted: Boolean(row.redacted),
        createdAt: String(row.created_at),
      },
    };
  }

  async listTicketMessages(sessionId: string, maxRecent = 25): Promise<TicketMessageRecord[]> {
    const boundedLimit = Math.min(Math.max(maxRecent, 1), 50);
    return this.withRetry(async () => {
      const { data, error } = await this.supabase
        .from('ticket_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(boundedLimit);

      if (error) {
        throw new Error(`Failed reading ticket_messages: ${error.message}`);
      }

      const rows = (data ?? []).slice().reverse();
      return rows.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        sessionId: String(r.session_id),
        discordMessageId: (r.discord_message_id as string | null) ?? null,
        senderType: r.sender_type as TicketMessageRecord['senderType'],
        senderDiscordId: (r.sender_discord_id as string | null) ?? null,
        content: String(r.content),
        redacted: Boolean(r.redacted),
        createdAt: String(r.created_at),
      }));
    });
  }

  async upsertTicketAnswer(input: {
    sessionId: string;
    questionKey: string;
    answerValue: AnswerPrimitive;
    rawText: string | null;
    validated: boolean;
    validationNote: string | null;
  }): Promise<TicketAnswerRecord> {
    const { data, error } = await this.supabase
      .from('ticket_answers')
      .upsert(
        {
          session_id: input.sessionId,
          question_key: input.questionKey,
          answer_value: input.answerValue,
          raw_text: input.rawText,
          validated: input.validated,
          validation_note: input.validationNote,
        },
        { onConflict: 'session_id,question_key' }
      )
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed upserting ticket_answer: ${error?.message}`);
    }

    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      questionKey: String(row.question_key),
      answerValue: (row.answer_value as AnswerPrimitive) ?? null,
      rawText: (row.raw_text as string | null) ?? null,
      validated: Boolean(row.validated),
      validationNote: (row.validation_note as string | null) ?? null,
      updatedAt: String(row.updated_at),
    };
  }

  async listTicketAnswers(sessionId: string): Promise<TicketAnswerRecord[]> {
    const { data, error } = await this.supabase
      .from('ticket_answers')
      .select('*')
      .eq('session_id', sessionId);

    if (error) {
      throw new Error(`Failed listing ticket_answers: ${error.message}`);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      questionKey: String(row.question_key),
      answerValue: (row.answer_value as AnswerPrimitive) ?? null,
      rawText: (row.raw_text as string | null) ?? null,
      validated: Boolean(row.validated),
      validationNote: (row.validation_note as string | null) ?? null,
      updatedAt: String(row.updated_at),
    }));
  }

  async createPlayerLookup(input: {
    sessionId: string;
    actionType: string;
    queryTarget: string;
    approvedCommand: string;
    commandMessageId?: string | null;
    status?: PlayerLookupRecord['status'];
    errorReason?: string | null;
  }): Promise<PlayerLookupRecord> {
    const { data, error } = await this.supabase
      .from('player_lookups')
      .insert({
        session_id: input.sessionId,
        action_type: input.actionType,
        query_target: input.queryTarget,
        approved_command: input.approvedCommand,
        command_message_id: input.commandMessageId ?? null,
        status: input.status ?? 'pending',
        error_reason: input.errorReason ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed creating player_lookup: ${error?.message}`);
    }

    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      actionType: String(row.action_type),
      queryTarget: String(row.query_target),
      approvedCommand: String(row.approved_command),
      commandMessageId: (row.command_message_id as string | null) ?? null,
      responseMessageId: (row.response_message_id as string | null) ?? null,
      status: row.status as PlayerLookupRecord['status'],
      parsedData: row.parsed_data ? ParsedPlayerProfileSchema.parse(row.parsed_data) : null,
      errorReason: (row.error_reason as string | null) ?? null,
      requestedAt: String(row.requested_at),
      completedAt: (row.completed_at as string | null) ?? null,
    };
  }

  async updatePlayerLookup(
    lookupId: string,
    patch: Partial<{
      commandMessageId: string | null;
      responseMessageId: string | null;
      status: PlayerLookupRecord['status'];
      parsedData: ParsedPlayerProfile | null;
      errorReason: string | null;
      completedAt: string | null;
    }>
  ): Promise<PlayerLookupRecord | null> {
    const updateObj: Record<string, unknown> = {};
    if (patch.commandMessageId !== undefined) updateObj.command_message_id = patch.commandMessageId;
    if (patch.responseMessageId !== undefined) updateObj.response_message_id = patch.responseMessageId;
    if (patch.status !== undefined) updateObj.status = patch.status;
    if (patch.parsedData !== undefined) updateObj.parsed_data = patch.parsedData;
    if (patch.errorReason !== undefined) updateObj.error_reason = patch.errorReason;
    if (patch.completedAt !== undefined) updateObj.completed_at = patch.completedAt;

    const { data, error } = await this.supabase
      .from('player_lookups')
      .update(updateObj)
      .eq('id', lookupId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      actionType: String(row.action_type),
      queryTarget: String(row.query_target),
      approvedCommand: String(row.approved_command),
      commandMessageId: (row.command_message_id as string | null) ?? null,
      responseMessageId: (row.response_message_id as string | null) ?? null,
      status: row.status as PlayerLookupRecord['status'],
      parsedData: row.parsed_data ? ParsedPlayerProfileSchema.parse(row.parsed_data) : null,
      errorReason: (row.error_reason as string | null) ?? null,
      requestedAt: String(row.requested_at),
      completedAt: (row.completed_at as string | null) ?? null,
    };
  }

  async listPlayerLookups(sessionId: string): Promise<PlayerLookupRecord[]> {
    const { data, error } = await this.supabase
      .from('player_lookups')
      .select('*')
      .eq('session_id', sessionId)
      .order('requested_at', { ascending: true });

    if (error) {
      throw new Error(`Failed listing player_lookups: ${error.message}`);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      actionType: String(row.action_type),
      queryTarget: String(row.query_target),
      approvedCommand: String(row.approved_command),
      commandMessageId: (row.command_message_id as string | null) ?? null,
      responseMessageId: (row.response_message_id as string | null) ?? null,
      status: row.status as PlayerLookupRecord['status'],
      parsedData: row.parsed_data ? ParsedPlayerProfileSchema.parse(row.parsed_data) : null,
      errorReason: (row.error_reason as string | null) ?? null,
      requestedAt: String(row.requested_at),
      completedAt: (row.completed_at as string | null) ?? null,
    }));
  }

  async upsertStaffReport(input: {
    sessionId: string;
    destinationChannelId: string | null;
    deliveredMessageId: string | null;
    playerSummaryMessageId: string | null;
    reportPayload: StaffReportPayload;
    deliveryStatus: 'pending' | 'delivered' | 'failed';
    deliveryError?: string | null;
  }): Promise<StaffReportRecord> {
    const { data, error } = await this.supabase
      .from('staff_reports')
      .upsert(
        {
          session_id: input.sessionId,
          destination_channel_id: input.destinationChannelId,
          delivered_message_id: input.deliveredMessageId,
          player_summary_message_id: input.playerSummaryMessageId,
          report_payload: input.reportPayload,
          delivery_status: input.deliveryStatus,
          delivery_error: input.deliveryError ?? null,
        },
        { onConflict: 'session_id' }
      )
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed upserting staff_report: ${error?.message}`);
    }

    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      destinationChannelId: (row.destination_channel_id as string | null) ?? null,
      deliveredMessageId: (row.delivered_message_id as string | null) ?? null,
      playerSummaryMessageId: (row.player_summary_message_id as string | null) ?? null,
      reportPayload: StaffReportPayloadSchema.parse(row.report_payload),
      deliveryStatus: row.delivery_status as StaffReportRecord['deliveryStatus'],
      deliveryError: (row.delivery_error as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async getStaffReport(sessionId: string): Promise<StaffReportRecord | null> {
    const { data, error } = await this.supabase
      .from('staff_reports')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      destinationChannelId: (row.destination_channel_id as string | null) ?? null,
      deliveredMessageId: (row.delivered_message_id as string | null) ?? null,
      playerSummaryMessageId: (row.player_summary_message_id as string | null) ?? null,
      reportPayload: StaffReportPayloadSchema.parse(row.report_payload),
      deliveryStatus: row.delivery_status as StaffReportRecord['deliveryStatus'],
      deliveryError: (row.delivery_error as string | null) ?? null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async cleanupClosedTicketSession(
    guildId: string,
    channelId: string
  ): Promise<CleanupSessionResult> {
    const { data, error } = await this.supabase.rpc('cleanup_closed_ticket_session', {
      target_guild_id: guildId,
      target_channel_id: channelId,
    });

    if (!error && data && typeof data === 'object') {
      const res = data as Record<string, unknown>;
      return {
        cleaned: Boolean(res.cleaned),
        alreadyAbsent: Boolean(res.alreadyAbsent),
        channelId,
        deletedMessages: Number(res.deletedMessages ?? 0),
        deletedAnswers: Number(res.deletedAnswers ?? 0),
        deletedLookups: Number(res.deletedLookups ?? 0),
        deletedReports: Number(res.deletedReports ?? 0),
      };
    }

    // Fallback direct delete (ON DELETE CASCADE cleans child temporary rows)
    const existing = await this.getTicketSessionByChannel(channelId);
    if (!existing) {
      return {
        cleaned: false,
        alreadyAbsent: true,
        channelId,
        deletedMessages: 0,
        deletedAnswers: 0,
        deletedLookups: 0,
        deletedReports: 0,
      };
    }

    await this.supabase
      .from('ticket_sessions')
      .delete()
      .eq('id', existing.id)
      .eq('guild_id', guildId);

    return {
      cleaned: true,
      alreadyAbsent: false,
      channelId,
      deletedMessages: 0,
      deletedAnswers: 0,
      deletedLookups: 0,
      deletedReports: 0,
    };
  }
}

/**
 * Deterministic in-memory repository implementing identical cascade & idempotency semantics
 * for unit and end-to-end milestone tests.
 */
export class InMemoryBotRepository implements BotDatabaseRepository {
  public serverSettings = new Map<string, ServerSettings>();
  public categoryConfigs = new Map<string, CategoryConfig[]>();
  public sessions = new Map<string, TicketSessionRecord>();
  public messages = new Map<string, TicketMessageRecord[]>();
  public answers = new Map<string, Map<string, TicketAnswerRecord>>();
  public lookups = new Map<string, PlayerLookupRecord[]>();
  public reports = new Map<string, StaffReportRecord>();

  async ensureServerSettings(guildId: string, defaultModel: string): Promise<ServerSettings> {
    const existing = this.serverSettings.get(guildId);
    if (existing) {
      return existing;
    }

    const created = ServerSettingsSchema.parse({
      id: crypto.randomUUID(),
      guildId,
      guildName: 'Test Guild',
      botEnabled: true,
      defaultWelcomeMessage:
        "Hello! Welcome to Support.\n\nI'm your automated support assistant.\n\nLet's get started.",
      ticketDetectionConfig: {},
      aiSettings: { model: defaultModel },
      playerIntegrationConfig: {},
      reportSettings: {},
      operationalMetrics: {},
      configVersion: 1,
    });
    this.serverSettings.set(guildId, created);
    return created;
  }

  async getCategoryConfigs(guildId: string): Promise<CategoryConfig[]> {
    return (this.categoryConfigs.get(guildId) ?? []).map((c) => structuredClone(c));
  }

  setCategoryConfigs(guildId: string, configs: CategoryConfig[]): void {
    this.categoryConfigs.set(guildId, configs.map((c) => structuredClone(c)));
  }

  setServerSettings(settings: ServerSettings): void {
    this.serverSettings.set(settings.guildId, structuredClone(settings));
  }

  async updateHeartbeatAndMetrics(guildId: string, delta?: MetricsIncrement): Promise<void> {
    const existing = this.serverSettings.get(guildId);
    if (!existing) return;
    existing.botHeartbeatAt = new Date().toISOString();
    existing.operationalMetrics = applyMetricsDelta(existing.operationalMetrics, delta);
  }

  async createOrGetTicketSession(input: {
    guildId: string;
    channelId: string;
    parentChannelId: string | null;
    categoryId: string;
    categoryName: string;
    isThread: boolean;
    isPrivateThread: boolean;
    providerVerifiedBy: string;
    playerDiscordId: string | null;
    playerUsername: string | null;
    configVersion: number;
    configSnapshot: SessionConfigSnapshot;
  }): Promise<{ session: TicketSessionRecord; created: boolean }> {
    const byChannel = await this.getTicketSessionByChannel(input.channelId);
    if (byChannel) {
      return { session: structuredClone(byChannel), created: false };
    }

    const now = new Date().toISOString();
    const record: TicketSessionRecord = {
      id: crypto.randomUUID(),
      guildId: input.guildId,
      channelId: input.channelId,
      parentChannelId: input.parentChannelId,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      isThread: input.isThread,
      isPrivateThread: input.isPrivateThread,
      providerVerifiedBy: input.providerVerifiedBy,
      playerDiscordId: input.playerDiscordId,
      playerUsername: input.playerUsername,
      status: 'active',
      welcomeSent: false,
      reportDelivered: false,
      configVersion: input.configVersion,
      configSnapshot: structuredClone(input.configSnapshot),
      lastProcessedMessageId: null,
      openedAt: now,
      updatedAt: now,
    };

    this.sessions.set(record.id, record);
    return { session: structuredClone(record), created: true };
  }

  async getTicketSessionByChannel(channelId: string): Promise<TicketSessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.channelId === channelId) {
        return structuredClone(s);
      }
    }
    return null;
  }

  async listActiveTicketSessions(guildId: string): Promise<TicketSessionRecord[]> {
    return Array.from(this.sessions.values())
      .filter((s) => s.guildId === guildId && s.status !== 'closing')
      .map((s) => structuredClone(s));
  }

  async updateTicketSession(
    sessionId: string,
    patch: Partial<{
      playerDiscordId: string | null;
      playerUsername: string | null;
      status: TicketSessionStatus;
      welcomeSent: boolean;
      reportDelivered: boolean;
      lastProcessedMessageId: string | null;
    }>
  ): Promise<TicketSessionRecord | null> {
    const existing = this.sessions.get(sessionId);
    if (!existing) return null;
    Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
    return structuredClone(existing);
  }

  async appendTicketMessage(input: {
    sessionId: string;
    discordMessageId: string | null;
    senderType: 'player' | 'assistant' | 'staff' | 'system';
    senderDiscordId: string | null;
    content: string;
    redacted: boolean;
  }): Promise<{ message: TicketMessageRecord; duplicate: boolean }> {
    const list = this.messages.get(input.sessionId) ?? [];
    if (input.discordMessageId) {
      const dup = list.find((m) => m.discordMessageId === input.discordMessageId);
      if (dup) {
        return { message: structuredClone(dup), duplicate: true };
      }
    }

    const msg: TicketMessageRecord = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      discordMessageId: input.discordMessageId,
      senderType: input.senderType,
      senderDiscordId: input.senderDiscordId,
      content: input.content,
      redacted: input.redacted,
      createdAt: new Date().toISOString(),
    };
    list.push(msg);
    this.messages.set(input.sessionId, list);
    return { message: structuredClone(msg), duplicate: false };
  }

  async listTicketMessages(sessionId: string, maxRecent = 25): Promise<TicketMessageRecord[]> {
    const all = this.messages.get(sessionId) ?? [];
    const bounded = all.slice(-Math.min(Math.max(maxRecent, 1), 50));
    return bounded.map((m) => structuredClone(m));
  }

  async upsertTicketAnswer(input: {
    sessionId: string;
    questionKey: string;
    answerValue: AnswerPrimitive;
    rawText: string | null;
    validated: boolean;
    validationNote: string | null;
  }): Promise<TicketAnswerRecord> {
    const map = this.answers.get(input.sessionId) ?? new Map<string, TicketAnswerRecord>();
    const existing = map.get(input.questionKey);
    const record: TicketAnswerRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      sessionId: input.sessionId,
      questionKey: input.questionKey,
      answerValue: input.answerValue,
      rawText: input.rawText,
      validated: input.validated,
      validationNote: input.validationNote,
      updatedAt: new Date().toISOString(),
    };
    map.set(input.questionKey, record);
    this.answers.set(input.sessionId, map);
    return structuredClone(record);
  }

  async listTicketAnswers(sessionId: string): Promise<TicketAnswerRecord[]> {
    const map = this.answers.get(sessionId);
    if (!map) return [];
    return Array.from(map.values()).map((a) => structuredClone(a));
  }

  async createPlayerLookup(input: {
    sessionId: string;
    actionType: string;
    queryTarget: string;
    approvedCommand: string;
    commandMessageId?: string | null;
    status?: PlayerLookupRecord['status'];
    errorReason?: string | null;
  }): Promise<PlayerLookupRecord> {
    const list = this.lookups.get(input.sessionId) ?? [];
    const rec: PlayerLookupRecord = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      actionType: input.actionType,
      queryTarget: input.queryTarget,
      approvedCommand: input.approvedCommand,
      commandMessageId: input.commandMessageId ?? null,
      responseMessageId: null,
      status: input.status ?? 'pending',
      parsedData: null,
      errorReason: input.errorReason ?? null,
      requestedAt: new Date().toISOString(),
      completedAt: null,
    };
    list.push(rec);
    this.lookups.set(input.sessionId, list);
    return structuredClone(rec);
  }

  async updatePlayerLookup(
    lookupId: string,
    patch: Partial<{
      commandMessageId: string | null;
      responseMessageId: string | null;
      status: PlayerLookupRecord['status'];
      parsedData: ParsedPlayerProfile | null;
      errorReason: string | null;
      completedAt: string | null;
    }>
  ): Promise<PlayerLookupRecord | null> {
    for (const list of this.lookups.values()) {
      const target = list.find((l) => l.id === lookupId);
      if (target) {
        Object.assign(target, patch);
        return structuredClone(target);
      }
    }
    return null;
  }

  async listPlayerLookups(sessionId: string): Promise<PlayerLookupRecord[]> {
    return (this.lookups.get(sessionId) ?? []).map((l) => structuredClone(l));
  }

  async upsertStaffReport(input: {
    sessionId: string;
    destinationChannelId: string | null;
    deliveredMessageId: string | null;
    playerSummaryMessageId: string | null;
    reportPayload: StaffReportPayload;
    deliveryStatus: 'pending' | 'delivered' | 'failed';
    deliveryError?: string | null;
  }): Promise<StaffReportRecord> {
    const existing = this.reports.get(input.sessionId);
    const now = new Date().toISOString();
    const rec: StaffReportRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      sessionId: input.sessionId,
      destinationChannelId: input.destinationChannelId,
      deliveredMessageId: input.deliveredMessageId,
      playerSummaryMessageId: input.playerSummaryMessageId,
      reportPayload: structuredClone(input.reportPayload),
      deliveryStatus: input.deliveryStatus,
      deliveryError: input.deliveryError ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.reports.set(input.sessionId, rec);
    return structuredClone(rec);
  }

  async getStaffReport(sessionId: string): Promise<StaffReportRecord | null> {
    const rec = this.reports.get(sessionId);
    return rec ? structuredClone(rec) : null;
  }

  async cleanupClosedTicketSession(
    guildId: string,
    channelId: string
  ): Promise<CleanupSessionResult> {
    const target = Array.from(this.sessions.values()).find(
      (s) => s.guildId === guildId && s.channelId === channelId
    );
    if (!target) {
      return {
        cleaned: false,
        alreadyAbsent: true,
        channelId,
        deletedMessages: 0,
        deletedAnswers: 0,
        deletedLookups: 0,
        deletedReports: 0,
      };
    }

    const deletedMessages = (this.messages.get(target.id) ?? []).length;
    const deletedAnswers = this.answers.get(target.id)?.size ?? 0;
    const deletedLookups = (this.lookups.get(target.id) ?? []).length;
    const deletedReports = this.reports.has(target.id) ? 1 : 0;

    this.messages.delete(target.id);
    this.answers.delete(target.id);
    this.lookups.delete(target.id);
    this.reports.delete(target.id);
    this.sessions.delete(target.id);

    return {
      cleaned: true,
      alreadyAbsent: false,
      channelId,
      deletedMessages,
      deletedAnswers,
      deletedLookups,
      deletedReports,
    };
  }
}

