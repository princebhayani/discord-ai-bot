'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';
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
      enabled: false,
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
      question: 'Common question?',
      answer: 'Helpful answer.',
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
      return `Published "${json.category.categoryName}" (v${json.category.configVersion}). Active tickets keep prior snapshot.`;
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

      {/* Server-Wide Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Server Introduction & Global Assistant State</CardTitle>
          <CardDescription>
            Default welcome introduction sent once when an eligible ticket opens (can be overridden
            per category below).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="guildName">Server Display Name</Label>
              <Input
                id="guildName"
                value={guildName}
                onChange={(e) => setGuildName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Global AI Assistant</p>
                <p className="text-xs text-muted-foreground">
                  Pause all new ticket sessions without disconnecting the bot
                </p>
              </div>
              <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultWelcome">Default Welcome Introduction</Label>
            <Textarea
              id="defaultWelcome"
              rows={4}
              value={defaultWelcome}
              onChange={(e) => setDefaultWelcome(e.target.value)}
            />
          </div>

          <Button onClick={saveServerDefaults}>
            <Save className="h-4 w-4" />
            Save Server Introduction
          </Button>
        </CardContent>
      </Card>

      {/* Category List & Editor */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Ticket Categories</CardTitle>
            <CardDescription>
              Register existing Discord category IDs managed by your ticket bot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {categories.map((cat) => (
                <button
                  key={cat.categoryId}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.categoryId)}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                    selectedCategoryId === cat.categoryId
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{cat.categoryName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{cat.categoryId}</p>
                  </div>
                  <Badge variant={cat.enabled ? 'success' : 'secondary'}>
                    {cat.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </button>
              ))}
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Add Existing Discord Category
              </p>
              <Input
                placeholder="Discord Category ID (17-20 digits)"
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
              />
              <Input
                placeholder="Category Name (e.g. Player Support)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleAddCategory}
              >
                <Plus className="h-4 w-4" />
                Add Category
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {selectedCategory
                ? `Configure: ${selectedCategory.categoryName} (v${selectedCategory.configVersion})`
                : 'Select or Add a Category'}
            </CardTitle>
            <CardDescription>
              Control AI activation, custom welcome message, category instructions, and FAQs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedCategory ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Select a category on the left or register a Discord Category ID to begin.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Category Name</Label>
                    <Input
                      value={selectedCategory.categoryName}
                      onChange={(e) => updateSelected({ categoryName: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Enable AI in Category</p>
                      <p className="text-xs text-muted-foreground">
                        Only enabled categories trigger conversations
                      </p>
                    </div>
                    <Switch
                      checked={selectedCategory.enabled}
                      onCheckedChange={(checked) => updateSelected({ enabled: checked })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Allow Player-Data Bot Lookups</p>
                      <p className="text-xs text-muted-foreground">
                        Permit approved player/clan lookups in this category
                      </p>
                    </div>
                    <Switch
                      checked={selectedCategory.playerLookupEnabled}
                      onCheckedChange={(checked) =>
                        updateSelected({ playerLookupEnabled: checked })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Report Channel Override ID (Optional)</Label>
                    <Input
                      placeholder="Pre-existing staff channel Snowflake ID"
                      value={selectedCategory.reportChannelOverrideId ?? ''}
                      onChange={(e) =>
                        updateSelected({ reportChannelOverrideId: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Category Welcome Message Override (Optional)</Label>
                  <Textarea
                    rows={3}
                    placeholder="Leave blank to use the server default welcome introduction..."
                    value={selectedCategory.welcomeMessage ?? ''}
                    onChange={(e) => updateSelected({ welcomeMessage: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Category-Specific AI Instructions</Label>
                  <Textarea
                    rows={3}
                    placeholder="e.g., Ask politely about war attacks or recruitment requirements..."
                    value={selectedCategory.categoryInstructions}
                    onChange={(e) => updateSelected({ categoryInstructions: e.target.value })}
                  />
                </div>

                {/* FAQs */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Category FAQs</p>
                      <p className="text-xs text-muted-foreground">
                        Verified answers the AI may reference while collecting ticket details.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addFaq}>
                      <Plus className="h-4 w-4" />
                      Add FAQ
                    </Button>
                  </div>

                  {selectedCategory.faqs.map((faq) => (
                    <div key={faq.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={faq.question}
                          placeholder="Question"
                          onChange={(e) => updateFaq(faq.id, { question: e.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeFaq(faq.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <Textarea
                        rows={2}
                        value={faq.answer}
                        placeholder="Approved answer"
                        onChange={(e) => updateFaq(faq.id, { answer: e.target.value })}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button type="button" onClick={publishSelectedCategory}>
                    <Save className="h-4 w-4" />
                    Publish Category Version
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={deleteSelectedCategory}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Category
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

