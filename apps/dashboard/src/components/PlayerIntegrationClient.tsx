'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, FlaskConical, Save, Terminal } from 'lucide-react';
import {
  deriveQuickCommandLineFromConfig,
  parseQuickDotCommands,
  type CategoryConfig,
  type ExecutionChannelMode,
  type LookupAction,
  type PlayerIntegrationConfig,
} from '@hrbot/shared';
import { useSaveStatus } from '@/hooks/useSaveStatus';
import { StatusBanner } from '@/components/layout/StatusBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const ALL_LOOKUP_ACTIONS: Array<{ id: LookupAction; label: string }> = [
  { id: 'lookup_player', label: 'Player Tag Lookup (lookup_player)' },
  { id: 'lookup_clan', label: 'Clan Lookup (lookup_clan)' },
  { id: 'lookup_profile', label: 'Discord Profile Lookup (lookup_profile)' },
];

export function PlayerIntegrationClient({
  initialConfig,
  initialCategories = [],
}: {
  initialConfig: PlayerIntegrationConfig;
  initialCategories?: CategoryConfig[];
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();
  const [config, setConfig] = useState<PlayerIntegrationConfig>(initialConfig);
  const [oneLineInput, setOneLineInput] = useState<string>(() =>
    deriveQuickCommandLineFromConfig(initialConfig)
  );
  const [categories, setCategories] = useState<CategoryConfig[]>(initialCategories);
  const [dirtyCategoryIds, setDirtyCategoryIds] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Test sandbox state
  const [testAction, setTestAction] = useState<LookupAction>('lookup_player');
  const [testTarget, setTestTarget] = useState('#9RQU2YQPL');
  const [sampleBotReply, setSampleBotReply] = useState(
    'Player Tag: #9RQU2YQPL\nTown Hall: 16\nTrophies: 5,480'
  );
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    renderedCommand?: string;
    extractedFields?: Record<string, string>;
    error?: string;
  } | null>(null);

  const liveParsed = parseQuickDotCommands(oneLineInput, config.commandPrefix || '.');

  function handleOneLineChange(value: string) {
    setOneLineInput(value);
    const parsed = parseQuickDotCommands(value, config.commandPrefix || '.');
    if (parsed.valid) {
      setConfig((prev) => ({
        ...prev,
        quickCommandLine: value,
        commandPrefix: parsed.commandPrefix,
        supportedActions: parsed.supportedActions,
        commandTemplates: parsed.commandTemplates,
      }));
    } else {
      setConfig((prev) => ({
        ...prev,
        quickCommandLine: value,
      }));
    }
  }

  function toggleCategoryLookup(categoryId: string, enabled: boolean) {
    setCategories((prev) =>
      prev.map((c) =>
        c.categoryId === categoryId ? { ...c, playerLookupEnabled: enabled } : c
      )
    );
    setDirtyCategoryIds((prev) => {
      const next = new Set(prev);
      next.add(categoryId);
      return next;
    });
  }

  async function saveConfig() {
    const parsed = parseQuickDotCommands(oneLineInput, config.commandPrefix || '.');
    if (config.enabled && !parsed.valid) {
      throw new Error(parsed.error ?? 'Invalid 1-line DOT command');
    }

    const nextConfig: PlayerIntegrationConfig = parsed.valid
      ? {
          ...config,
          quickCommandLine: oneLineInput.trim(),
          commandPrefix: parsed.commandPrefix,
          supportedActions: parsed.supportedActions,
          commandTemplates: parsed.commandTemplates,
        }
      : config;

    await runSave(async () => {
      if (
        nextConfig.enabled &&
        nextConfig.executionChannelMode === 'dedicated_channel' &&
        !nextConfig.executionChannelId.trim() &&
        !nextConfig.externalApiWebhookUrl?.trim()
      ) {
        throw new Error(
          'Enter a Dedicated Bot Channel ID, or switch "Where to Run Command" to "Inside the Ticket Channel".'
        );
      }

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIntegrationConfig: nextConfig }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed saving DOT command settings');

      // Also save any toggled category lookup switches in one go
      for (const catId of dirtyCategoryIds) {
        const cat = categories.find((c) => c.categoryId === catId);
        if (cat) {
          const catRes = await fetch('/api/categories', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cat),
          });
          if (!catRes.ok) {
            const catErr = (await catRes.json()) as { error?: string };
            throw new Error(catErr.error ?? `Failed updating category ${cat.categoryName}`);
          }
        }
      }

      setConfig(nextConfig);
      setDirtyCategoryIds(new Set());
      router.refresh();
      return 'Saved & published 1-Line DOT Command configuration!';
    });
  }

  async function runDryRunTest() {
    const parsed = parseQuickDotCommands(oneLineInput, config.commandPrefix || '.');
    const effectiveConfig: PlayerIntegrationConfig = parsed.valid
      ? {
          ...config,
          quickCommandLine: oneLineInput.trim(),
          commandPrefix: parsed.commandPrefix,
          supportedActions: parsed.supportedActions,
          commandTemplates: parsed.commandTemplates,
        }
      : config;

    const res = await fetch('/api/player-integration/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: effectiveConfig,
        action: testAction,
        sampleTarget: testTarget,
        sampleResponseText: sampleBotReply,
      }),
    });
    const json = (await res.json()) as {
      valid: boolean;
      renderedCommand?: string;
      extractedFields?: Record<string, string>;
      error?: string;
    };
    setTestResult(json);
  }

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Primary Simple 1-Line Setup Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-primary" />
                    1-Line DOT Command Setup
                  </CardTitle>
                  <CardDescription>
                    Just write the exact DOT command you use in Discord (for example{' '}
                    <code>.p {'{tag}'}</code> or <code>.player {'{tag}'}</code>). Prefix and
                    templates are configured automatically!
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={config.enabled ? 'success' : 'secondary'}>
                    {config.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <Switch
                    checked={config.enabled}
                    onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Step 1: One-Line Command */}
              <div className="space-y-2">
                <Label htmlFor="quickDotLine" className="text-sm font-semibold">
                  1. Your DOT Command (1 Line)
                </Label>
                <Input
                  id="quickDotLine"
                  className="font-mono text-sm"
                  placeholder=".p {tag}   (or: .player {tag}, .clan {clan})"
                  value={oneLineInput}
                  onChange={(e) => handleOneLineChange(e.target.value)}
                />
                {liveParsed.valid ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Live Command Preview (Prefix: <code>{liveParsed.commandPrefix}</code>)
                    </p>
                    {Object.entries(liveParsed.previews).map(([act, previewCmd]) => (
                      <p key={act} className="text-muted-foreground">
                        • When opener shares tag/name ({act}): Bot sends{' '}
                        <code className="rounded bg-background px-1.5 py-0.5 font-semibold text-foreground">
                          {previewCmd}
                        </code>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-destructive">{liveParsed.error}</p>
                )}
              </div>

              {/* Step 2: External Stats Bot ID & Where to Run */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="extBotId" className="text-sm font-semibold">
                    2. Your Stats Bot&apos;s Discord User ID
                  </Label>
                  <Input
                    id="extBotId"
                    placeholder="Right-click ClashPerk / ClashKing -> Copy User ID"
                    value={config.externalBotUserId}
                    onChange={(e) =>
                      setConfig({ ...config, externalBotUserId: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Our bot reads embeds only from this bot ID.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="execMode" className="text-sm font-semibold">
                    3. Where Should the Command Be Sent?
                  </Label>
                  <select
                    id="execMode"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={config.executionChannelMode}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        executionChannelMode: e.target.value as ExecutionChannelMode,
                      })
                    }
                  >
                    <option value="ticket_channel">
                      Inside the Ticket Channel (No extra channel ID needed)
                    </option>
                    <option value="dedicated_channel">
                      In a Dedicated Staff / Bot Channel (Hidden from player)
                    </option>
                  </select>
                </div>
              </div>

              {config.executionChannelMode === 'dedicated_channel' && (
                <div className="space-y-1.5">
                  <Label htmlFor="execChannelId">
                    Dedicated Bot Command Channel ID
                  </Label>
                  <Input
                    id="execChannelId"
                    placeholder="Paste your staff #bot-commands Channel ID"
                    value={config.executionChannelId}
                    onChange={(e) =>
                      setConfig({ ...config, executionChannelId: e.target.value })
                    }
                  />
                </div>
              )}

              {/* Step 4: Quick-Enable Categories */}
              {categories.length > 0 && (
                <div className="space-y-2 rounded-lg border p-3.5">
                  <p className="text-sm font-semibold">
                    Enable DOT Lookups in Ticket Categories
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Turn on which ticket categories should automatically trigger your DOT command
                    when a player drops their tag:
                  </p>
                  <div className="grid gap-2 pt-1 sm:grid-cols-2">
                    {categories.map((cat) => (
                      <div
                        key={cat.categoryId}
                        className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2"
                      >
                        <div>
                          <p className="text-xs font-medium">{cat.categoryName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {cat.enabled ? 'AI Enabled' : 'Category Disabled'}
                          </p>
                        </div>
                        <Switch
                          checked={cat.playerLookupEnabled}
                          onCheckedChange={(checked) =>
                            toggleCategoryLookup(cat.categoryId, checked)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Note about bots ignoring other bots */}
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <strong>Tip:</strong> Some Discord bots ignore messages sent by other bots by
                default. Make sure your stats bot allows commands in that channel, or configure an
                optional API/Webhook URL under Advanced Settings below.
              </div>

              {/* Collapsible Advanced Section */}
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {showAdvanced ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  {showAdvanced
                    ? 'Hide Advanced Parser & Timeout Settings'
                    : 'Show Advanced Parser & Timeout Settings'}
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4 rounded-lg border bg-muted/15 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Response Timeout (ms)</Label>
                        <Input
                          type="number"
                          min={2000}
                          max={60000}
                          value={config.timeoutMs}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              timeoutMs: Number(e.target.value) || 12000,
                            })
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Max Lookups per Ticket</Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={config.maxLookupsPerTicket}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              maxLookupsPerTicket: Number(e.target.value) || 3,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Parser Strategy</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={config.parserConfig.strategy}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              parserConfig: {
                                ...config.parserConfig,
                                strategy: e.target
                                  .value as PlayerIntegrationConfig['parserConfig']['strategy'],
                              },
                            })
                          }
                        >
                          <option value="embed_and_regex">
                            Discord Embed Fields + Regex Fallback
                          </option>
                          <option value="embed_only">Discord Embed Fields Only</option>
                          <option value="regex_only">Plain-Text Regex Only</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Town Hall Regex Pattern</Label>
                        <Input
                          value={config.parserConfig.regexPatterns.townHallLevel ?? ''}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              parserConfig: {
                                ...config.parserConfig,
                                regexPatterns: {
                                  ...config.parserConfig.regexPatterns,
                                  townHallLevel: e.target.value,
                                },
                              },
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Optional Approved External API / Webhook URL</Label>
                      <Input
                        placeholder="https://... (only needed if your stats bot ignores bot accounts)"
                        value={config.externalApiWebhookUrl ?? ''}
                        onChange={(e) =>
                          setConfig({ ...config, externalApiWebhookUrl: e.target.value })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              <Button type="button" onClick={saveConfig}>
                <Save className="h-4 w-4" />
                Save & Publish DOT Command Setup
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Dry-Run Test Panel */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary" />
              Test Your 1-Line Command
            </CardTitle>
            <CardDescription>
              Preview the exact Discord command and field extraction before testing live.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Lookup Action</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={testAction}
                onChange={(e) => setTestAction(e.target.value as LookupAction)}
              >
                {ALL_LOOKUP_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Sample Player Tag / Target</Label>
              <Input value={testTarget} onChange={(e) => setTestTarget(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Sample Stats Bot Reply Text</Label>
              <Textarea
                rows={4}
                value={sampleBotReply}
                onChange={(e) => setSampleBotReply(e.target.value)}
              />
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={runDryRunTest}>
              Run Command & Parser Test
            </Button>

            {testResult && (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-2">
                {testResult.valid ? (
                  <>
                    <p className="font-semibold text-emerald-700">Valid Approved Command</p>
                    <p>
                      Rendered: <code>{testResult.renderedCommand}</code>
                    </p>
                    <div>
                      <p className="font-medium">Parsed Fields:</p>
                      <pre className="mt-1 overflow-x-auto rounded bg-background p-2">
                        {JSON.stringify(testResult.extractedFields ?? {}, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-destructive font-medium">{testResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
