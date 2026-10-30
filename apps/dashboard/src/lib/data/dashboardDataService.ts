import 'server-only';
import {
  AiSettingsSchema,
  CategoryConfigSchema,
  OperationalMetricsSchema,
  PlayerIntegrationConfigSchema,
  ReportSettingsSchema,
  ServerSettingsSchema,
  TicketDetectionConfigSchema,
  type CategoryConfig,
  type ServerSettings,
} from '@hrbot/shared';
import { createSupabaseServiceClient } from '../supabase/server';

export interface ActiveSessionOverviewItem {
  id: string;
  channelId: string;
  categoryName: string;
  isThread: boolean;
  status: string;
  configVersion: number;
  openedAt: string;
}

export interface DashboardAdminEntry {
  id: string;
  guildId: string;
  discordUserId: string | null;
  discordRoleId: string | null;
  label: string;
  permissionLevel: 'owner' | 'admin' | 'moderator';
  active: boolean;
  createdAt: string;
}

export interface OverviewDashboardData {
  serverSettings: ServerSettings;
  categories: CategoryConfig[];
  activeSessions: ActiveSessionOverviewItem[];
  botOnline: boolean;
}

const DEFAULT_MODEL_FALLBACK = process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';

function mapServerRow(row: Record<string, unknown>): ServerSettings {
  const aiObj = (row.ai_settings as Record<string, unknown> | null) ?? {};
  return ServerSettingsSchema.parse({
    id: row.id,
    guildId: row.guild_id,
    guildName: row.guild_name ?? 'Discord Server',
    botEnabled: row.bot_enabled ?? true,
    defaultWelcomeMessage: row.default_welcome_message,
    ticketDetectionConfig: TicketDetectionConfigSchema.parse(row.ticket_detection_config ?? {}),
    aiSettings: AiSettingsSchema.parse({
      ...aiObj,
      model:
        typeof aiObj.model === 'string' && aiObj.model.trim() !== ''
          ? aiObj.model
          : DEFAULT_MODEL_FALLBACK,
    }),
    playerIntegrationConfig: PlayerIntegrationConfigSchema.parse(
      row.player_integration_config ?? {}
    ),
    reportSettings: ReportSettingsSchema.parse(row.report_settings ?? {}),
    operationalMetrics: OperationalMetricsSchema.parse(row.operational_metrics ?? {}),
    botHeartbeatAt: (row.bot_heartbeat_at as string | null) ?? null,
    configVersion: Number(row.config_version ?? 1),
  });
}

export async function getOrInitServerSettings(guildId: string): Promise<ServerSettings> {
  const supabase = createSupabaseServiceClient();
  const { data: existing, error } = await supabase
    .from('server_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed reading server_settings: ${error.message}`);
  }

  if (existing) {
    return mapServerRow(existing as Record<string, unknown>);
  }

  const { data: created, error: createErr } = await supabase
    .from('server_settings')
    .insert({
      guild_id: guildId,
      ai_settings: AiSettingsSchema.parse({ model: DEFAULT_MODEL_FALLBACK }),
    })
    .select('*')
    .single();

  if (createErr || !created) {
    throw new Error(`Failed initializing server_settings: ${createErr?.message}`);
  }

  return mapServerRow(created as Record<string, unknown>);
}

export async function listCategoryConfigs(guildId: string): Promise<CategoryConfig[]> {
  const supabase = createSupabaseServiceClient();
  await getOrInitServerSettings(guildId);

  const { data, error } = await supabase
    .from('ticket_category_configs')
    .select('*')
    .eq('guild_id', guildId)
    .order('category_name', { ascending: true });

  if (error) {
    throw new Error(`Failed reading ticket_category_configs: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) =>
    CategoryConfigSchema.parse({
      id: row.id,
      guildId: row.guild_id,
      categoryId: row.category_id,
      categoryName: row.category_name,
      enabled: row.enabled,
      welcomeMessage: row.welcome_message ?? '',
      categoryInstructions: row.category_instructions ?? '',
      faqs: row.faqs ?? [],
      questions: row.questions ?? [],
      playerLookupEnabled: row.player_lookup_enabled ?? false,
      reportChannelOverrideId: row.report_channel_override_id ?? '',
      configVersion: Number(row.config_version ?? 1),
    })
  );
}

/**
 * Fetches high-level operational analytics for Overview WITHOUT exposing private conversation transcripts.
 */
export async function getOverviewDashboardData(guildId: string): Promise<OverviewDashboardData> {
  const supabase = createSupabaseServiceClient();
  const [serverSettings, categories, sessionsRes] = await Promise.all([
    getOrInitServerSettings(guildId),
    listCategoryConfigs(guildId),
    supabase
      .from('ticket_sessions')
      .select('id, channel_id, category_name, is_thread, status, config_version, opened_at')
      .eq('guild_id', guildId)
      .neq('status', 'closing')
      .order('opened_at', { ascending: false })
      .limit(50),
  ]);

  const activeSessions: ActiveSessionOverviewItem[] = (sessionsRes.data ?? []).map(
    (s: Record<string, unknown>) => ({
      id: String(s.id),
      channelId: String(s.channel_id),
      categoryName: String(s.category_name ?? 'Unknown'),
      isThread: Boolean(s.is_thread),
      status: String(s.status),
      configVersion: Number(s.config_version ?? 1),
      openedAt: String(s.opened_at),
    })
  );

  const heartbeatMs = serverSettings.botHeartbeatAt
    ? Date.parse(serverSettings.botHeartbeatAt)
    : NaN;
  const botOnline =
    Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs < 95_000;

  return {
    serverSettings,
    categories,
    activeSessions,
    botOnline,
  };
}

/**
 * Publishes updated server settings and increments config_version so new tickets
 * pick up the latest configuration while active tickets keep their frozen snapshot.
 */
export async function updateServerSettingsSection(
  guildId: string,
  patch: Partial<{
    guildName: string;
    botEnabled: boolean;
    defaultWelcomeMessage: string;
    ticketDetectionConfig: unknown;
    aiSettings: unknown;
    playerIntegrationConfig: unknown;
    reportSettings: unknown;
  }>
): Promise<ServerSettings> {
  const current = await getOrInitServerSettings(guildId);
  const nextVersion = current.configVersion + 1;

  const updateRow: Record<string, unknown> = {
    config_version: nextVersion,
    published_at: new Date().toISOString(),
  };

  if (patch.guildName !== undefined) updateRow.guild_name = patch.guildName.trim();
  if (patch.botEnabled !== undefined) updateRow.bot_enabled = Boolean(patch.botEnabled);
  if (patch.defaultWelcomeMessage !== undefined) {
    updateRow.default_welcome_message = patch.defaultWelcomeMessage;
  }
  if (patch.ticketDetectionConfig !== undefined) {
    updateRow.ticket_detection_config = TicketDetectionConfigSchema.parse(
      patch.ticketDetectionConfig
    );
  }
  if (patch.aiSettings !== undefined) {
    updateRow.ai_settings = AiSettingsSchema.parse(patch.aiSettings);
  }
  if (patch.playerIntegrationConfig !== undefined) {
    updateRow.player_integration_config = PlayerIntegrationConfigSchema.parse(
      patch.playerIntegrationConfig
    );
  }
  if (patch.reportSettings !== undefined) {
    updateRow.report_settings = ReportSettingsSchema.parse(patch.reportSettings);
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('server_settings')
    .update(updateRow)
    .eq('guild_id', guildId)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed updating server_settings: ${error?.message}`);
  }

  return mapServerRow(data as Record<string, unknown>);
}

