'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  HelpCircle,
  ListOrdered,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  evaluateQuestionnaireProgress,
  validateAnswerValue,
  type AnswerPrimitive,
  type CategoryConfig,
  type ConditionOperator,
  type QuestionnaireQuestion,
  type QuestionType,
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

const QUESTION_TYPES: Array<{ value: QuestionType; label: string }> = [
  { value: 'text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text / Paragraph' },
  { value: 'choice', label: 'Multiple Choice (Select)' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean (Yes / No)' },
  { value: 'date', label: 'Date (YYYY-MM-DD)' },
  { value: 'player_tag', label: 'Identifier / Tag (#...)' },
];

const COMMUNITY_PRESETS: Array<{
  label: string;
  badge: string;
  question: QuestionnaireQuestion;
}> = [
  {
    label: 'Activity Level',
    badge: 'Popular',
    question: {
      key: 'how_often_active',
      question: 'How often are you usually active throughout the week?',
      type: 'text',
      required: true,
    },
  },
  {
    label: 'Expectations & Goals',
    badge: 'Recommended',
    question: {
      key: 'what_looking_for',
      question: 'What are you looking forward to most in our community?',
      type: 'text',
      required: true,
    },
  },
  {
    label: 'Reason for Joining',
    badge: 'Standard',
    question: {
      key: 'why_join',
      question: 'Why would you like to join our community?',
      type: 'long_text',
      required: true,
    },
  },
  {
    label: 'Staff Notes / Questions',
    badge: 'Optional',
    question: {
      key: 'notes_for_staff',
      question: 'Do you have any questions or notes for the moderation team?',
      type: 'text',
      required: false,
    },
  },
];

const FULL_COMMUNITY_ONBOARDING_TEMPLATE: QuestionnaireQuestion[] = [
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

export function QuestionBuilderClient({
  initialCategories,
}: {
  initialCategories: CategoryConfig[];
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();

  const [categories, setCategories] = useState<CategoryConfig[]>(initialCategories);
  const [selectedCatId, setSelectedCatId] = useState<string>(
    initialCategories[0]?.categoryId ?? ''
  );
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({});

  const selectedCategory =
    categories.find((c) => c.categoryId === selectedCatId) ?? null;

  function setQuestions(nextQuestions: QuestionnaireQuestion[]) {
    if (!selectedCategory) return;
    setCategories((prev) =>
      prev.map((c) =>
        c.categoryId === selectedCategory.categoryId
          ? { ...c, questions: nextQuestions }
          : c
      )
    );
  }

  function addQuestion(template?: QuestionnaireQuestion) {
    if (!selectedCategory) return;
    const idx = selectedCategory.questions.length + 1;
    const newQ: QuestionnaireQuestion = template
      ? { ...template }
      : {
          key: `field_${idx}`,
          question: 'What information would you like to provide?',
          type: 'text',
          required: true,
        };
    setQuestions([...selectedCategory.questions, newQ]);
  }

  function loadRecommendedCommunityTemplate() {
    if (!selectedCategory) return;
    setQuestions(FULL_COMMUNITY_ONBOARDING_TEMPLATE);
  }

  function updateQuestion(index: number, patch: Partial<QuestionnaireQuestion>) {
    if (!selectedCategory) return;
    const next = selectedCategory.questions.map((q, i) =>
      i === index ? { ...q, ...patch } : q
    );
    setQuestions(next);
  }

  function removeQuestion(index: number) {
    if (!selectedCategory) return;
    setQuestions(selectedCategory.questions.filter((_, i) => i !== index));
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    if (!selectedCategory) return;
    const target = index + direction;
    if (target < 0 || target >= selectedCategory.questions.length) return;
    const copy = [...selectedCategory.questions];
    const current = copy[index];
    const swap = copy[target];
    if (!current || !swap) return;
    copy[index] = swap;
    copy[target] = current;
    setQuestions(copy);
  }

  async function saveQuestionnaire() {
    if (!selectedCategory) return;
    await runSave(async () => {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedCategory),
      });
      const json = (await res.json()) as { category?: CategoryConfig; error?: string };
      if (!res.ok || !json.category) {
        throw new Error(json.error ?? 'Failed saving questionnaire');
      }
      setCategories((prev) =>
        prev.map((c) =>
          c.categoryId === json.category!.categoryId ? json.category! : c
        )
      );
      router.refresh();
      return `Published questionnaire v${json.category.configVersion} for "${json.category.categoryName}".`;
    });
  }

  // Evaluate live preview state using shared engine
  const validatedPreviewMap: Record<string, AnswerPrimitive> = {};
  const previewErrors: Record<string, string> = {};
  if (selectedCategory) {
    for (const q of selectedCategory.questions) {
      const raw = previewInputs[q.key];
      if (raw !== undefined && raw.trim() !== '') {
        const res = validateAnswerValue(q, raw);
        if (res.valid) {
          validatedPreviewMap[q.key] = res.normalizedValue;
        } else if (res.error) {
          previewErrors[q.key] = res.error;
        }
      }
    }
  }

  const previewProgress = selectedCategory
    ? evaluateQuestionnaireProgress(selectedCategory.questions, validatedPreviewMap)
    : null;

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      {/* Target Category Selector & Action Toolbar */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <ListOrdered className="h-5 w-5" />
          </div>
          <div>
            <Label htmlFor="catSelector" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Active Category
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <select
                id="catSelector"
                className="h-9 rounded-lg border border-border/60 bg-muted/30 px-3 text-sm font-medium focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                value={selectedCatId}
                onChange={(e) => {
                  setSelectedCatId(e.target.value);
                  setPreviewInputs({});
                }}
              >
                {categories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId} className="bg-background text-foreground">
                    {c.categoryName} (v{c.configVersion}) • {c.questions.length} questions
                  </option>
                ))}
              </select>
              {selectedCategory && (
                <Badge variant={selectedCategory.enabled ? 'success' : 'secondary'} className="h-7 text-xs">
                  {selectedCategory.enabled ? 'Enabled in Category' : 'Disabled'}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-border/60 bg-background/50 hover:bg-muted/40"
            onClick={() => addQuestion()}
            disabled={!selectedCategory}
          >
            <Plus className="mr-2 h-4 w-4 text-primary" />
            Custom Question
          </Button>
          <Button
            type="button"
            className="shadow-sm shadow-primary/20 hover:shadow-primary/40 transition-all"
            onClick={saveQuestionnaire}
            disabled={!selectedCategory}
          >
            <Save className="mr-2 h-4 w-4" />
            Publish Questionnaire
          </Button>
        </div>
      </div>

      {!selectedCategory ? (
        <Card className="glass-card border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No categories detected yet. Create a category in Category Management first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Quick-Add Presets Bar */}
          <div className="glass-panel p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Quick-Add Community Presets
                </span>
                <span className="text-xs text-muted-foreground/70 hidden md:inline">
                  (1-click to append to active questionnaire)
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-primary hover:bg-primary/10 border border-primary/20"
                onClick={loadRecommendedCommunityTemplate}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Load Full Community Template (4 Questions)
              </Button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {COMMUNITY_PRESETS.map((preset) => (
                <button
                  key={preset.question.key}
                  type="button"
                  onClick={() => addQuestion(preset.question)}
                  className="group flex flex-col items-start gap-1 rounded-lg border border-border/50 bg-background/40 p-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm"
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary">
                      {preset.label}
                    </span>
                    <Badge variant="outline" className="text-[10px] py-0 px-1 border-primary/30 text-primary">
                      {preset.badge}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">
                    &ldquo;{preset.question.question}&rdquo;
                  </p>
                  <span className="mt-1 text-[10px] font-mono text-muted-foreground/80 flex items-center gap-1">
                    <Plus className="h-3 w-3 text-primary" /> key: {preset.question.key}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            {/* Questions List Column */}
            <div className="space-y-4 lg:col-span-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium text-foreground">
                  Configured Intake Sequence ({selectedCategory.questions.length})
                </span>
                <span className="text-xs text-muted-foreground">
                  The bot asks these naturally in conversational flow
                </span>
              </div>

              {selectedCategory.questions.length === 0 ? (
                <Card className="glass-card border-dashed">
                  <CardContent className="py-12 text-center space-y-3">
                    <HelpCircle className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="text-sm font-medium text-foreground">No questions configured yet</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Use the quick-add buttons above or click &ldquo;Load Full Community Template&rdquo; to start onboarding members in seconds.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={loadRecommendedCommunityTemplate}
                      className="mt-2"
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Apply Recommended Questions
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                selectedCategory.questions.map((q, index) => (
                  <Card key={`${q.key}-${index}`} className="glass-card border border-border/60 hover:border-border transition-all">
                    <CardHeader className="pb-3 border-b border-border/40 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary font-mono text-xs font-bold border border-primary/20">
                            {index + 1}
                          </span>
                          <span className="font-mono text-xs font-semibold text-foreground">
                            {q.key}
                          </span>
                          <Badge
                            variant={q.required ? 'default' : 'secondary'}
                            className="text-[10px] h-5"
                          >
                            {q.required ? 'Required' : 'Optional'}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] h-5 font-mono text-muted-foreground">
                            {q.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => moveQuestion(index, -1)}
                            disabled={index === 0}
                            title="Move Up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => moveQuestion(index, 1)}
                            disabled={index === selectedCategory.questions.length - 1}
                            title="Move Down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeQuestion(index)}
                            title="Remove Question"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4 pt-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Field Identifier</Label>
                          <Input
                            className="font-mono text-xs bg-muted/30 border-border/60"
                            value={q.key}
                            onChange={(e) =>
                              updateQuestion(index, {
                                key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                              })
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Data Type</Label>
                          <select
                            className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
                            value={q.type}
                            onChange={(e) =>
                              updateQuestion(index, { type: e.target.value as QuestionType })
                            }
                          >
                            {QUESTION_TYPES.map((qt) => (
                              <option key={qt.value} value={qt.value} className="bg-background text-foreground">
                                {qt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                          <div>
                            <Label className="text-xs font-medium cursor-pointer">Required</Label>
                            <p className="text-[10px] text-muted-foreground">Must be answered</p>
                          </div>
                          <Switch
                            checked={q.required}
                            onCheckedChange={(checked) =>
                              updateQuestion(index, { required: checked })
                            }
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Conversational Prompt / Question</Label>
                        <Input
                          className="bg-muted/30 border-border/60 text-sm"
                          placeholder="e.g. How often are you usually active throughout the week?"
                          value={q.question}
                          onChange={(e) => updateQuestion(index, { question: e.target.value })}
                        />
                      </div>

                      {q.type === 'choice' && (
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Allowed Options (comma-separated)</Label>
                          <Input
                            className="bg-muted/30 border-border/60 text-xs"
                            placeholder="Casual, Competitive, Daily, Weekends Only"
                            value={(q.choices ?? []).join(', ')}
                            onChange={(e) =>
                              updateQuestion(index, {
                                choices: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </div>
                      )}

                      {/* Custom Validation & Regex */}
                      <div className="grid gap-3 rounded-lg border border-border/40 bg-muted/10 p-3 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Validation Regex (Optional)</Label>
                          <Input
                            className="font-mono text-xs bg-muted/20 border-border/50"
                            placeholder="e.g. ^[0-9]+$"
                            value={q.validation?.regex ?? ''}
                            onChange={(e) =>
                              updateQuestion(index, {
                                validation: {
                                  ...q.validation,
                                  regex: e.target.value || undefined,
                                },
                              })
                            }
                          />
                        </div>

                        {q.type === 'number' ? (
                          <>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Min</Label>
                              <Input
                                type="number"
                                className="font-mono text-xs bg-muted/20 border-border/50"
                                value={q.validation?.min ?? ''}
                                onChange={(e) =>
                                  updateQuestion(index, {
                                    validation: {
                                      ...q.validation,
                                      min: e.target.value === '' ? undefined : Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Max</Label>
                              <Input
                                type="number"
                                className="font-mono text-xs bg-muted/20 border-border/50"
                                value={q.validation?.max ?? ''}
                                onChange={(e) =>
                                  updateQuestion(index, {
                                    validation: {
                                      ...q.validation,
                                      max: e.target.value === '' ? undefined : Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            </div>
                          </>
                        ) : (
                          <div className="space-y-1 sm:col-span-2">
                            <Label className="text-[11px] text-muted-foreground">Error Hint</Label>
                            <Input
                              className="text-xs bg-muted/20 border-border/50"
                              placeholder="Friendly correction if answer is invalid"
                              value={q.validation?.customError ?? ''}
                              onChange={(e) =>
                                updateQuestion(index, {
                                  validation: {
                                    ...q.validation,
                                    customError: e.target.value || undefined,
                                  },
                                })
                              }
                            />
                          </div>
                        )}
                      </div>

                      {/* Conditional Branching */}
                      <div className="grid gap-3 rounded-lg border border-border/40 bg-muted/10 p-3 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Depends On Key (Optional)</Label>
                          <Input
                            className="font-mono text-xs bg-muted/20 border-border/50"
                            placeholder="e.g. why_join"
                            value={q.condition?.dependsOnKey ?? ''}
                            onChange={(e) => {
                              const dep = e.target.value.trim();
                              if (!dep) {
                                updateQuestion(index, { condition: undefined });
                              } else {
                                updateQuestion(index, {
                                  condition: {
                                    dependsOnKey: dep,
                                    operator: q.condition?.operator ?? 'equals',
                                    value: q.condition?.value ?? 'true',
                                  },
                                });
                              }
                            }}
                          />
                        </div>

                        {q.condition && (
                          <>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Operator</Label>
                              <select
                                className="h-9 w-full rounded-md border border-border/50 bg-background px-2 text-xs"
                                value={q.condition.operator}
                                onChange={(e) =>
                                  updateQuestion(index, {
                                    condition: {
                                      ...q.condition!,
                                      operator: e.target.value as ConditionOperator,
                                    },
                                  })
                                }
                              >
                                <option value="equals">equals</option>
                                <option value="not_equals">not_equals</option>
                                <option value="contains">contains</option>
                                <option value="truthy">truthy</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Comparison Value</Label>
                              <Input
                                className="text-xs bg-muted/20 border-border/50"
                                value={String(q.condition.value ?? '')}
                                onChange={(e) =>
                                  updateQuestion(index, {
                                    condition: {
                                      ...q.condition!,
                                      value: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {/* Live Questionnaire Simulator Preview */}
            <div className="lg:col-span-2">
              <Card className="glass-card sticky top-20 border border-primary/20 shadow-lg shadow-primary/5">
                <CardHeader className="pb-3 border-b border-border/40">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                      <Play className="h-4 w-4 text-primary" />
                      Live Questionnaire Simulator
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary font-mono">
                      Real-Time Evaluator
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Simulate how the conversational AI validates answers and detects completion before generating staff reports.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4 pt-4">
                  {previewProgress && (
                    <>
                      {/* Completion Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Intake Completion</span>
                          <span className="font-mono font-medium text-foreground">
                            {previewProgress.answeredQuestions.length} / {previewProgress.activeQuestions.length}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              previewProgress.isComplete ? 'bg-emerald-500' : 'bg-primary'
                            }`}
                            style={{
                              width: `${
                                previewProgress.activeQuestions.length > 0
                                  ? (previewProgress.answeredQuestions.length /
                                      previewProgress.activeQuestions.length) *
                                    100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs">
                        <span>
                          Active Fields: <strong className="font-mono">{previewProgress.activeQuestions.length}</strong>
                        </span>
                        <Badge
                          variant={previewProgress.isComplete ? 'success' : 'secondary'}
                          className="text-[10px]"
                        >
                          {previewProgress.isComplete
                            ? 'Ready for Moderator Report'
                            : `${previewProgress.missingRequiredQuestions.length} Required Missing`}
                        </Badge>
                      </div>

                      {/* Interactive Fields */}
                      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                        {previewProgress.activeQuestions.map((aq) => (
                          <div
                            key={aq.key}
                            className={`space-y-1.5 rounded-lg border p-3 transition-colors ${
                              validatedPreviewMap[aq.key] !== undefined
                                ? 'border-emerald-500/30 bg-emerald-500/5'
                                : 'border-border/40 bg-muted/15'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-medium text-foreground">
                                {aq.question}
                              </Label>
                              <Badge
                                variant={aq.required ? 'default' : 'outline'}
                                className="text-[9px] py-0 px-1"
                              >
                                {aq.required ? 'Req' : 'Opt'}
                              </Badge>
                            </div>

                            <Input
                              className="text-xs bg-background border-border/50 h-8"
                              placeholder={`Type sample response for ${aq.key}...`}
                              value={previewInputs[aq.key] ?? ''}
                              onChange={(e) =>
                                setPreviewInputs((prev) => ({
                                  ...prev,
                                  [aq.key]: e.target.value,
                                }))
                              }
                            />

                            {previewErrors[aq.key] && (
                              <p className="text-[11px] text-destructive flex items-center gap-1">
                                ⚠ {previewErrors[aq.key]}
                              </p>
                            )}

                            {validatedPreviewMap[aq.key] !== undefined && (
                              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                                <CheckCircle2 className="h-3 w-3" /> Normalized: &quot;{String(validatedPreviewMap[aq.key])}&quot;
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {previewProgress.nextRecommendedQuestion && (
                        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs space-y-1">
                          <span className="font-semibold text-primary uppercase text-[10px] tracking-wider block">
                            Next Question Assistant Will Ask:
                          </span>
                          <p className="text-foreground italic">
                            &ldquo;{previewProgress.nextRecommendedQuestion.question}&rdquo;
                          </p>
                        </div>
                      )}

                      {previewProgress.isComplete && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1 text-emerald-600 dark:text-emerald-400">
                          <span className="font-semibold uppercase text-[10px] tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> All Required Information Collected!
                          </span>
                          <p className="text-xs text-foreground/80">
                            The assistant will transition to natural open-ended chat and notify the human moderation team with the structured summary.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
