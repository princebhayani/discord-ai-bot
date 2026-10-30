'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Sparkles } from 'lucide-react';
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3.5 text-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>
            Looking to add all your <strong>Server &amp; Clan Details</strong>, Persona Name, or
            Welcome <code>@mention</code>?
          </span>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/server-info">Open Server Info &amp; Persona</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Groq Conversational Engine Settings</CardTitle>
          <CardDescription>
            API keys remain strictly server-side (`GROQ_API_KEY`). Select any Groq-hosted model or
            enter a custom model ID.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Groq Model Preset</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.id})
                  </option>
                ))}
                <option value="__custom__">Custom Groq Model ID…</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Active Groq Model ID</Label>
              <Input
                placeholder="e.g. openai/gpt-oss-20b or llama-3.3-70b-versatile"
                value={aiSettings.model}
                onChange={(e) => setAiSettings({ ...aiSettings, model: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <Badge
              variant={selectedCapabilities.supportsStrictJsonSchema ? 'success' : 'secondary'}
            >
              {selectedCapabilities.supportsStrictJsonSchema
                ? 'Strict json_schema Constrained Decoding'
                : 'JSON Object Mode + Zod Validation'}
            </Badge>
            <span className="text-muted-foreground">{selectedCapabilities.notes}</span>
          </div>

          <div className="space-y-1.5">
            <Label>Global System Instructions</Label>
            <Textarea
              rows={4}
              value={aiSettings.systemInstructions}
              onChange={(e) =>
                setAiSettings({ ...aiSettings, systemInstructions: e.target.value })
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Max Completion Tokens</Label>
              <Input
                type="number"
                min={128}
                max={4096}
                value={aiSettings.maxTokens}
                onChange={(e) =>
                  setAiSettings({ ...aiSettings, maxTokens: Number(e.target.value) || 900 })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Temperature (0.0 – 1.5)</Label>
              <Input
                type="number"
                step="0.05"
                min={0}
                max={1.5}
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
              <Label>Global Concurrency Limit</Label>
              <Input
                type="number"
                min={1}
                max={25}
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
              <Label>Per-Ticket Rate / Min</Label>
              <Input
                type="number"
                min={2}
                max={60}
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

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Prefer Groq Strict Structured Outputs</p>
              <p className="text-xs text-muted-foreground">
                Uses <code>json_schema</code> when supported by the model, with automatic{' '}
                <code>json_object</code> fallback and strict Zod validation.
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
            <Label>Graceful Fallback Message</Label>
            <Textarea
              rows={2}
              value={aiSettings.fallbackMessage}
              onChange={(e) =>
                setAiSettings({ ...aiSettings, fallbackMessage: e.target.value })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Ticket Provider Verification & Closure Policy */}
      <Card>
        <CardHeader>
          <CardTitle>Existing Ticket Bot Verification & Closure Detection</CardTitle>
          <CardDescription>
            Ensures ordinary channels and user threads inside support categories are never mistaken
            for tickets, and configures thread closure observation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Existing Ticket Provider Bot User IDs (comma-separated)</Label>
              <Input
                placeholder="e.g. 557628352828014614 (Ticket Tool)"
                value={providerBotIdsText}
                onChange={(e) => setProviderBotIdsText(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Thread Closure Detection Policy</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={detection.threadClosurePolicy}
                onChange={(e) =>
                  setDetection({
                    ...detection,
                    threadClosurePolicy: e.target.value as ThreadClosurePolicy,
                  })
                }
              >
                <option value="locked_only">
                  Thread Locked Only (Recommended — ignores auto-archived idle threads)
                </option>
                <option value="archived_and_locked">Thread Both Archived AND Locked</option>
                <option value="archived_or_locked">Thread Either Archived OR Locked</option>
                <option value="delete_only">Channel/Thread Deletion Event Only</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Ticket Channel Name Prefixes (comma-separated)</Label>
              <Input
                placeholder="ticket-, support-"
                value={prefixesText}
                onChange={(e) => setPrefixesText(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Ticket Topic Markers (comma-separated)</Label>
              <Input
                placeholder="ticket, opened by"
                value={topicMarkersText}
                onChange={(e) => setTopicMarkersText(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-2">
                <p className="text-sm font-medium">Require Provider Bot Verification</p>
                <p className="text-xs text-muted-foreground">
                  Verifies opening message from your ticket bot before starting AI.
                </p>
              </div>
              <Switch
                checked={detection.requireProviderVerification}
                onCheckedChange={(checked) =>
                  setDetection({ ...detection, requireProviderVerification: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-2">
                <p className="text-sm font-medium">Ignore Private Threads</p>
                <p className="text-xs text-muted-foreground">
                  Prevents welcome/AI messages inside private staff threads.
                </p>
              </div>
              <Switch
                checked={detection.ignorePrivateThreads}
                onCheckedChange={(checked) =>
                  setDetection({ ...detection, ignorePrivateThreads: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-2">
                <p className="text-sm font-medium">Tag Opener on 1st Message</p>
                <p className="text-xs text-muted-foreground">
                  Mentions <code>{'<@opener>'}</code> on the initial welcome message.
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

          <Button type="button" onClick={saveAllAiAndDetection}>
            <Save className="h-4 w-4" />
            Publish AI & Ticket Detection Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