/**
 * Publishes a category configuration (including questionnaires & FAQs) with an
 * immutable published_snapshot and incremented config_version.
 */
export async function upsertAndPublishCategoryConfig(
  guildId: string,
  rawInput: unknown
): Promise<CategoryConfig> {
  await getOrInitServerSettings(guildId);
  const parsed = CategoryConfigSchema.parse({
    ...(rawInput as Record<string, unknown>),
    guildId,
  });

  const supabase = createSupabaseServiceClient();
  const { data: existing } = await supabase
    .from('ticket_category_configs')
    .select('config_version')
    .eq('guild_id', guildId)
    .eq('category_id', parsed.categoryId)
    .maybeSingle();

  const nextVersion = existing
    ? Number((existing as Record<string, unknown>).config_version ?? 1) + 1
    : 1;

  const snapshotToPublish: CategoryConfig = {
    ...parsed,
    configVersion: nextVersion,
  };

  const { data, error } = await supabase
    .from('ticket_category_configs')
    .upsert(
      {
        guild_id: guildId,
        category_id: parsed.categoryId,
        category_name: parsed.categoryName,
        enabled: parsed.enabled,
        welcome_message: parsed.welcomeMessage ?? null,
        category_instructions: parsed.categoryInstructions,
        faqs: parsed.faqs,
        questions: parsed.questions,
        player_lookup_enabled: parsed.playerLookupEnabled,
        report_channel_override_id: parsed.reportChannelOverrideId || null,
        config_version: nextVersion,
        published_snapshot: snapshotToPublish,
        published_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id,category_id' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed publishing category config: ${error?.message}`);
  }

  const row = data as Record<string, unknown>;
  return CategoryConfigSchema.parse({
    ...snapshotToPublish,
    id: row.id,
  });
}

export async function deleteCategoryConfig(
  guildId: string,
  categoryId: string
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from('ticket_category_configs')
    .delete()
    .eq('guild_id', guildId)
    .eq('category_id', categoryId);

  if (error) {
    throw new Error(`Failed deleting category config: ${error.message}`);
  }
}

export async function listDashboardAdmins(guildId: string): Promise<DashboardAdminEntry[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('dashboard_admins')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed listing dashboard_admins: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    guildId: String(row.guild_id),
    discordUserId: (row.discord_user_id as string | null) ?? null,
    discordRoleId: (row.discord_role_id as string | null) ?? null,
    label: String(row.label ?? ''),
    permissionLevel: (row.permission_level as DashboardAdminEntry['permissionLevel']) ?? 'moderator',
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  }));
}

export async function addDashboardAdmin(params: {
  guildId: string;
  discordUserId?: string;
  discordRoleId?: string;
  label: string;
  permissionLevel: 'owner' | 'admin' | 'moderator';
}): Promise<DashboardAdminEntry> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('dashboard_admins')
    .insert({
      guild_id: params.guildId,
      discord_user_id: params.discordUserId?.trim() || null,
      discord_role_id: params.discordRoleId?.trim() || null,
      label: params.label.trim(),
      permission_level: params.permissionLevel,
      active: true,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed adding dashboard admin: ${error?.message}`);
  }

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    guildId: String(row.guild_id),
    discordUserId: (row.discord_user_id as string | null) ?? null,
    discordRoleId: (row.discord_role_id as string | null) ?? null,
    label: String(row.label ?? ''),
    permissionLevel: row.permission_level as DashboardAdminEntry['permissionLevel'],
    active: Boolean(row.active),
    createdAt: String(row.created_at),
  };
}

export async function removeDashboardAdmin(guildId: string, adminId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from('dashboard_admins')
    .delete()
    .eq('guild_id', guildId)
    .eq('id', adminId);

  if (error) {
    throw new Error(`Failed removing dashboard admin: ${error.message}`);
  }
}

