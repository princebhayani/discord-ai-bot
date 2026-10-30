import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  LookupActionSchema,
  PlayerIntegrationConfigSchema,
} from '@hrbot/shared';
import { verifyDashboardModerator } from '@/lib/auth/guard';

const TestIntegrationInputSchema = z.object({
  config: PlayerIntegrationConfigSchema,
  action: LookupActionSchema,
  sampleTarget: z.string().min(1).max(64),
  sampleResponseText: z.string().max(3000).default(''),
});

/**
 * Dry-run validator & parser simulator for Player Integration settings so moderators can
 * safely test command templates and regex/embed parsing before enabling live commands.
 */
export async function POST(req: Request) {
  const auth = await verifyDashboardModerator();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: 403 });
  }

  try {
    const { config, action, sampleTarget, sampleResponseText } =
      TestIntegrationInputSchema.parse(await req.json());

    const trimmed = sampleTarget.trim();
    if (
      trimmed.includes('\n') ||
      trimmed.startsWith('.') ||
      trimmed.startsWith('/') ||
      trimmed.toLowerCase().includes('@everyone')
    ) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Sample target rejected by injection guardrail (disallowed prefix, newline, or mention).',
        },
        { status: 200 }
      );
    }

    const normalizedTarget =
      action === 'lookup_player'
        ? (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toUpperCase().replace(/O/g, '0')
        : trimmed;

    if (!config.supportedActions.includes(action)) {
      return NextResponse.json({
        valid: false,
        error: `Action "${action}" is currently unchecked in Supported Actions.`,
      });
    }

    const template = config.commandTemplates[action];
    if (!template) {
      return NextResponse.json({
        valid: false,
        error: `No command template configured for action "${action}".`,
      });
    }
    const renderedCommand = template
      .replace(/\{prefix\}/g, config.commandPrefix)
      .replace(/\{target\}/g, normalizedTarget)
      .replace(/\{player_tag\}/g, normalizedTarget)
      .replace(/\{clan_name\}/g, normalizedTarget)
      .trim();

    const extractedFields: Record<string, string> = {};
    for (const [key, pattern] of Object.entries(config.parserConfig.regexPatterns)) {
      try {
        const match = new RegExp(pattern, 'i').exec(sampleResponseText);
        if (match) {
          extractedFields[key] = (match[1] ?? match[0]).trim();
        }
      } catch {
        extractedFields[key] = '[INVALID_REGEX]';
      }
    }

    return NextResponse.json({
      valid: true,
      renderedCommand,
      normalizedTarget,
      extractedFields,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Test request validation failed' },
      { status: 400 }
    );
  }
}
