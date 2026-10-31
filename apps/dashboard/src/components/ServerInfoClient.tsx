'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react';
import {
  KNOWN_GROQ_MODELS,
  type AiSettings,
  type ServerSettings,
  type TicketDetectionConfig,
  type ToneStyle,
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

export function ServerInfoClient({
  initialSettings,
}: {
  initialSettings: ServerSettings;
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();

  const [guildName, setGuildName] = useState(initialSettings.guildName);
  const [botEnabled, setBotEnabled] = useState(initialSettings.botEnabled);
  const [defaultWelcome, setDefaultWelcome] = useState(
    initialSettings.defaultWelcomeMessage
  );
  const [aiSettings, setAiSettings] = useState<AiSettings>(
    initialSettings.aiSettings
  );
  const [detection, setDetection] = useState<TicketDetectionConfig>(
    initialSettings.ticketDetectionConfig
  );

  function fillUniversalCommunityTemplate() {
    const name = guildName.trim() || 'Community Guild';
    setDefaultWelcome(
      `hey {user}! welcome to ${name} - what are you looking forward to most here, or how can we help you out today?`
    );
    setAiSettings((prev) => ({
      ...prev,
      model: 'openai/gpt-oss-120b',
      personaName: prev.personaName || 'Community Helper',
      toneStyle: 'human_casual',
      humanizeConversation: true,
      serverKnowledge: {
        serverOverview: `${name} is an active, friendly community focused on welcoming members, organizing community events, and having a great time together.`,
        clanRequirementsAndRules: `- Be respectful in all channels.\n- Stay active and participate in community discussions.\n- Follow Discord Terms of Service and community guidelines.`,
        joiningProcessAndTiming: `1. Share what you're looking forward to and how often you're active in this ticket.\n2. The assistant summarizes your details for leadership.\n3. Moderators check tickets regularly throughout the day (usually within 15-45 minutes) and will jump right in here to chat with you!`,
        additionalNotes: `Feel free to ask any general questions about our server, community events, or roles while waiting!`,
      },
    }));
  }

  async function saveAllServerDetails() {
    await runSave(async () => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildName,
          botEnabled,
          defaultWelcomeMessage: defaultWelcome,
          aiSettings,
          ticketDetectionConfig: detection,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed saving server info & persona');
      }
      router.refresh();
      return 'Published Server Details, Persona & Community Knowledge!';
    });
  }

  // Live preview formatting
  const formattedPreviewWelcome = defaultWelcome
    ? defaultWelcome.includes('{user}')
      ? defaultWelcome.replace(/\{user\}/gi, '@Member')
      : detection.mentionUserOnWelcome
        ? `@Member ${defaultWelcome}`
        : defaultWelcome
    : 'Welcome to the server! How can we help you today?';

  return (
    <div className="space-y-8">
      <StatusBanner status={status} />

      {/* Top Action & Persona Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Server Identity & Bot Persona
            </h1>
            <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Persona Studio
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure how your assistant introduces itself, chats with ticket openers, and speaks about your community.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fillUniversalCommunityTemplate}
            className="border-border/70 text-xs font-medium hover:bg-secondary/60 gap-1.5"
          >
            <Wand2 className="h-3.5 w-3.5 text-primary" />
            <span>Load Community Preset</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={saveAllServerDetails}
            className="font-medium gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save & Publish</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Form Controls (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          {/* Identity & Brain Card */}
          <Card className="border-border/70 bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-foreground">Bot Persona & Identity</CardTitle>
                    <CardDescription className="text-xs">
                      Server identity and the front-desk character your bot assumes.
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-medium ${botEnabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                    {botEnabled ? 'Active' : 'Paused'}
                  </span>
                  <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="guildName" className="text-xs font-medium text-foreground">
                    Community / Server Name
                  </Label>
                  <Input
                    id="guildName"
                    placeholder="e.g. Boom House"
                    value={guildName}
                    onChange={(e) => setGuildName(e.target.value)}
                    className="h-9 border-border/70 bg-background/50 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="personaName" className="text-xs font-medium text-foreground">
                    Bot Persona Name
                  </Label>
                  <Input
                    id="personaName"
                    placeholder="e.g. Duke The Recruiter"
                    value={aiSettings.personaName}
                    onChange={(e) =>
                      setAiSettings({ ...aiSettings, personaName: e.target.value })
                    }
                    className="h-9 border-border/70 bg-background/50 text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="toneStyle" className="text-xs font-medium text-foreground">
                    Conversational Vibe
                  </Label>
                  <select
                    id="toneStyle"
                    className="h-9 w-full rounded-md border border-border/70 bg-background/50 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    value={aiSettings.toneStyle}
                    onChange={(e) =>
                      setAiSettings({
                        ...aiSettings,
                        toneStyle: e.target.value as ToneStyle,
                      })
                    }
                  >
                    <option value="human_casual">Chill Community Helper (Recommended)</option>
                    <option value="warm_friendly">Warm & Welcoming Greeter</option>
                    <option value="professional">Polite Support Moderator</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="humanModel" className="text-xs font-medium text-foreground">
                    AI Brain Engine
                  </Label>
                  <select
                    id="humanModel"
                    className="h-9 w-full rounded-md border border-border/70 bg-background/50 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    value={
                      KNOWN_GROQ_MODELS.some((m) => m.id === aiSettings.model)
                        ? aiSettings.model
                        : KNOWN_GROQ_MODELS[0]?.id ?? 'openai/gpt-oss-120b'
                    }
                    onChange={(e) =>
                      setAiSettings({ ...aiSettings, model: e.target.value })
                    }
                  >
                    {KNOWN_GROQ_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="defaultWelcome" className="text-xs font-medium text-foreground">
                    1st Welcome Greeting (Sent Once When Ticket Opens)
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Use {'{user}'} for @mention
                  </span>
                </div>
                <Textarea
                  id="defaultWelcome"
                  rows={3}
                  placeholder="hey {user}! welcome to the server - what are you looking forward to most here?"
                  value={defaultWelcome}
                  onChange={(e) => setDefaultWelcome(e.target.value)}
                  className="border-border/70 bg-background/50 text-xs leading-relaxed"
                />
              </div>

              {/* Behavior Switches */}
              <div className="grid gap-3 pt-1 sm:grid-cols-3">
                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">Tag Opener</p>
                    <Switch
                      checked={detection.mentionUserOnWelcome}
                      onCheckedChange={(checked) =>
                        setDetection({ ...detection, mentionUserOnWelcome: checked })
                      }
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Pings ticket creator on 1st message
                  </p>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">Ignore Staff Threads</p>
                    <Switch
                      checked={detection.ignorePrivateThreads}
                      onCheckedChange={(checked) =>
                        setDetection({ ...detection, ignorePrivateThreads: checked })
                      }
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Stays out of private staff discussions
                  </p>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">Humanize Voice</p>
                    <Switch
                      checked={aiSettings.humanizeConversation}
                      onCheckedChange={(checked) =>
                        setAiSettings({ ...aiSettings, humanizeConversation: checked })
                      }
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                    Strips robotic AI clichés & filler
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Server Knowledge Base Card */}
          <Card className="border-border/70 bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold text-foreground">Community Knowledge Base</CardTitle>
                  <CardDescription className="text-xs">
                    Information the assistant uses to answer user questions naturally in chat.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="serverOverview" className="text-xs font-medium text-foreground">
                  1. Community Overview & Purpose
                </Label>
                <Textarea
                  id="serverOverview"
                  rows={3}
                  placeholder="Describe your server, community focus, vibe, and activities..."
                  value={aiSettings.serverKnowledge.serverOverview}
                  onChange={(e) =>
                    setAiSettings({
                      ...aiSettings,
                      serverKnowledge: {
                        ...aiSettings.serverKnowledge,
                        serverOverview: e.target.value,
                      },
                    })
                  }
                  className="border-border/70 bg-background/50 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="clanRequirementsAndRules" className="text-xs font-medium text-foreground">
                  2. Rules, Guidelines & Activity Expectations
                </Label>
                <Textarea
                  id="clanRequirementsAndRules"
                  rows={3}
                  placeholder="Community rules, activity requirements, etiquette, expectations..."
                  value={aiSettings.serverKnowledge.clanRequirementsAndRules}
                  onChange={(e) =>
                    setAiSettings({
                      ...aiSettings,
                      serverKnowledge: {
                        ...aiSettings.serverKnowledge,
                        clanRequirementsAndRules: e.target.value,
                      },
                    })
                  }
                  className="border-border/70 bg-background/50 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="joiningProcessAndTiming" className="text-xs font-medium text-foreground">
                  3. Process & Expected Moderator Response Times
                </Label>
                <Textarea
                  id="joiningProcessAndTiming"
                  rows={3}
                  placeholder="How does intake work, and what should the bot tell members who ask 'how long?' or 'when?'..."
                  value={aiSettings.serverKnowledge.joiningProcessAndTiming}
                  onChange={(e) =>
                    setAiSettings({
                      ...aiSettings,
                      serverKnowledge: {
                        ...aiSettings.serverKnowledge,
                        joiningProcessAndTiming: e.target.value,
                      },
                    })
                  }
                  className="border-border/70 bg-background/50 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="additionalNotes" className="text-xs font-medium text-foreground">
                  4. Extra Details & Helpful Links
                </Label>
                <Textarea
                  id="additionalNotes"
                  rows={3}
                  placeholder="Any extra info, role channels to check out, voice chat norms, or community FAQ..."
                  value={aiSettings.serverKnowledge.additionalNotes}
                  onChange={(e) =>
                    setAiSettings({
                      ...aiSettings,
                      serverKnowledge: {
                        ...aiSettings.serverKnowledge,
                        additionalNotes: e.target.value,
                      },
                    })
                  }
                  className="border-border/70 bg-background/50 text-xs"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Interactive Live Discord Simulator (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          <div className="sticky top-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <span>Live Discord Preview</span>
              </span>
              <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Real-Time Render
              </span>
            </div>

            {/* Simulated Discord Channel Interface */}
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-[#313338] shadow-2xl">
              {/* Channel Top Header */}
              <div className="flex items-center gap-2 border-b border-[#2B2D31] bg-[#313338] px-4 py-3 text-xs font-medium text-[#DBDEE1]">
                <span className="text-[#80848E] font-bold text-sm">#</span>
                <span>ticket-0142</span>
                <span className="rounded bg-[#2B2D31] px-1.5 py-0.5 text-[10px] text-[#949BA4]">
                  Private Channel
                </span>
              </div>

              {/* Message Feed Container */}
              <div className="p-4 space-y-4 font-sans text-[13px]">
                {/* 1. Ticket Provider Embed (e.g. ClashDuke / TicketTool) */}
                <div className="flex items-start gap-3 opacity-90">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E0523C] text-xs font-bold text-white">
                    T
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">Ticket Tool</span>
                      <span className="rounded bg-[#5865F2] px-1 py-0.2 text-[9px] font-bold uppercase text-white">
                        APP
                      </span>
                      <span className="text-[10px] text-[#949BA4]">Today at 10:40 AM</span>
                    </div>
                    <div className="rounded-lg border-l-4 border-[#FEE75C] bg-[#2B2D31] p-3 text-xs text-[#DBDEE1] space-y-1">
                      <p className="font-bold text-white">Open Ticket · #0142</p>
                      <p className="text-[11px] text-[#B5BAC1]">
                        Opened by <span className="text-[#5865F2]">@Member</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Our AI Ticket Assistant Message (LIVE PREVIEW) */}
                <div className="flex items-start gap-3 rounded-lg bg-[#2E3035]/60 p-2 border border-primary/20">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-indigo-500 text-xs font-bold text-white shadow-sm">
                    {aiSettings.personaName ? aiSettings.personaName.slice(0, 1).toUpperCase() : 'A'}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#F2F3F5]">
                        {aiSettings.personaName.trim() || 'Ticket Assistant'}
                      </span>
                      <span className="rounded bg-[#5865F2] px-1 py-0.2 text-[9px] font-bold uppercase text-white">
                        APP
                      </span>
                      <span className="text-[10px] text-[#949BA4]">Today at 10:41 AM</span>
                    </div>

                    <div className="text-[#DBDEE1] leading-relaxed break-words whitespace-pre-wrap text-xs">
                      {detection.mentionUserOnWelcome && (
                        <span className="rounded bg-[#5865F2]/20 px-1 py-0.5 font-medium text-[#5865F2] mr-1">
                          @Member
                        </span>
                      )}
                      <span>
                        {defaultWelcome
                          ? defaultWelcome.replace(/\{user\}/gi, '').trim()
                          : 'hi thank you for reaching out!'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chat Input Bar Preview */}
              <div className="border-t border-[#2B2D31] bg-[#383A40] p-3">
                <div className="flex items-center rounded-lg bg-[#313338] px-3 py-2 text-xs text-[#949BA4]">
                  <span>Message #ticket-0142...</span>
                </div>
              </div>
            </div>

            {/* Moderator Rule Callout */}
            <div className="rounded-xl border border-border/70 bg-card/60 p-4 backdrop-blur-md space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>Zero Game-Specific Requirements</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                The bot collects your general community onboarding answers and chats naturally. Game questions,
                account checks, and verification are reserved for human moderators when they arrive.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

