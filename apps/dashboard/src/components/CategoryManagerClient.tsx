'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  FolderOpen,
  FolderPlus,
  HelpCircle,
  Layers,
  Plus,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { CategoryConfig, FaqItem, ServerSettings } from '@hrbot/shared';
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

export function CategoryManagerClient({
  initialServerSettings,
  initialCategories,
}: {
  initialServerSettings: ServerSettings;
  initialCategories: CategoryConfig[];
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();

  const [guildName, setGuildName] = useState(initialServerSettings.guildName);
  const [botEnabled, setBotEnabled] = useState(initialServerSettings.botEnabled);
  const [defaultWelcome, setDefaultWelcome] = useState(
    initialServerSettings.defaultWelcomeMessage
  );

  const [categories, setCategories] = useState<CategoryConfig[]>(initialCategories);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    initialCategories[0]?.categoryId ?? ''
  );

  const [newCategoryId, setNewCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');

  const selectedCategory =
    categories.find((c) => c.categoryId === selectedCategoryId) ?? null;

  async function saveServerDefaults() {
    await runSave(async () => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guildName,
          botEnabled,
          defaultWelcomeMessage: defaultWelcome,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed saving server settings');
      router.refresh();
      return 'Saved server introduction and global assistant state.';
    });
  }

  function handleAddCategory() {
    const trimmedId = newCategoryId.trim();
    const trimmedName = newCategoryName.trim();
    if (!/^\d{15,22}$/.test(trimmedId) || !trimmedName) {
      return;
    }
    if (categories.some((c) => c.categoryId === trimmedId)) {
      setSelectedCategoryId(trimmedId);
      return;
    }
    const created: CategoryConfig = {
      guildId: initialServerSettings.guildId,
      categoryId: trimmedId,
      categoryName: trimmedName,
      enabled: true,
      welcomeMessage: '',
      categoryInstructions: '',
      faqs: [],
      questions: [],
      playerLookupEnabled: false,
      reportChannelOverrideId: '',
      configVersion: 1,
    };
    setCategories((prev) => [...prev, created]);
    setSelectedCategoryId(trimmedId);
    setNewCategoryId('');
    setNewCategoryName('');
  }

  function updateSelected(patch: Partial<CategoryConfig>) {
    if (!selectedCategory) return;
    setCategories((prev) =>
      prev.map((c) =>
        c.categoryId === selectedCategory.categoryId ? { ...c, ...patch } : c
      )
    );
  }

  function addFaq() {
    if (!selectedCategory) return;
    const nextFaq: FaqItem = {
      id: `faq_${Date.now()}`,
      question: 'Common inquiry?',
      answer: 'Helpful, concise answer for the AI to cite.',
    };
    updateSelected({ faqs: [...selectedCategory.faqs, nextFaq] });
  }

  function updateFaq(id: string, patch: Partial<FaqItem>) {
    if (!selectedCategory) return;
    updateSelected({
      faqs: selectedCategory.faqs.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function removeFaq(id: string) {
    if (!selectedCategory) return;
    updateSelected({
      faqs: selectedCategory.faqs.filter((f) => f.id !== id),
    });
  }

  async function publishSelectedCategory() {
    if (!selectedCategory) return;
    await runSave(async () => {
      const res = await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedCategory),
      });
      const json = (await res.json()) as { category?: CategoryConfig; error?: string };
      if (!res.ok || !json.category) {
        throw new Error(json.error ?? 'Failed publishing category');
      }
      setCategories((prev) =>
        prev.map((c) =>
          c.categoryId === json.category!.categoryId ? json.category! : c
        )
      );
      router.refresh();
      return `Published "${json.category.categoryName}" (v${json.category.configVersion}). Active tickets keep their frozen snapshot.`;
    });
  }

  async function deleteSelectedCategory() {
    if (!selectedCategory) return;
    await runSave(async () => {
      const res = await fetch(
        `/api/categories?categoryId=${encodeURIComponent(selectedCategory.categoryId)}`,
        { method: 'DELETE' }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed deleting category');
      const remaining = categories.filter(
        (c) => c.categoryId !== selectedCategory.categoryId
      );
      setCategories(remaining);
      setSelectedCategoryId(remaining[0]?.categoryId ?? '');
      router.refresh();
      return 'Removed category configuration.';
    });
  }

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      {/* Server-Wide Introduction Defaults */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                Global Assistant & Server Introduction
              </CardTitle>
              <CardDescription className="text-xs">
                Default welcoming message sent once when an eligible ticket opens. Can be overridden per-category below.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={botEnabled ? 'success' : 'secondary'} className="text-xs">
                {botEnabled ? 'Global Assistant Active' : 'Global Assistant Paused'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="guildName" className="text-xs text-muted-foreground">
                Discord Server Name
              </Label>
              <Input
                id="guildName"
                className="bg-muted/30 border-border/60"
                value={guildName}
                onChange={(e) => setGuildName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
              <div>
                <p className="text-xs font-medium text-foreground">Global Conversation Switch</p>
                <p className="text-[11px] text-muted-foreground">
                  Pause assistant across all categories without taking the bot offline
                </p>
              </div>
              <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="defaultWelcome" className="text-xs text-muted-foreground">
              Server-Wide Default Welcome Message
            </Label>
            <Textarea
              id="defaultWelcome"
              rows={3}
              className="bg-muted/30 border-border/60 text-sm font-sans"
              placeholder="e.g. Hello! Welcome to the server. How can we help you today?"
              value={defaultWelcome}
              onChange={(e) => setDefaultWelcome(e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-1">
            <Button
              onClick={saveServerDefaults}
              className="shadow-sm shadow-primary/20 hover:shadow-primary/40"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Server Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Category List & Configuration */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Categories List */}
        <Card className="glass-card border border-border/60 lg:col-span-1">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-primary" />
                Ticket Categories ({categories.length})
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Categories managed by your Discord ticket system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No categories added yet.</p>
              ) : (
                categories.map((cat) => (
                  <button
                    key={cat.categoryId}
                    type="button"
                    onClick={() => setSelectedCategoryId(cat.categoryId)}
                    className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-all ${
                      selectedCategoryId === cat.categoryId
                        ? 'border-primary/60 bg-primary/10 shadow-sm'
                        : 'border-border/40 bg-muted/15 hover:border-border/70 hover:bg-muted/30'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {cat.categoryName}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground truncate">
                        ID: {cat.categoryId}
                      </p>
                      <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                        v{cat.configVersion} • {cat.questions.length} questions
                      </p>
                    </div>
                    <Badge
                      variant={cat.enabled ? 'success' : 'secondary'}
                      className="text-[10px] shrink-0"
                    >
                      {cat.enabled ? 'Active' : 'Muted'}
                    </Badge>
                  </button>
                ))
              )}
            </div>

            {/* Quick Add Category Card */}
            <div className="space-y-2 rounded-xl border border-dashed border-border/60 bg-muted/20 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <FolderPlus className="h-3.5 w-3.5 text-primary" />
                <span>Register Category</span>
              </div>
              <Input
                className="text-xs bg-background border-border/60 font-mono"
                placeholder="Discord Category ID (17-20 digits)"
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
              />
              <Input
                className="text-xs bg-background border-border/60"
                placeholder="Category Name (e.g. Join Requests)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs border-border/60 hover:bg-primary/10 hover:text-primary"
                onClick={handleAddCategory}
                disabled={!/^\d{15,22}$/.test(newCategoryId.trim()) || !newCategoryName.trim()}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Category
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Category Editor */}
        <Card className="glass-card border border-border/60 lg:col-span-2">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-sm font-semibold">
                  {selectedCategory
                    ? `Configure: ${selectedCategory.categoryName} (v${selectedCategory.configVersion})`
                    : 'Select or Add a Category'}
                </CardTitle>
                <CardDescription className="text-xs">
                  Fine-tune AI activation, category instructions, welcome overrides, and FAQs.
                </CardDescription>
              </div>
              {selectedCategory && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                    Snapshot v{selectedCategory.configVersion}
                  </Badge>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            {!selectedCategory ? (
              <div className="py-16 text-center space-y-2">
                <FolderOpen className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm font-medium text-foreground">No Category Selected</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Select an existing category on the left or register a new Discord Category ID to edit its rules.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Category Name</Label>
                    <Input
                      className="bg-muted/30 border-border/60 text-sm"
                      value={selectedCategory.categoryName}
                      onChange={(e) => updateSelected({ categoryName: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                    <div>
                      <p className="text-xs font-medium text-foreground">Enable AI in Category</p>
                      <p className="text-[11px] text-muted-foreground">
                        Tickets here trigger the conversational assistant
                      </p>
                    </div>
                    <Switch
                      checked={selectedCategory.enabled}
                      onCheckedChange={(checked) => updateSelected({ enabled: checked })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Report Channel Override ID (Optional)</Label>
                  <Input
                    className="bg-muted/30 border-border/60 font-mono text-xs"
                    placeholder="Optional staff channel Snowflake ID for transcripts from this category"
                    value={selectedCategory.reportChannelOverrideId ?? ''}
                    onChange={(e) =>
                      updateSelected({ reportChannelOverrideId: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Category Welcome Message Override (Optional)
                  </Label>
                  <Textarea
                    rows={2}
                    className="bg-muted/30 border-border/60 text-sm font-sans"
                    placeholder="Leave empty to use server-wide welcome introduction..."
                    value={selectedCategory.welcomeMessage ?? ''}
                    onChange={(e) => updateSelected({ welcomeMessage: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Category AI Guidance / Instructions</Label>
                  <Textarea
                    rows={2}
                    className="bg-muted/30 border-border/60 text-sm font-sans"
                    placeholder="e.g. Welcome new applicants warmly, ask what role they are looking for..."
                    value={selectedCategory.categoryInstructions}
                    onChange={(e) => updateSelected({ categoryInstructions: e.target.value })}
                  />
                </div>

                {/* FAQs Accordion / List */}
                <div className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Category FAQs ({selectedCategory.faqs.length})
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Verified knowledge the assistant references when members ask questions.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-border/60 hover:bg-primary/10 hover:text-primary"
                      onClick={addFaq}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add FAQ
                    </Button>
                  </div>

                  {selectedCategory.faqs.length === 0 ? (
                    <p className="text-xs text-muted-foreground/70 italic text-center py-2">
                      No FAQs configured for this category yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedCategory.faqs.map((faq) => (
                        <div
                          key={faq.id}
                          className="space-y-2 rounded-lg border border-border/50 bg-background/50 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Input
                              className="text-xs bg-muted/20 border-border/50 font-medium"
                              value={faq.question}
                              placeholder="Question (e.g. When are community events?)"
                              onChange={(e) => updateFaq(faq.id, { question: e.target.value })}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                              onClick={() => removeFaq(faq.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <Textarea
                            rows={2}
                            className="text-xs bg-muted/20 border-border/50 font-sans"
                            value={faq.answer}
                            placeholder="Helpful answer the AI should cite..."
                            onChange={(e) => updateFaq(faq.id, { answer: e.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between pt-3 border-t border-border/40">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="text-xs"
                    onClick={deleteSelectedCategory}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete Category
                  </Button>

                  <Button
                    type="button"
                    onClick={publishSelectedCategory}
                    className="shadow-sm shadow-primary/20 hover:shadow-primary/40 text-xs"
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Publish Category Snapshot
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
