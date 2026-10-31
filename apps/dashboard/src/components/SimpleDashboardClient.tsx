'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Copy,
  FolderPlus,
  HelpCircle,
  ListOrdered,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  type CategoryConfig,
  type QuestionnaireQuestion,
  type QuestionType,
  type ServerSettings,
} from '@hrbot/shared';
import type { ActiveSessionOverviewItem } from '@/lib/data/dashboardDataService';
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

const QUESTION_TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: 'text', label: 'Short Text' },
  { value: 'long_text', label: 'Paragraph / Long Text' },
  { value: 'choice', label: 'Multiple Choice' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date (YYYY-MM-DD)' },
];

const COMMUNITY_PRESET_QUESTIONS: QuestionnaireQuestion[] = [
  {
    key: 'what_looking_for',
    question: 'What are you looking forward to most in our community?',
    type: 'text',
    required: true,
  },
  {
    key: 'how_often_active',
    question: 'How often are you usually active throughout the week?',
    type: 'text',
    required: true,
  },
  {
    key: 'why_join',
    question: 'Why would you like to join our community?',
    type: 'long_text',
    required: true,
  },
  {
    key: 'notes_for_staff',
    question: 'Do you have any questions or notes for the moderation team?',
    type: 'text',
    required: false,
  },
];

