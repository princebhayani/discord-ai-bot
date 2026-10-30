'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Play, Plus, Save, Trash2 } from 'lucide-react';
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
  { value: 'player_tag', label: 'Player Tag (#ABC123)' },
  { value: 'text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text / Description' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean (Yes / No)' },
  { value: 'choice', label: 'Choice (Select Options)' },
  { value: 'date', label: 'Date (YYYY-MM-DD)' },
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

  function addQuestion() {
    if (!selectedCategory) return;
    const idx = selectedCategory.questions.length + 1;
    const newQ: QuestionnaireQuestion = {
      key: `field_${idx}`,
      question: 'What information would you like to provide?',
      type: 'text',
      required: true,
    };
    setQuestions([...selectedCategory.questions, newQ]);
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

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <Label htmlFor="catSelector">Target Category:</Label>
          <select
            id="catSelector"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedCatId}
            onChange={(e) => {
              setSelectedCatId(e.target.value);
              setPreviewInputs({});
            }}
          >
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>
                {c.categoryName} (v{c.configVersion})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={addQuestion} disabled={!selectedCategory}>
            <Plus className="h-4 w-4" />
            Add Question
          </Button>
          <Button type="button" onClick={saveQuestionnaire} disabled={!selectedCategory}>
            <Save className="h-4 w-4" />
            Publish Questionnaire
          </Button>
        </div>
      </div>

      {!selectedCategory ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Create a category in Category Management first to configure its dynamic questionnaire.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Builder Column */}
          <div className="space-y-4 lg:col-span-3">
            {selectedCategory.questions.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No questions added yet. Click &ldquo;Add Question&rdquo; above to build your flow.
                </CardContent>
              </Card>
            ) : (
              selectedCategory.questions.map((q, index) => (
                <Card key={index}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">#{index + 1}</Badge>
                        <CardTitle className="text-base">{q.key}</CardTitle>
                        <Badge variant={q.required ? 'default' : 'secondary'}>
                          {q.required ? 'Required' : 'Optional'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveQuestion(index, -1)}
                          disabled={index === 0}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => moveQuestion(index, 1)}
                          disabled={index === selectedCategory.questions.length - 1}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeQuestion(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Field Key (snake_case)</Label>
                        <Input
                          value={q.key}
                          onChange={(e) =>
                            updateQuestion(index, {
                              key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                            })
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>Question Type</Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={q.type}
                          onChange={(e) =>
                            updateQuestion(index, { type: e.target.value as QuestionType })
                          }
                        >
                          {QUESTION_TYPES.map((qt) => (
                            <option key={qt.value} value={qt.value}>
                              {qt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                        <Label>Required</Label>
                        <Switch
                          checked={q.required}
                          onCheckedChange={(checked) =>
                            updateQuestion(index, { required: checked })
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Conversational Prompt</Label>
                      <Input
                        value={q.question}
                        onChange={(e) => updateQuestion(index, { question: e.target.value })}
                      />
                    </div>

                    {q.type === 'choice' && (
                      <div className="space-y-1.5">
                        <Label>Allowed Choices (comma-separated)</Label>
                        <Input
                          placeholder="War Issue, Recruitment, Promotion, Other"
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

                    {/* Custom Validation */}
                    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Custom Regex (Optional)</Label>
                        <Input
                          placeholder="e.g. ^#[0289PYLQGRJCUV]+$"
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
                            <Label className="text-xs">Min Value</Label>
                            <Input
                              type="number"
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
                            <Label className="text-xs">Max Value</Label>
                            <Input
                              type="number"
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
                          <Label className="text-xs">Custom Validation Message</Label>
                          <Input
                            placeholder="Shown if answer fails validation"
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

                    {/* Conditional Logic */}
                    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Depends On Key (Conditional)</Label>
                        <Input
                          placeholder="Leave empty for always active"
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
                            <Label className="text-xs">Operator</Label>
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
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
                            <Label className="text-xs">Comparison Value</Label>
                            <Input
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
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play className="h-4 w-4 text-primary" />
                  Live Questionnaire Preview
                </CardTitle>
                <CardDescription>
                  Test validation rules, conditional branching, and completion detection in real
                  time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewProgress && (
                  <>
                    <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                      <span>
                        Active Questions: <strong>{previewProgress.activeQuestions.length}</strong>
                      </span>
                      <Badge variant={previewProgress.isComplete ? 'success' : 'secondary'}>
                        {previewProgress.isComplete
                          ? 'Ready for Moderator Report'
                          : `${previewProgress.missingRequiredQuestions.length} Required Remaining`}
                      </Badge>
                    </div>

                    {previewProgress.activeQuestions.map((aq) => (
                      <div key={aq.key} className="space-y-1.5">
                        <Label className="text-xs">
                          {aq.question}{' '}
                          <span className="text-muted-foreground">
                            ({aq.type}
                            {aq.required ? ', required' : ', optional'})
                          </span>
                        </Label>
                        <Input
                          placeholder={`Sample ${aq.key}...`}
                          value={previewInputs[aq.key] ?? ''}
                          onChange={(e) =>
                            setPreviewInputs((prev) => ({
                              ...prev,
                              [aq.key]: e.target.value,
                            }))
                          }
                        />
                        {previewErrors[aq.key] && (
                          <p className="text-xs text-destructive">{previewErrors[aq.key]}</p>
                        )}
                        {validatedPreviewMap[aq.key] !== undefined && (
                          <p className="text-xs text-emerald-700">
                            Normalized: <code>{String(validatedPreviewMap[aq.key])}</code>
                          </p>
                        )}
                      </div>
                    ))}

                    {previewProgress.nextRecommendedQuestion && (
                      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
                        <strong>Next question AI will ask:</strong>{' '}
                        {previewProgress.nextRecommendedQuestion.question}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

