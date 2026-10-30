import {
  SessionConfigSnapshotSchema,
  type CategoryConfig,
  type ServerSettings,
  type SessionConfigSnapshot,
} from '@hrbot/shared';
import type { BotDatabaseRepository } from '../services/databaseRepository.js';

export interface GuildRuntimeConfiguration {
  serverSettings: ServerSettings;
  categoriesById: Map<string, CategoryConfig>;
}

export class ConfigService {
  private cached: GuildRuntimeConfiguration | null = null;
  private cacheExpiresAt = 0;

  constructor(
    private readonly repo: BotDatabaseRepository,
    private readonly guildId: string,
    private readonly defaultGroqModel: string,
    private readonly cacheTtlMs = 5000
  ) {}

  invalidateCache(): void {
    this.cached = null;
    this.cacheExpiresAt = 0;
  }

  async getGuildConfiguration(forceRefresh = false): Promise<GuildRuntimeConfiguration> {
    const now = Date.now();
    if (!forceRefresh && this.cached && now < this.cacheExpiresAt) {
      return this.cached;
    }

    const [serverSettings, categories] = await Promise.all([
      this.repo.ensureServerSettings(this.guildId, this.defaultGroqModel),
      this.repo.getCategoryConfigs(this.guildId),
    ]);

    const categoriesById = new Map<string, CategoryConfig>();
    for (const cat of categories) {
      categoriesById.set(cat.categoryId, cat);
    }

    this.cached = { serverSettings, categoriesById };
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return this.cached;
  }

  /**
   * Builds an immutable configuration snapshot for a newly detected ticket session.
   * Ensures subsequent dashboard edits apply only to future tickets while active
   * tickets keep consistent questionnaire and reporting rules.
   */
  buildSessionConfigSnapshot(
    serverSettings: ServerSettings,
    category: CategoryConfig
  ): SessionConfigSnapshot {
    const baseWelcome = (
      category.welcomeMessage && category.welcomeMessage.trim().length > 0
        ? category.welcomeMessage
        : serverSettings.defaultWelcomeMessage
    ).trim();

    const firstQuestion = category.questions[0];
    const welcomeIncludesPrompt = baseWelcome.includes('?');
    const welcomeMessage =
      firstQuestion && !welcomeIncludesPrompt
        ? `${baseWelcome}\n\n${firstQuestion.question}`
        : baseWelcome;

    const effectiveModel =
      serverSettings.aiSettings.model.trim() || this.defaultGroqModel;

    return SessionConfigSnapshotSchema.parse({
      serverConfigVersion: serverSettings.configVersion,
      categoryConfigVersion: category.configVersion,
      guildName: serverSettings.guildName,
      welcomeMessage,
      mentionUserOnWelcome: serverSettings.ticketDetectionConfig.mentionUserOnWelcome,
      category,
      aiSettings: {
        ...serverSettings.aiSettings,
        model: effectiveModel,
      },
      playerIntegrationConfig: serverSettings.playerIntegrationConfig,
      reportSettings: serverSettings.reportSettings,
    });
  }
}

