'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bot,
  Cpu,
  Eye,
  Lock,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  getGroqModelCapabilities,
  KNOWN_GROQ_MODELS,
  type AiSettings,
  type GroqModelCapability,
  type ThreadClosurePolicy,
  type TicketDetectionConfig,
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

export function AiSettingsClient({
  initialAiSettings,
  initialDetectionConfig,
}: {
  initialAiSettings: AiSettings;
  initialDetectionConfig: TicketDetectionConfig;
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();

  const [aiSettings, setAiSettings] = useState<AiSettings>(initialAiSettings);
  const [detection, setDetection] =
    useState<TicketDetectionConfig>(initialDetectionConfig);
  const [availableModels, setAvailableModels] = useState<GroqModelCapability[]>([
    ...KNOWN_GROQ_MODELS,
  ]);

  const [providerBotIdsText, setProviderBotIdsText] = useState(
    initialDetectionConfig.providerBotIds.join(', ')
  );
  const [prefixesText, setPrefixesText] = useState(
    initialDetectionConfig.channelNamePrefixes.join(', ')
  );
  const [topicMarkersText, setTopicMarkersText] = useState(
    initialDetectionConfig.topicMarkers.join(', ')
  );

  useEffect(() => {
    void fetch('/api/groq/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { models?: GroqModelCapability[] } | null) => {
        if (data?.models && data.models.length > 0) {
          setAvailableModels(data.models);
        }
      })
      .catch(() => undefined);
  }, []);

  const selectedCapabilities = getGroqModelCapabilities(aiSettings.model);

  async function saveAllAiAndDetection() {
    const nextDetection: TicketDetectionConfig = {
      ...detection,
      providerBotIds: providerBotIdsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      channelNamePrefixes: prefixesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      topicMarkers: topicMarkersText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    await runSave(async () => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiSettings,
          ticketDetectionConfig: nextDetection,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed saving AI settings');
      setDetection(nextDetection);
      router.refresh();
      return 'Published Groq AI & Ticket Provider Detection settings.';
    });
  }

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      {/* Persona Callout Banner */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 p-4 border border-primary/25 bg-primary/5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Configure Community Knowledge, Persona Name &amp; Vibe
            </p>
            <p className="text-xs text-muted-foreground">
              Add your server rules, joining process, and live interactive Discord preview in the Persona Studio.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="border-border/60 bg-background/50 hover:bg-primary/10 hover:text-primary">
          <Link href="/server-info">Open Persona Studio</Link>
        </Button>
      </div>

      {/* Groq Conversational Engine */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Cpu className="h-4 w-4 text-primary" />
                Groq Conversational Engine Settings
              </CardTitle>
              <CardDescription className="text-xs">
                Inference runs exclusively via server-side LPU architecture (`GROQ_API_KEY`). Secrets are never leaked to client browsers.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Badge variant="outline" className="font-mono text-xs border-emerald-500/30 text-emerald-400">
                Ultra-Low Latency Active
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Groq Model Preset</Label>
              <select
                className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
                value={
                  availableModels.some((m) => m.id === aiSettings.model)
                    ? aiSettings.model
                    : '__custom__'
                }
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    setAiSettings({ ...aiSettings, model: e.target.value });
                  }
                }}
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id} className="bg-background text-foreground">
                    {m.displayName} ({m.id})
                  </option>
                ))}
                <option value="__custom__" className="bg-background text-foreground">Custom Groq Model ID…</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Active Model Identifier</Label>
              <Input
                className="font-mono text-xs bg-muted/30 border-border/60"
                placeholder="e.g. openai/gpt-oss-120b"
                value={aiSettings.model}
                onChange={(e) => setAiSettings({ ...aiSettings, model: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/50 p-3 text-xs">
            <Badge
              variant={selectedCapabilities.supportsStrictJsonSchema ? 'success' : 'secondary'}
              className="text-[10px]"
            >
              {selectedCapabilities.supportsStrictJsonSchema
                ? 'Strict json_schema Decoding'
                : 'JSON Object Mode + Zod Fallback'}
            </Badge>
            <span className="text-muted-foreground font-mono text-[11px]">{selectedCapabilities.notes}</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Global System Directive</Label>
            <Textarea
              rows={3}
              className="bg-muted/30 border-border/60 text-xs font-mono"
              value={aiSettings.systemInstructions}
              onChange={(e) =>
                setAiSettings({ ...aiSettings, systemInstructions: e.target.value })
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                className="bg-muted/30 border-border/60 font-mono text-xs"
                min={128}
                max={4096}
                value={aiSettings.maxTokens}
                onChange={(e) =>
                  setAiSettings({ ...aiSettings, maxTokens: Number(e.target.value) || 900 })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Temperature (0.0 - 1.5)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1.5}
                className="bg-muted/30 border-border/60 font-mono text-xs"
                value={aiSettings.temperature}
                onChange={(e) =>
                  setAiSettings({
                    ...aiSettings,
                    temperature: Number(e.target.value) || 0.2,
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Global Concurrency Limit</Label>
              <Input
                type="number"
                min={1}
                max={25}
                className="bg-muted/30 border-border/60 font-mono text-xs"
                value={aiSettings.globalConcurrencyLimit}
                onChange={(e) =>
                  setAiSettings({
                    ...aiSettings,
                    globalConcurrencyLimit: Number(e.target.value) || 5,
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rate Limit (req/min)</Label>
              <Input
                type="number"
                min={2}
                max={60}
                className="bg-muted/30 border-border/60 font-mono text-xs"
                value={aiSettings.perTicketRateLimitPerMinute}
                onChange={(e) =>
                  setAiSettings({
                    ...aiSettings,
                    perTicketRateLimitPerMinute: Number(e.target.value) || 12,
                  })
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
            <div>
              <p className="text-xs font-medium text-foreground">Enforce Strict Structured Outputs</p>
              <p className="text-[11px] text-muted-foreground">
                Uses <code>json_schema</code> on supported models with guaranteed token-level constraints and Zod validation.
              </p>
            </div>
            <Switch
              checked={aiSettings.structuredOutputsEnabled}
              onCheckedChange={(checked) =>
                setAiSettings({ ...aiSettings, structuredOutputsEnabled: checked })
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Fallback Response (On AI Outage)</Label>
            <Textarea
              rows={2}
              className="bg-muted/30 border-border/60 text-xs"
              value={aiSettings.fallbackMessage}
              onChange={(e) =>
                setAiSettings({ ...aiSettings, fallbackMessage: e.target.value })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Ticket Bot Provider Verification & Safeguards */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Existing Ticket Bot Verification &amp; Boundaries
          </CardTitle>
          <CardDescription className="text-xs">
            Ensures non-ticket channels and internal staff threads inside support categories are never mistaken for tickets.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Existing Ticket Provider Bot IDs (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="e.g. 557628352828014614 (Ticket Tool)"
                value={providerBotIdsText}
                onChange={(e) => setProviderBotIdsText(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Thread Closure Policy</Label>
              <select
                className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
                value={detection.threadClosurePolicy}
                onChange={(e) =>
                  setDetection({
                    ...detection,
                    threadClosurePolicy: e.target.value as ThreadClosurePolicy,
                  })
                }
              >
                <option value="locked_only" className="bg-background text-foreground">
                  Thread Locked Only (Recommended — ignores auto-archived threads)
                </option>
                <option value="archived_and_locked" className="bg-background text-foreground">
                  Thread Both Archived AND Locked
                </option>
                <option value="archived_or_locked" className="bg-background text-foreground">
                  Thread Either Archived OR Locked
                </option>
                <option value="delete_only" className="bg-background text-foreground">
                  Channel/Thread Deletion Event Only
                </option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Ticket Channel Name Prefixes (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="ticket-, support-, join-"
                value={prefixesText}
                onChange={(e) => setPrefixesText(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Ticket Topic Keywords (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="ticket, opened by, support"
                value={topicMarkersText}
                onChange={(e) => setTopicMarkersText(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="pr-2">
                <p className="text-xs font-medium text-foreground">Verify Provider Bot Message</p>
                <p className="text-[10px] text-muted-foreground">
                  Awaits ticket bot panel before starting assistant
                </p>
              </div>
              <Switch
                checked={detection.requireProviderVerification}
                onCheckedChange={(checked) =>
                  setDetection({ ...detection, requireProviderVerification: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="pr-2">
                <p className="text-xs font-medium text-foreground">Ignore Private Staff Threads</p>
                <p className="text-[10px] text-muted-foreground">
                  Prevents assistant from speaking in staff-only sub-threads
                </p>
              </div>
              <Switch
                checked={detection.ignorePrivateThreads}
                onCheckedChange={(checked) =>
                  setDetection({ ...detection, ignorePrivateThreads: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="pr-2">
                <p className="text-xs font-medium text-foreground">Tag Opener on 1st Message</p>
                <p className="text-[10px] text-muted-foreground">
                  Prepends <code>{'<@opener>'}</code> to the welcome message
                </p>
              </div>
              <Switch
                checked={detection.mentionUserOnWelcome}
                onCheckedChange={(checked) =>
                  setDetection({ ...detection, mentionUserOnWelcome: checked })
                }
              />
            </div>
          </div>

          <div className="flex justify-end pt-3">
            <Button
              type="button"
              onClick={saveAllAiAndDetection}
              className="shadow-sm shadow-primary/20 hover:shadow-primary/40 text-xs"
            >
              <Save className="mr-2 h-4 w-4" />
              Publish AI Engine &amp; Detection Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
