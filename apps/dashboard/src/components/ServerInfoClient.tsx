'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Sparkles, Wand2 } from 'lucide-react';
import type {
  AiSettings,
  ServerSettings,
  TicketDetectionConfig,
  ToneStyle,
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

  function fillRecruitmentStarterTemplate() {
    const name = guildName.trim() || 'Boom House';
    setAiSettings((prev) => ({
      ...prev,
      personaName: prev.personaName || 'Duke The Recruiter',
      toneStyle: 'human_casual',
      humanizeConversation: true,
      serverKnowledge: {
        serverOverview:
          prev.serverKnowledge.serverOverview ||
          `${name} is an active, friendly Clash clan family focused on wars, CWL, raid weekends, and helping members grow together in a chill environment.`,
        clanRequirementsAndRules:
          prev.serverKnowledge.clanRequirementsAndRules ||
          `- Main Clan (${name}): Active daily players, use both war attacks when opted in, participate in Raid Weekends & Clan Games.\n- Be respectful in chat, donate what is requested, and follow war mail plans.`,
        joiningProcessAndTiming:
          prev.serverKnowledge.joiningProcessAndTiming ||
          `1. Share your in-game Player Tag (#...) in this ticket.\n2. We pull up your stats and pass them to leadership.\n3. Leaders check open tickets regularly throughout the day (usually within 15–60 minutes depending on timezones) and will ping you right here with clan placement and an invite!`,
        additionalNotes:
          prev.serverKnowledge.additionalNotes ||
          `If a player has multiple accounts or friends wanting to join together, they can drop all tags in the same ticket.`,
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
      return 'Saved & published Server Details, Human Persona, Welcome Tagging, and Private Thread rules!';
    });
  }

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      {/* Card 1: Persona, Welcome Tagging & Ticket Rules */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Bot Persona, Welcome `@mention` & Thread Rules
              </CardTitle>
              <CardDescription>
                Make your bot chat like a real member of your team, tag the single ticket opener on
                the 1st message, and stay out of private staff threads.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={botEnabled ? 'success' : 'secondary'}>
                {botEnabled ? 'Bot Active' : 'Bot Paused'}
              </Badge>
              <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="guildName">Server / Clan Family Name</Label>
              <Input
                id="guildName"
                placeholder="e.g. Boom House"
                value={guildName}
                onChange={(e) => setGuildName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="personaName">Bot Persona Name</Label>
              <Input
                id="personaName"
                placeholder="e.g. Duke The Recruiter"
                value={aiSettings.personaName}
                onChange={(e) =>
                  setAiSettings({ ...aiSettings, personaName: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="toneStyle">Chat Vibe / Voice</Label>
              <select
                id="toneStyle"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={aiSettings.toneStyle}
                onChange={(e) =>
                  setAiSettings({
                    ...aiSettings,
                    toneStyle: e.target.value as ToneStyle,
                  })
                }
              >
                <option value="human_casual">
                  Casual Human Discord Recruiter (Recommended)
                </option>
                <option value="warm_friendly">Warm & Upbeat Community Helper</option>
                <option value="professional">Friendly & Clean Moderator</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="defaultWelcome">
              1st Welcome Message (Sent Once When Ticket Opens)
            </Label>
            <Textarea
              id="defaultWelcome"
              rows={3}
              placeholder="Hey {user}! Welcome to Boom House — looking to join a clan or need help with something?"
              value={defaultWelcome}
              onChange={(e) => setDefaultWelcome(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tip: Use <code>{'{user}'}</code> anywhere to place the opener&apos;s @mention tag, or
              leave it out and the bot will automatically prepend <code>{'<@opener>'}</code> at the
              start when tagging is enabled below.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-2">
                <p className="text-sm font-medium">Tag Opener on 1st Message</p>
                <p className="text-xs text-muted-foreground">
                  Pings only the single ticket opener on welcome
                </p>
              </div>
              <Switch
                checked={detection.mentionUserOnWelcome}
                onCheckedChange={(checked) =>
                  setDetection({ ...detection, mentionUserOnWelcome: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-2">
                <p className="text-sm font-medium">Ignore Private Threads</p>
                <p className="text-xs text-muted-foreground">
                  Never send welcome/AI replies in staff private threads
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
                <p className="text-sm font-medium">Humanize Replies</p>
                <p className="text-xs text-muted-foreground">
                  Removes stiff AI phrases, repeats & robotic tone
                </p>
              </div>
              <Switch
                checked={aiSettings.humanizeConversation}
                onCheckedChange={(checked) =>
                  setAiSettings({ ...aiSettings, humanizeConversation: checked })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Complete Server Knowledge Base */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>All Server & Clan Details (Bot Knowledge Base)</CardTitle>
              <CardDescription>
                Everything you write here is memorized by your bot so it answers questions about
                your server, requirements, joining steps, and wait times like a real insider.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fillRecruitmentStarterTemplate}
            >
              <Wand2 className="h-4 w-4" />
              Fill Sample Clan Template
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="serverOverview">1. About Your Server / Clan Family</Label>
              <Textarea
                id="serverOverview"
                rows={5}
                placeholder="Tell the bot all about your server! e.g. Boom House is an international Clash of Clans family with competitive war clans and chill farming clans..."
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
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clanRequirementsAndRules">
                2. Clans, Requirements & Server Rules
              </Label>
              <Textarea
                id="clanRequirementsAndRules"
                rows={5}
                placeholder="List your clans, Town Hall / Trophy requirements, war rules, CWL details, elder/co rules..."
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
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="joiningProcessAndTiming">
                3. How Joining Works & Expected Leader Response Time
              </Label>
              <Textarea
                id="joiningProcessAndTiming"
                rows={5}
                placeholder="How does joining work, and what should the bot say if someone asks 'but when?' e.g. Drop your #tag -> leaders check stats -> usually reply within 15-45 mins!"
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
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="additionalNotes">
                4. Extra Info, Links & Common Questions
              </Label>
              <Textarea
                id="additionalNotes"
                rows={5}
                placeholder="Anything else! Multiple accounts policy, feeder clans, Discord channels to read, CWL signups, timezone info..."
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
              />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong>Single Ticket Opener & Admin Handoff Active:</strong> The bot automatically
            identifies the <strong>1 ticket opener</strong> and chats only with them. Whenever an
            Admin or Recruiter sends a chat message in the ticket, the bot recognizes them as staff
            and steps back automatically so your team can take over without interruption.
          </div>

          <Button type="button" onClick={saveAllServerDetails}>
            <Save className="h-4 w-4" />
            Save & Publish Server Info
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

