import { z } from 'zod';

const BotEnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{15,22}$/, 'DISCORD_CLIENT_ID must be a Discord Snowflake'),
  DISCORD_GUILD_ID: z.string().regex(/^\d{15,22}$/, 'DISCORD_GUILD_ID must be a Discord Snowflake'),
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  TICKET_WEBHOOK_SECRET: z.string().optional().default(''),
  WEBHOOK_PORT: z.coerce.number().int().nonnegative().optional().default(0),
  CLOSURE_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000),
  BOT_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(10000).default(30000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type BotEnv = z.infer<typeof BotEnvSchema>;

export function loadBotEnv(rawEnv: NodeJS.ProcessEnv = process.env): BotEnv {
  return BotEnvSchema.parse({
    ...rawEnv,
    SUPABASE_URL: rawEnv.SUPABASE_URL || rawEnv.NEXT_PUBLIC_SUPABASE_URL,
  });
}

