'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Save } from 'lucide-react';
import type { LookupAction, PlayerIntegrationConfig } from '@hrbot/shared';
import { useSaveStatus } from '@/hooks/useSaveStatus';
import { StatusBanner } from '@/components/layout/StatusBanner';
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
}: {
  initialConfig: PlayerIntegrationConfig;
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();
  const [config, setConfig] = useState<PlayerIntegrationConfig>(initialConfig);

  // Test sandbox state
  const [testAction, setTestAction] = useState<LookupAction>('lookup_player');
  const [testTarget, setTestTarget] = useState('#PYL928');
  const [sampleBotReply, setSampleBotReply] = useState(
    'Player Tag: #PYL928\nTown Hall: 16\nTrophies: 5,480'
  );
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    renderedCommand?: string;
    extractedFields?: Record<string, string>;
    error?: string;
  } | null>(null);

  function toggleSupportedAction(action: LookupAction) {
    const exists = config.supportedActions.includes(action);
    const next = exists
      ? config.supportedActions.filter((a) => a !== action)
      : [...config.supportedActions, action];
    setConfig({ ...config, supportedActions: next });
  }

  async function saveConfig() {
    await runSave(async () => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerIntegrationConfig: config }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed saving player integration settings');
      router.refresh();
      return 'Published Player-Data Bot Integration configuration.';
    });
  }

  async function runDryRunTest() {
    const res = await fetch('/api/player-integration/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config,
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
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Existing Player-Data Bot Connection</CardTitle>
                  <CardDescription>
                    Accepts responses exclusively from the configured external bot ID and prevents
                    arbitrary dot-command execution.
                  </CardDescription>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) => setConfig({ ...config, enabled: checked })}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Existing Data Bot Discord User ID</Label>
                  <Input
                    placeholder="e.g. 641717761234567890"
                    value={config.externalBotUserId}
                    onChange={(e) =>
                      setConfig({ ...config, externalBotUserId: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Pre-Existing Command Execution Channel ID</Label>
                  <Input
                    placeholder="Dedicated staff/bot command channel ID"
                    value={config.executionChannelId}
                    onChange={(e) =>
                      setConfig({ ...config, executionChannelId: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Command Prefix</Label>
                  <Input
                    value={config.commandPrefix}
                    onChange={(e) => setConfig({ ...config, commandPrefix: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Response Timeout (ms)</Label>
                  <Input
                    type="number"
                    min={2000}
                    max={60000}
                    value={config.timeoutMs}
                    onChange={(e) =>
                      setConfig({ ...config, timeoutMs: Number(e.target.value) || 12000 })
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

              <div className="space-y-1.5">
                <Label>Optional Approved External API / Webhook URL</Label>
                <Input
                  placeholder="https://... (use if the external bot ignores bot-sent Discord messages)"
                  value={config.externalApiWebhookUrl ?? ''}
                  onChange={(e) =>
                    setConfig({ ...config, externalApiWebhookUrl: e.target.value })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approved Command Templates & Response Parser</CardTitle>
              <CardDescription>
                Use placeholders <code>{'{prefix}'}</code> and <code>{'{target}'}</code>. Discover
                your existing bot&apos;s real supported commands before enabling.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {ALL_LOOKUP_ACTIONS.map((act) => {
                  const checked = config.supportedActions.includes(act.id);
                  return (
                    <div key={act.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{act.label}</Label>
                        <Switch
                          checked={checked}
                          onCheckedChange={() => toggleSupportedAction(act.id)}
                        />
                      </div>
                      <Input
                        value={config.commandTemplates[act.id] ?? ''}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            commandTemplates: {
                              ...config.commandTemplates,
                              [act.id]: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                  );
                })}
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
                          strategy: e.target.value as PlayerIntegrationConfig['parserConfig']['strategy'],
                        },
                      })
                    }
                  >
                    <option value="embed_and_regex">Discord Embed Fields + Regex Fallback</option>
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

              <Button type="button" onClick={saveConfig}>
                <Save className="h-4 w-4" />
                Publish Player Integration Config
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Dry-Run Test Panel */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-primary" />
              Test Integration & Parser
            </CardTitle>
            <CardDescription>
              Dry-run command rendering, target sanitization, and regex field extraction.
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
              <Label>Sample Target Input</Label>
              <Input value={testTarget} onChange={(e) => setTestTarget(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Sample External Bot Reply Text</Label>
              <Textarea
                rows={4}
                value={sampleBotReply}
                onChange={(e) => setSampleBotReply(e.target.value)}
              />
            </div>

            <Button type="button" variant="outline" className="w-full" onClick={runDryRunTest}>
              Run Template & Parser Test
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