export function SimpleDashboardClient({
  initialServerSettings,
  initialCategories,
  activeSessions = [],
  botOnline = false,
}: {
  initialServerSettings: ServerSettings;
  initialCategories: CategoryConfig[];
  activeSessions?: ActiveSessionOverviewItem[];
  botOnline?: boolean;
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();

  // Primary Server & Persona State
  const [guildName, setGuildName] = useState(initialServerSettings.guildName);
  const [botEnabled, setBotEnabled] = useState(initialServerSettings.botEnabled);
  const [botPersonaName, setBotPersonaName] = useState(
    initialServerSettings.aiSettings.personaName || 'Community Assistant'
  );
  const [welcomeMessage, setWelcomeMessage] = useState(
    initialServerSettings.defaultWelcomeMessage || 'hi thank you for choosing our community'
  );
  const [mentionUserOnWelcome, setMentionUserOnWelcome] = useState(
    initialServerSettings.ticketDetectionConfig.mentionUserOnWelcome ?? true
  );

  // Server Knowledge (What the bot knows to answer questions)
  const [serverKnowledgeText, setServerKnowledgeText] = useState(
    initialServerSettings.aiSettings.serverKnowledge.clanRequirementsAndRules ||
      initialServerSettings.aiSettings.serverKnowledge.serverOverview ||
      ''
  );
  const [joiningProcessText, setJoiningProcessText] = useState(
    initialServerSettings.aiSettings.serverKnowledge.joiningProcessAndTiming ||
      'Staff will review ticket details and connect with you shortly.'
  );

  // Category & Intake Questions State
  const primaryCategory: CategoryConfig = initialCategories[0] || {
    guildId: initialServerSettings.guildId,
    categoryId: '123456789012345678',
    categoryName: 'General Tickets',
    enabled: true,
    welcomeMessage: '',
    categoryInstructions: '',
    faqs: [],
    questions: [...COMMUNITY_PRESET_QUESTIONS],
    playerLookupEnabled: false,
    reportChannelOverrideId: '',
    configVersion: 1,
  };

  const [categoryId, setCategoryId] = useState(primaryCategory.categoryId);
  const [categoryName, setCategoryName] = useState(primaryCategory.categoryName);
  const [categoryEnabled, setCategoryEnabled] = useState(primaryCategory.enabled);
  const [questions, setQuestions] = useState<QuestionnaireQuestion[]>(
    primaryCategory.questions.length > 0
      ? primaryCategory.questions
      : COMMUNITY_PRESET_QUESTIONS
  );

  // Staff User IDs (so bot knows who staff is and doesn't mistake staff for ticket openers)
  const [staffUserIdsText, setStaffUserIdsText] = useState(
    initialServerSettings.reportSettings.staffUserIds.join(', ')
  );

  function addQuestion(template?: QuestionnaireQuestion) {
    const idx = questions.length + 1;
    const newQ: QuestionnaireQuestion = template
      ? { ...template }
      : {
          key: `field_${idx}`,
          question: 'What information would you like to provide?',
          type: 'text',
          required: true,
        };
    setQuestions([...questions, newQ]);
  }

  function updateQuestion(index: number, patch: Partial<QuestionnaireQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function removeQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const copy = [...questions];
    const current = copy[index];
    const swap = copy[target];
    if (!current || !swap) return;
    copy[index] = swap;
    copy[target] = current;
    setQuestions(copy);
  }

  function loadCommunityPreset() {
    setGuildName('Boom House');
    setBotPersonaName('Duke The Recruiter');
    setWelcomeMessage('hi thank you for choosing boom house');
    setMentionUserOnWelcome(true);
    setServerKnowledgeText(
      'Boom House is an active, friendly community. We welcome both casual and competitive members. Respect everyone, participate when you can, and enjoy your time here!'
    );
    setJoiningProcessText(
      'Our leadership team reviews requests quickly. A staff member will connect with you here shortly!'
    );
    setQuestions(COMMUNITY_PRESET_QUESTIONS);
  }

  async function handleSaveAll() {
    await runSave(async () => {
      // 1. Update Server Settings
      const parsedStaffUserIds = staffUserIdsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const settingsPayload = {
        guildName: guildName.trim() || 'Discord Server',
        botEnabled,
        defaultWelcomeMessage: welcomeMessage.trim(),
        aiSettings: {
          ...initialServerSettings.aiSettings,
          personaName: botPersonaName.trim() || 'Community Assistant',
          serverKnowledge: {
            ...initialServerSettings.aiSettings.serverKnowledge,
            serverOverview: `${guildName.trim() || 'Community'}: Active, welcoming server.`,
            clanRequirementsAndRules: serverKnowledgeText.trim(),
            joiningProcessAndTiming: joiningProcessText.trim(),
          },
        },
        ticketDetectionConfig: {
          ...initialServerSettings.ticketDetectionConfig,
          mentionUserOnWelcome,
        },
        reportSettings: {
          ...initialServerSettings.reportSettings,
          staffUserIds: parsedStaffUserIds,
        },
      };

      const settingsRes = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsPayload),
      });

      if (!settingsRes.ok) {
        const errJson = (await settingsRes.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Failed saving server settings');
      }

      // 2. Update Category Config with Questions
      const categoryPayload: CategoryConfig = {
        ...primaryCategory,
        categoryId: categoryId.trim(),
        categoryName: categoryName.trim() || 'General Tickets',
        enabled: categoryEnabled,
        questions,
      };

      const categoryRes = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryPayload),
      });

      if (!categoryRes.ok) {
        const errJson = (await categoryRes.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Failed saving ticket questions');
      }

      router.refresh();
      return 'All server details, persona, and intake questions saved successfully!';
    });
  }

  // Live preview formatting
  const formattedWelcome = mentionUserOnWelcome
    ? `@Member ${welcomeMessage}`
    : welcomeMessage;
  const firstQuestion = questions[0]?.question || 'What are you looking forward to?';

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      {/* Top Bar with Live Indicator & Save Action */}
      <div className="glass-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {guildName || 'Discord Server'}
            </h1>
            <div
              className={`flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                botOnline
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {botOnline && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    botOnline ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                ></span>
              </span>
              <span>{botOnline ? 'Bot Online' : 'Connecting'}</span>
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Simple front-desk assistant setup: fill your server details, set your intake questions, and click Save.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadCommunityPreset}
            className="border-border/60 bg-background/50 hover:bg-primary/10 hover:text-primary text-xs"
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5 text-primary" />
            Load Preset
          </Button>
          <Button
            type="button"
            onClick={handleSaveAll}
            className="shadow-sm shadow-primary/25 hover:shadow-primary/40 text-xs font-semibold px-4"
          >
            <Save className="mr-1.5 h-4 w-4" />
            Save &amp; Publish All
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left Column: Simple Setup Forms */}
        <div className="space-y-6 lg:col-span-3">
          {/* Card 1: Server Details & Bot Persona */}
          <Card className="glass-card border border-border/60">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" />
                  1. Server Details &amp; Bot Persona
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Bot Enabled</span>
                  <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
                </div>
              </div>
              <CardDescription className="text-xs">
                Name your bot persona and provide basic info about your community for the AI to speak naturally.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Community / Server Name</Label>
                  <Input
                    className="bg-muted/30 border-border/60 text-sm font-medium"
                    placeholder="e.g. Boom House"
                    value={guildName}
                    onChange={(e) => setGuildName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Bot Persona Name</Label>
                  <Input
                    className="bg-muted/30 border-border/60 text-sm font-medium"
                    placeholder="e.g. Duke The Recruiter"
                    value={botPersonaName}
                    onChange={(e) => setBotPersonaName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Initial Welcome Message</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Tag Member (@mention)</span>
                    <Switch
                      checked={mentionUserOnWelcome}
                      onCheckedChange={setMentionUserOnWelcome}
                    />
                  </div>
                </div>
                <Input
                  className="bg-muted/30 border-border/60 text-sm"
                  placeholder="e.g. hi thank you for choosing boom house"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  About Our Community &amp; Rules (What the bot knows)
                </Label>
                <Textarea
                  rows={3}
                  className="bg-muted/30 border-border/60 text-xs font-sans"
                  placeholder="Describe your server, guidelines, events, and what members should know. The AI uses this to answer questions in chat!"
                  value={serverKnowledgeText}
                  onChange={(e) => setServerKnowledgeText(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Joining Process &amp; Expected Response Time
                </Label>
                <Input
                  className="bg-muted/30 border-border/60 text-xs"
                  placeholder="e.g. A staff member reviews requests and will connect with you here shortly."
                  value={joiningProcessText}
                  onChange={(e) => setJoiningProcessText(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Intake Questions */}
          <Card className="glass-card border border-border/60">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                    <ListOrdered className="h-4 w-4 text-primary" />
                    2. Intake Questions ({questions.length})
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Questions the bot asks ticket openers one by one to collect basic onboarding info.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-border/60 hover:bg-primary/10 hover:text-primary"
                  onClick={() => addQuestion()}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5 text-primary" />
                  Add Question
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground mr-1">Quick Add:</span>
                <button
                  type="button"
                  onClick={() =>
                    addQuestion({
                      key: 'how_often_active',
                      question: 'How often are you usually active throughout the week?',
                      type: 'text',
                      required: true,
                    })
                  }
                  className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  + Activity Level
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addQuestion({
                      key: 'what_looking_for',
                      question: 'What are you looking forward to most in our community?',
                      type: 'text',
                      required: true,
                    })
                  }
                  className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  + Expectations
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addQuestion({
                      key: 'why_join',
                      question: 'Why would you like to join our community?',
                      type: 'long_text',
                      required: true,
                    })
                  }
                  className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  + Reason for Joining
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addQuestion({
                      key: 'notes_for_staff',
                      question: 'Do you have any questions or notes for the moderation team?',
                      type: 'text',
                      required: false,
                    })
                  }
                  className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  + Staff Notes
                </button>
              </div>

              {questions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-8 text-center space-y-2">
                  <p className="text-xs text-muted-foreground">No questions added yet.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setQuestions(COMMUNITY_PRESET_QUESTIONS)}
                    className="text-xs"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    Load 4 Standard Questions
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {questions.map((q, idx) => (
                    <div
                      key={`${q.key}-${idx}`}
                      className="rounded-lg border border-border/50 bg-background/50 p-3.5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary font-mono text-[11px] font-bold">
                            {idx + 1}
                          </span>
                          <span className="font-mono text-xs text-foreground font-semibold">
                            {q.key}
                          </span>
                          <Badge
                            variant={q.required ? 'default' : 'secondary'}
                            className="text-[9px] h-4 py-0"
                          >
                            {q.required ? 'Required' : 'Optional'}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => moveQuestion(idx, -1)}
                            disabled={idx === 0}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            onClick={() => moveQuestion(idx, 1)}
                            disabled={idx === questions.length - 1}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeQuestion(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-2 space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Question Text</Label>
                          <Input
                            className="text-xs bg-muted/20 border-border/50"
                            value={q.question}
                            onChange={(e) => updateQuestion(idx, { question: e.target.value })}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Answer Type</Label>
                          <select
                            className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs focus:border-primary focus:outline-none"
                            value={q.type}
                            onChange={(e) =>
                              updateQuestion(idx, { type: e.target.value as QuestionType })
                            }
                          >
                            {QUESTION_TYPES.map((t) => (
                              <option key={t.value} value={t.value} className="bg-background text-foreground">
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {q.type === 'choice' && (
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Allowed Choices (comma-separated)</Label>
                          <Input
                            className="text-xs bg-muted/20 border-border/50"
                            placeholder="Casual, Competitive, Daily, Weekends Only"
                            value={(q.choices ?? []).join(', ')}
                            onChange={(e) =>
                              updateQuestion(idx, {
                                choices: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Discord Category & Staff Protection */}
          <Card className="glass-card border border-border/60">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  3. Ticket Category &amp; Staff Protection
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Category Active</span>
                  <Switch checked={categoryEnabled} onCheckedChange={setCategoryEnabled} />
                </div>
              </div>
              <CardDescription className="text-xs">
                Tell the bot where tickets are created, and specify staff Discord IDs so it never confuses staff for applicants.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Discord Ticket Category ID
                  </Label>
                  <Input
                    className="font-mono text-xs bg-muted/30 border-border/60"
                    placeholder="17-20 digit Category Snowflake ID"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Ticket Category Label
                  </Label>
                  <Input
                    className="text-xs bg-muted/30 border-border/60"
                    placeholder="e.g. Join Requests"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Staff / Admin Discord User IDs (comma-separated)
                </Label>
                <Input
                  className="font-mono text-xs bg-muted/30 border-border/60"
                  placeholder="e.g. 333333333333333333, 444444444444444444"
                  value={staffUserIdsText}
                  onChange={(e) => setStaffUserIdsText(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  The bot uses these IDs to identify staff members in ticket channels. When staff speak, the bot yields and never treats staff as applicants.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Live Discord Chat Simulator */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="glass-card sticky top-20 border border-primary/20 shadow-lg shadow-primary/5">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="h-4 w-4 text-primary" />
                  Live Discord Preview
                </CardTitle>
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary font-mono">
                  Real-Time
                </Badge>
              </div>
              <CardDescription className="text-xs">
                How ticket openers experience your bot when they open a ticket in Discord.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-4">
              {/* Discord Chat Mockup */}
              <div className="rounded-xl border border-zinc-800 bg-[#313338] p-4 text-left shadow-md font-sans text-xs">
                {/* Bot Message */}
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white text-xs shadow-sm">
                    {botPersonaName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white text-xs">{botPersonaName}</span>
                      <span className="rounded bg-[#5865f2] px-1 py-0.2 text-[9px] font-bold uppercase text-white">
                        APP
                      </span>
                      <span className="text-[10px] text-zinc-400">Today at 12:00 PM</span>
                    </div>

                    {/* Discord Chat Bubble */}
                    <div className="text-zinc-200 text-xs leading-relaxed space-y-2">
                      <p>
                        {mentionUserOnWelcome && (
                          <span className="rounded bg-[#5865f2]/20 px-1 py-0.5 font-medium text-[#c9cdfb] mr-1">
                            @Member
                          </span>
                        )}
                        {welcomeMessage}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Member Reply */}
                <div className="flex items-start gap-3 mt-4 pt-3 border-t border-zinc-700/50">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-600 font-bold text-white text-xs">
                    M
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white text-xs">Member</span>
                      <span className="text-[10px] text-zinc-400">Today at 12:01 PM</span>
                    </div>
                    <p className="text-zinc-300 text-xs">hi</p>
                  </div>
                </div>

                {/* Bot First Question */}
                <div className="flex items-start gap-3 mt-4 pt-3 border-t border-zinc-700/50">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white text-xs">
                    {botPersonaName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white text-xs">{botPersonaName}</span>
                      <span className="rounded bg-[#5865f2] px-1 py-0.2 text-[9px] font-bold uppercase text-white">
                        APP
                      </span>
                      <span className="text-[10px] text-zinc-400">Today at 12:01 PM</span>
                    </div>
                    <p className="text-zinc-200 text-xs">
                      {firstQuestion}
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary Pill */}
              <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-xs space-y-1 text-muted-foreground">
                <p className="font-medium text-foreground text-[11px] flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  What happens next?
                </p>
                <p className="text-[11px]">
                  The bot collects answers to all <strong>{questions.length}</strong> configured questions, answers questions using your server knowledge, and lets the applicant know staff will handle placement.
                </p>
              </div>

              {/* Active Sessions Quick View */}
              {activeSessions.length > 0 && (
                <div className="rounded-lg border border-border/50 bg-muted/15 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Active Tickets In Memory</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {activeSessions.length} Active
                    </Badge>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {activeSessions.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between text-[11px] p-1.5 rounded bg-background/60"
                      >
                        <span className="font-mono text-muted-foreground truncate max-w-[140px]">
                          #{s.channelId}
                        </span>
                        <Badge variant="secondary" className="text-[9px] py-0">
                          {s.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
