'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Code2,
  ExternalLink,
  FlaskConical,
  Play,
  Save,
  Terminal,
} from 'lucide-react';
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
  { id: 'lookup_player', label: 'Player Identifier Lookup (lookup_player)' },
  { id: 'lookup_clan', label: 'Clan / Guild Lookup (lookup_clan)' },
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
      throw new Error(parsed.error ?? 'Invalid 1-line command syntax');
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
          'Enter a Dedicated Bot Channel ID, or switch execution mode to "Inside the Ticket Channel".'
        );
      }

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIntegrationConfig: nextConfig }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed saving external bot settings');

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
      return 'Published external bot integration rules.';
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

      {/* Optional Feature Notice */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 p-4 border border-border/60 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground border border-border/50">
            <AlertCircle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">
              Optional Feature: External Utility Bot Queries
            </p>
            <p className="text-[11px] text-muted-foreground">
              Community onboarding collects member information directly without requiring an external bot. Enable this only if your server uses an external bot for automated lookups.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={config.enabled ? 'success' : 'secondary'} className="text-xs">
            {config.enabled ? 'Integration Active' : 'Integration Disabled'}
          </Badge>
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Primary Command Setup Card */}
          <Card className="glass-card border border-border/60">
            <CardHeader className="pb-4 border-b border-border/40">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Terminal className="h-4 w-4 text-primary" />
                    External Bot Command Configuration
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Define the bot command syntax used in Discord (e.g. <code>.p {'{tag}'}</code> or <code>!info {'{tag}'}</code>).
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-4">
              {/* Step 1: One-Line Command */}
              <div className="space-y-2">
                <Label htmlFor="quickDotLine" className="text-xs font-semibold text-muted-foreground">
                  Command Template (1 Line)
                </Label>
                <Input
                  id="quickDotLine"
                  className="font-mono text-xs bg-muted/30 border-border/60"
                  placeholder=".p {tag}   (or: !profile {tag}, /search {tag})"
                  value={oneLineInput}
                  onChange={(e) => handleOneLineChange(e.target.value)}
                />
                {liveParsed.valid ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                      Live Command Preview (Prefix: <code>{liveParsed.commandPrefix}</code>)
                    </p>
                    {Object.entries(liveParsed.previews).map(([act, previewCmd]) => (
                      <p key={act} className="text-muted-foreground text-[11px]">
                        • On identifier detection ({act}): Sends{' '}
                        <code className="rounded bg-background px-1.5 py-0.5 font-mono text-foreground font-semibold">
                          {previewCmd}
                        </code>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-destructive">{liveParsed.error}</p>
                )}
              </div>

              {/* Step 2: External Bot User ID & Execution Channel */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="extBotId" className="text-xs text-muted-foreground">
                    External Bot Discord User ID
                  </Label>
                  <Input
                    id="extBotId"
                    className="bg-muted/30 border-border/60 font-mono text-xs"
                    placeholder="Right click external bot -> Copy User ID"
                    value={config.externalBotUserId}
                    onChange={(e) =>
                      setConfig({ ...config, externalBotUserId: e.target.value })
                    }
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Replies from this bot ID are parsed for structured details.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="execMode" className="text-xs text-muted-foreground">
                    Execution Destination
                  </Label>
                  <select
                    id="execMode"
                    className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
                    value={config.executionChannelMode}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        executionChannelMode: e.target.value as ExecutionChannelMode,
                      })
                    }
                  >
                    <option value="ticket_channel" className="bg-background text-foreground">
                      Inside Ticket Channel (Visible to member)
                    </option>
                    <option value="dedicated_channel" className="bg-background text-foreground">
                      Dedicated Bot Command Channel (Staff Only)
                    </option>
                  </select>
                </div>
              </div>

              {config.executionChannelMode === 'dedicated_channel' && (
                <div className="space-y-1.5">
                  <Label htmlFor="execChannelId" className="text-xs text-muted-foreground">
                    Dedicated Bot Channel ID
                  </Label>
                  <Input
                    id="execChannelId"
                    className="bg-muted/30 border-border/60 font-mono text-xs"
                    placeholder="Snowflake ID of private #bot-commands channel"
                    value={config.executionChannelId}
                    onChange={(e) =>
                      setConfig({ ...config, executionChannelId: e.target.value })
                    }
                  />
                </div>
              )}

              {/* Step 3: Category Enablement */}
              {categories.length > 0 && (
                <div className="space-y-2 rounded-xl border border-border/50 bg-muted/15 p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Enable in Ticket Categories
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Choose which ticket categories should trigger external bot queries:
                  </p>
                  <div className="grid gap-2 pt-1 sm:grid-cols-2">
                    {categories.map((cat) => (
                      <div
                        key={cat.categoryId}
                        className="flex items-center justify-between rounded-lg border border-border/40 bg-background/50 px-3 py-2"
                      >
                        <div>
                          <p className="text-xs font-medium text-foreground">{cat.categoryName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {cat.enabled ? 'Category Active' : 'Category Muted'}
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

              {/* Collapsible Advanced Section */}
              <div className="border-t border-border/40 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAdvanced ? (
                    <ChevronUp className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-primary" />
                  )}
                  {showAdvanced
                    ? 'Hide Advanced Parser & Timeout Settings'
                    : 'Show Advanced Parser & Timeout Settings'}
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-4 rounded-xl border border-border/50 bg-muted/10 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Response Timeout (ms)</Label>
                        <Input
                          type="number"
                          min={2000}
                          max={60000}
                          className="bg-muted/30 border-border/60 font-mono text-xs"
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
                        <Label className="text-xs text-muted-foreground">Max Lookups per Ticket</Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          className="bg-muted/30 border-border/60 font-mono text-xs"
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

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Parser Strategy</Label>
                      <select
                        className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
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
                        <option value="embed_and_regex" className="bg-background text-foreground">
                          Discord Embed Fields + Regex Fallback
                        </option>
                        <option value="embed_only" className="bg-background text-foreground">Discord Embed Fields Only</option>
                        <option value="regex_only" className="bg-background text-foreground">Plain-Text Regex Only</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Optional Webhook URL</Label>
                      <Input
                        className="bg-muted/30 border-border/60 font-mono text-xs"
                        placeholder="https://... (only if external bot ignores bot messages)"
                        value={config.externalApiWebhookUrl ?? ''}
                        onChange={(e) =>
                          setConfig({ ...config, externalApiWebhookUrl: e.target.value })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={saveConfig}
                  className="shadow-sm shadow-primary/20 hover:shadow-primary/40 text-xs"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Publish Bot Integration Setup
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dry-Run Sandbox Test Card */}
        <Card className="glass-card border border-border/60 h-fit">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-primary" />
              Command Sandbox Simulator
            </CardTitle>
            <CardDescription className="text-xs">
              Simulate template rendering and field extraction before enabling live.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Action Type</Label>
              <select
                className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
                value={testAction}
                onChange={(e) => setTestAction(e.target.value as LookupAction)}
              >
                {ALL_LOOKUP_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id} className="bg-background text-foreground">
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sample Target Input</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                value={testTarget}
                onChange={(e) => setTestTarget(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sample External Bot Reply Text</Label>
              <Textarea
                rows={3}
                className="bg-muted/30 border-border/60 font-mono text-xs"
                value={sampleBotReply}
                onChange={(e) => setSampleBotReply(e.target.value)}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs border-border/60 hover:bg-primary/10 hover:text-primary"
              onClick={runDryRunTest}
            >
              <Play className="mr-1.5 h-3.5 w-3.5 text-primary" />
              Run Simulator Test
            </Button>

            {testResult && (
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs space-y-2">
                {testResult.valid ? (
                  <>
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono text-[11px]">
                      ✓ Valid Approved Command
                    </p>
                    <p className="text-[11px] font-mono">
                      Rendered: <code className="bg-background px-1 py-0.5 rounded text-foreground font-bold">{testResult.renderedCommand}</code>
                    </p>
                    <div>
                      <p className="text-[11px] text-muted-foreground font-medium">Extracted Data:</p>
                      <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-[10px] text-foreground border border-border/40">
                        {JSON.stringify(testResult.extractedFields ?? {}, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p className="text-destructive font-medium text-xs">⚠ {testResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
