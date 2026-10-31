import { z } from 'zod';

const BotEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{15,22}$/, 'DISCORD_CLIENT_ID must be a Discord Snowflake'),
  DISCORD_GUILD_ID: z.string().regex(/^\d{15,22}$/, 'DISCORD_GUILD_ID must be a Discord Snowflake'),
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required'),
  GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
  SUPABASE_URL: z
    .string()
    .url('SUPABASE_URL must be a valid https://<project-id>.supabase.co URL')
    .refine(
      (u) =>
        (u.startsWith('https://') || u.startsWith('http://')) &&
        !u.includes('sb_secret_') &&
        !u.includes('sb_publishable_'),
      'SUPABASE_URL must be your https://<project-id>.supabase.co Project URL (not a postgres:// URI or sb_secret_ key)'
    ),
  SUPABASE_SECRET_KEY: z.string().min(
    1,
    'SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required'
  ),
  TICKET_WEBHOOK_SECRET: z.string().optional().default(''),
  CLOSURE_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(10000).default(60000),
  BOT_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(10000).default(30000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type BotEnv = z.infer<typeof BotEnvSchema> & {
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export function loadBotEnv(rawEnv: NodeJS.ProcessEnv = process.env): BotEnv {
  const supabaseSecret =
    rawEnv.SUPABASE_SECRET_KEY?.trim() || rawEnv.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const portRaw = rawEnv.PORT !== undefined && rawEnv.PORT.trim() !== '' ? rawEnv.PORT : '3000';
  const rawSupabaseUrl = (rawEnv.SUPABASE_URL || rawEnv.NEXT_PUBLIC_SUPABASE_URL || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/+$/, '');

  const parsed = BotEnvSchema.parse({
    ...rawEnv,
    PORT: portRaw,
    SUPABASE_URL: rawSupabaseUrl,
    SUPABASE_SECRET_KEY: supabaseSecret,
  });

  return {
    ...parsed,
    SUPABASE_SERVICE_ROLE_KEY: parsed.SUPABASE_SECRET_KEY,
  };
}
