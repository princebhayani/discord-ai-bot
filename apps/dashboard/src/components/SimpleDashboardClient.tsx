'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Layers,
  ListPlus,
  Plus,
  RotateCcw,
  Save,
  Shield,
  Trash2,
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
  { value: 'long_text', label: 'Paragraph / Description' },
  { value: 'choice', label: 'Multiple Choice' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date (YYYY-MM-DD)' },
];

const RECOMMENDED_QUESTIONS: QuestionnaireQuestion[] = [
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

function sanitizeKey(raw: string, fallbackIndex: number): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (/^[a-z][a-z0-9_]{1,48}$/.test(cleaned)) {
    return cleaned;
  }
  return `field_${fallbackIndex}`;
}

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

  // General & Persona
  const [guildName, setGuildName] = useState(initialServerSettings.guildName);
  const [botEnabled, setBotEnabled] = useState(initialServerSettings.botEnabled);
  const [botPersonaName, setBotPersonaName] = useState(
    initialServerSettings.aiSettings.personaName || 'Community Assistant'
  );

  // Welcome Message
  const [welcomeMessage, setWelcomeMessage] = useState(
    initialServerSettings.defaultWelcomeMessage || 'Hi! Thank you for opening a ticket with our community.'
  );
  const [mentionUserOnWelcome, setMentionUserOnWelcome] = useState(
    initialServerSettings.ticketDetectionConfig.mentionUserOnWelcome ?? true
  );

  // Community Knowledge Base
  const [serverKnowledgeText, setServerKnowledgeText] = useState(
    initialServerSettings.aiSettings.serverKnowledge.clanRequirementsAndRules ||
      initialServerSettings.aiSettings.serverKnowledge.serverOverview ||
      ''
  );
  const [joiningProcessText, setJoiningProcessText] = useState(
    initialServerSettings.aiSettings.serverKnowledge.joiningProcessAndTiming ||
      'Our team reviews submissions regularly. A staff member will connect with you here shortly.'
  );

  // Primary Category & Intake Questions
  const defaultCategory: CategoryConfig = {
    guildId: initialServerSettings.guildId,
    categoryId: '123456789012345678',
    categoryName: 'General Tickets',
    enabled: true,
    welcomeMessage: '',
    categoryInstructions: '',
    faqs: [],
    questions: [...RECOMMENDED_QUESTIONS],
    playerLookupEnabled: false,
    reportChannelOverrideId: '',
    configVersion: 1,
  };

  const [activeCategory, setActiveCategory] = useState<CategoryConfig>(
    initialCategories[0] ?? defaultCategory
  );

  const [categoryId, setCategoryId] = useState(activeCategory.categoryId);
  const [categoryName, setCategoryName] = useState(activeCategory.categoryName);
  const [categoryEnabled, setCategoryEnabled] = useState(activeCategory.enabled);
  const [questions, setQuestions] = useState<QuestionnaireQuestion[]>(
    activeCategory.questions.length > 0
      ? activeCategory.questions
      : RECOMMENDED_QUESTIONS
  );

  // Sync state when server props update (e.g. after router.refresh() or initial load)
  useEffect(() => {
    if (initialCategories.length > 0 && initialCategories[0]) {
      const latest = initialCategories[0];
      setActiveCategory(latest);
      setCategoryId(latest.categoryId);
      setCategoryName(latest.categoryName);
      setCategoryEnabled(latest.enabled);
      if (latest.questions && latest.questions.length > 0) {
        setQuestions(latest.questions);
      }
    }
  }, [initialCategories]);

  // Staff User IDs (exempt from bot questionnaire)
  const [staffUserIdsText, setStaffUserIdsText] = useState(
    initialServerSettings.reportSettings.staffUserIds.join(', ')
  );

  function addQuestion(template?: QuestionnaireQuestion) {
    const idx = questions.length + 1;
    const newQ: QuestionnaireQuestion = template
      ? { ...template, key: sanitizeKey(template.key, idx) }
      : {
          key: `field_${idx}`,
          question: 'What information would you like to provide?',
          type: 'text',
          required: true,
        };
    setQuestions([...questions, newQ]);
  }

  function updateQuestion(index: number, patch: Partial<QuestionnaireQuestion>) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        const updated = { ...q, ...patch };
        if (patch.key !== undefined) {
          updated.key = sanitizeKey(patch.key, index + 1);
        }
        return updated;
      })
    );
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

  function loadRecommendedPreset() {
    setGuildName('Boom House');
    setBotPersonaName('Duke The Recruiter');
    setWelcomeMessage('Hi! Thank you for opening a ticket with Boom House.');
    setMentionUserOnWelcome(true);
    setServerKnowledgeText(
      'Boom House is a vibrant, friendly community. We welcome active, respectful members. Please participate in events, follow our server guidelines, and enjoy your time here!'
    );
    setJoiningProcessText(
      'Our leadership team reviews requests regularly and will connect with you here shortly.'
    );
    setQuestions(RECOMMENDED_QUESTIONS);
  }

  async function handleSaveAll() {
    await runSave(async () => {
      const parsedStaffUserIds = staffUserIdsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const trimmedCategoryId = categoryId.trim();
      if (!/^\d{15,22}$/.test(trimmedCategoryId)) {
        throw new Error(
          'Ticket Category ID must be a valid 15-22 digit Discord Snowflake ID (e.g. 123456789012345678).'
        );
      }

      // Validate question keys
      const validatedQuestions = questions.map((q, i) => ({
        ...q,
        key: sanitizeKey(q.key, i + 1),
        question: q.question.trim() || 'Please provide details',
      }));

      // 1. Update Server Settings
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
          ignorePrivateThreads: true,
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

      // 2. Update Category Config with Questions (with previousCategoryId for rename support)
      const categoryPayload = {
        ...activeCategory,
        id: activeCategory.id,
        previousCategoryId: activeCategory.categoryId,
        categoryId: trimmedCategoryId,
        categoryName: categoryName.trim() || 'General Tickets',
        enabled: categoryEnabled,
        questions: validatedQuestions,
      };

      const categoryRes = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryPayload),
      });

      if (!categoryRes.ok) {
        const errJson = (await categoryRes.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Failed saving ticket category');
      }

      const { category: savedCat } = (await categoryRes.json()) as {
        category: CategoryConfig;
      };
      if (savedCat) {
        setActiveCategory(savedCat);
        setCategoryId(savedCat.categoryId);
        setCategoryName(savedCat.categoryName);
        setCategoryEnabled(savedCat.enabled);
      }

      router.refresh();
      return 'All settings, category ID, and intake questions saved successfully.';
    });
  }

  // Keyboard shortcut: Ctrl+S / Cmd+S
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void handleSaveAll();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    guildName,
    botEnabled,
    botPersonaName,
    welcomeMessage,
    mentionUserOnWelcome,
    serverKnowledgeText,
    joiningProcessText,
    categoryId,
    categoryName,
    categoryEnabled,
    questions,
    staffUserIdsText,
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Top Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">
              Bot &amp; Intake Configuration
            </h1>
            <Badge
              variant="outline"
              className="text-xs font-mono border-zinc-700 bg-zinc-900/60 text-zinc-400"
            >
              v{initialServerSettings.configVersion}
            </Badge>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Configure greeting, community knowledge, and member intake questions for your ticket channels.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadRecommendedPreset}
            className="h-9 px-3 text-xs border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300 transition-colors"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-zinc-400" />
            Load Presets
          </Button>

          <Button
            type="button"
            onClick={handleSaveAll}
            disabled={status.state === 'saving'}
            className="h-9 px-4 text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-900 transition-colors shadow-sm"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {status.state === 'saving' ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <StatusBanner status={status} />

      {/* Card 1: General & Persona */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-zinc-100 font-medium">General Settings</CardTitle>
              <CardDescription className="text-xs text-zinc-400 mt-0.5">
                Community identity and assistant persona.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2.5">
              <Label htmlFor="bot-enabled-switch" className="text-xs text-zinc-300 font-normal">
                Bot Enabled
              </Label>
              <Switch
                id="bot-enabled-switch"
                checked={botEnabled}
                onCheckedChange={setBotEnabled}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300">Server / Community Name</Label>
              <Input
                className="h-9 bg-zinc-950/60 border-zinc-800 text-sm text-zinc-100 focus:border-zinc-600"
                placeholder="e.g. Boom House"
                value={guildName}
                onChange={(e) => setGuildName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300">Bot Persona Name</Label>
              <Input
                className="h-9 bg-zinc-950/60 border-zinc-800 text-sm text-zinc-100 focus:border-zinc-600"
                placeholder="e.g. Duke The Recruiter"
                value={botPersonaName}
                onChange={(e) => setBotPersonaName(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Ticket Welcome */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-zinc-100 font-medium">Ticket Greeting</CardTitle>
              <CardDescription className="text-xs text-zinc-400 mt-0.5">
                Sent once immediately when an applicant opens a new ticket.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="mention-user-switch" className="text-xs text-zinc-400 font-normal">
                Mention Member (@user)
              </Label>
              <Switch
                id="mention-user-switch"
                checked={mentionUserOnWelcome}
                onCheckedChange={setMentionUserOnWelcome}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Input
              className="h-9 bg-zinc-950/60 border-zinc-800 text-sm text-zinc-100 focus:border-zinc-600"
              placeholder="e.g. Hi! Thank you for opening a ticket with our community."
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
            />
            <p className="text-[11px] text-zinc-500">
              The ticket opener is greeted with this message before the questionnaire begins.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: Community Knowledge Base */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-4">
          <CardTitle className="text-base text-zinc-100 font-medium">Community Knowledge</CardTitle>
          <CardDescription className="text-xs text-zinc-400 mt-0.5">
            Context the assistant references when members ask questions about rules, activities, or schedules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-300">
              About Server &amp; Rules
            </Label>
            <Textarea
              rows={4}
              className="bg-zinc-950/60 border-zinc-800 text-sm text-zinc-100 focus:border-zinc-600 leading-relaxed font-sans"
              placeholder="Outline your community rules, activity expectations, event schedules, and culture. The assistant draws from this to answer applicant inquiries naturally."
              value={serverKnowledgeText}
              onChange={(e) => setServerKnowledgeText(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-300">
              Completion Notice / Next Steps
            </Label>
            <Input
              className="h-9 bg-zinc-950/60 border-zinc-800 text-sm text-zinc-100 focus:border-zinc-600"
              placeholder="e.g. Our leadership team reviews requests regularly and will connect with you here shortly."
              value={joiningProcessText}
              onChange={(e) => setJoiningProcessText(e.target.value)}
            />
            <p className="text-[11px] text-zinc-500">
              Displayed to the applicant once all intake questions have been collected.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Intake Questions */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base text-zinc-100 font-medium">
                  Intake Questions
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-xs font-mono border-zinc-700 bg-zinc-900/60 text-zinc-300"
                >
                  {questions.length} {questions.length === 1 ? 'question' : 'questions'}
                </Badge>
              </div>
              <CardDescription className="text-xs text-zinc-400 mt-0.5">
                Questions asked sequentially when someone opens a ticket.
              </CardDescription>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addQuestion()}
              className="h-8 px-3 text-xs border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-200 transition-colors"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5 text-zinc-400" />
              Add Question
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Quick Add Presets Bar */}
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-zinc-950/40 border border-zinc-800/80">
            <span className="text-[11px] font-medium text-zinc-500 mr-1.5">Quick add:</span>
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
              className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition-colors"
            >
              + Activity Schedule
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
              className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition-colors"
            >
              + Goals &amp; Interests
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
              className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition-colors"
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
              className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-0.5 text-xs text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 transition-colors"
            >
              + Staff Note
            </button>
          </div>

          {/* Question Rows */}
          {questions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center space-y-2">
              <p className="text-xs text-zinc-400">No intake questions configured.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQuestions(RECOMMENDED_QUESTIONS)}
                className="text-xs border-zinc-800 bg-zinc-900/50"
              >
                Load Default 4 Questions
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <div
                  key={`${q.key}-${idx}`}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3.5 space-y-3 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400">
                        {idx + 1}
                      </span>
                      <Input
                        className="h-6 w-36 font-mono text-[11px] bg-transparent border-transparent hover:border-zinc-800 focus:border-zinc-700 focus:bg-zinc-900 px-1 text-zinc-300"
                        value={q.key}
                        onChange={(e) => updateQuestion(idx, { key: e.target.value })}
                        title="Field Key (snake_case)"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 pr-2 border-r border-zinc-800">
                        <Label
                          htmlFor={`req-switch-${idx}`}
                          className="text-[11px] text-zinc-400 font-normal cursor-pointer"
                        >
                          Required
                        </Label>
                        <Switch
                          id={`req-switch-${idx}`}
                          checked={q.required}
                          onCheckedChange={(checked) =>
                            updateQuestion(idx, { required: checked })
                          }
                        />
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-400 hover:text-zinc-200"
                        onClick={() => moveQuestion(idx, -1)}
                        disabled={idx === 0}
                        title="Move Up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-400 hover:text-zinc-200"
                        onClick={() => moveQuestion(idx, 1)}
                        disabled={idx === questions.length - 1}
                        title="Move Down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-400 hover:text-red-400"
                        onClick={() => removeQuestion(idx)}
                        title="Delete Question"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-4">
                    <div className="sm:col-span-3">
                      <Input
                        className="h-8 text-xs bg-zinc-900/60 border-zinc-800 text-zinc-100 focus:border-zinc-600"
                        placeholder="Enter the question prompt..."
                        value={q.question}
                        onChange={(e) => updateQuestion(idx, { question: e.target.value })}
                      />
                    </div>
                    <div>
                      <select
                        className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-2 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                        value={q.type}
                        onChange={(e) =>
                          updateQuestion(idx, { type: e.target.value as QuestionType })
                        }
                      >
                        {QUESTION_TYPES.map((t) => (
                          <option key={t.value} value={t.value} className="bg-zinc-950 text-zinc-200">
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {q.type === 'choice' && (
                    <div className="pt-1">
                      <Input
                        className="h-8 text-xs bg-zinc-900/60 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600"
                        placeholder="Options separated by commas (e.g. Daily, Weekends, Casual)"
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

      {/* Card 5: Ticket Category & Staff Shield */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-zinc-100 font-medium">
                Discord Channel &amp; Staff Protection
              </CardTitle>
              <CardDescription className="text-xs text-zinc-400 mt-0.5">
                Target Discord category and staff exemptions.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="category-enabled-switch" className="text-xs text-zinc-300 font-normal">
                Category Active
              </Label>
              <Switch
                id="category-enabled-switch"
                checked={categoryEnabled}
                onCheckedChange={setCategoryEnabled}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300">Ticket Category ID</Label>
              <Input
                className="h-9 bg-zinc-950/60 border-zinc-800 font-mono text-xs text-zinc-100 focus:border-zinc-600"
                placeholder="e.g. 123456789012345678"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              />
              {categoryId.trim() !== '' && !/^\d{15,22}$/.test(categoryId.trim()) ? (
                <p className="text-[11px] text-amber-400">
                  Must be a valid 15-22 digit Discord ID.
                </p>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  Discord category snowflake where tickets are created.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-zinc-300">Category Label</Label>
              <Input
                className="h-9 bg-zinc-950/60 border-zinc-800 text-sm text-zinc-100 focus:border-zinc-600"
                placeholder="e.g. General Tickets"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
              />
              <p className="text-[11px] text-zinc-500">Internal label for this ticket sequence.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-zinc-300">
              Staff / Admin Discord User IDs
            </Label>
            <Input
              className="h-9 bg-zinc-950/60 border-zinc-800 font-mono text-xs text-zinc-100 focus:border-zinc-600"
              placeholder="e.g. 123456789012345678, 234567890123456789"
              value={staffUserIdsText}
              onChange={(e) => setStaffUserIdsText(e.target.value)}
            />
            <p className="text-[11px] text-zinc-500">
              Comma-separated user IDs. The assistant will never confuse these users with applicants when they chat in ticket channels.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Active Sessions Overview (if any) */}
      {activeSessions.length > 0 && (
        <Card className="border-zinc-800 bg-zinc-900/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-zinc-300">
                Active Ticket Channels
              </CardTitle>
              <Badge variant="outline" className="text-xs font-mono border-zinc-700 text-zinc-400">
                {activeSessions.length} active
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-800/80 rounded-md border border-zinc-800 bg-zinc-950/50">
              {activeSessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-2.5 text-xs text-zinc-300"
                >
                  <span className="font-mono text-zinc-400">#{s.channelId}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-500">{s.categoryName}</span>
                    <Badge variant="secondary" className="text-[10px] py-0 capitalize">
                      {s.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sticky Bottom Save Action */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/90 backdrop-blur-md p-3.5 shadow-lg">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Clock className="h-3.5 w-3.5 text-zinc-500" />
          <span>Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300">Ctrl+S</kbd> to save anytime</span>
        </div>

        <Button
          type="button"
          onClick={handleSaveAll}
          disabled={status.state === 'saving'}
          className="h-8 px-4 text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-900 transition-colors shadow-sm"
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {status.state === 'saving' ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
