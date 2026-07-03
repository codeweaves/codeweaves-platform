'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Save, RotateCcw, ChevronDown, Loader2, RotateCw, ExternalLink, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  agentAiConfigUpdateSchema,
  defaultWidgetTheme,
  voiceConfigSchema,
} from '@repo/validation';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSidebar } from '@/components/ui/sidebar';
import { usePageHeader } from '@/components/layout/page-header';
import { useApiClient } from '@/lib/api-client';
import { useUpdateAgent, type Agent } from '@/hooks/use-agents';
import { useUpdateAgentTheme, useResetAgentTheme } from '@/hooks/use-agent-theme';
import { useUnsavedChangesWarning } from '@/hooks/use-unsaved-changes-warning';
import {
  agentEditorConfigQueryKey,
  type AgentEditorConfigResponse,
} from '@/hooks/use-agent-editor-config';
import { EmbedCodeDialog } from '../embed-code-dialog';
import { AgentEditorSidebar, type CategoryId } from './agent-editor-sidebar';
import { AgentEditorForm } from './agent-editor-form';
import { AgentPreview, type PreviewMessage } from './agent-preview';
import {
  AgentEditorProvider,
  useAgentEditor,
  agentToFormData,
  toPreviewFormData,
  type AgentFormData,
  type InitialAgentKnowledge,
  type EditorDataField,
} from './agent-editor-context';

// Inner component that uses context
function AgentEditorContent() {
  const {
    agent,
    formData,
    savedFormData,
    themeData,
    hasThemeChanges,
    hasUnsavedChanges,
    resetToSaved,
    markSaved,
    setFieldErrors,
  } = useAgentEditor();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const updateAgent = useUpdateAgent();
  const updateTheme = useUpdateAgentTheme();
  const resetTheme = useResetAgentTheme();
  const { setOpen, open } = useSidebar();
  const { setTitle, setActions } = usePageHeader();
  const router = useRouter();

  const [selectedCategory, setSelectedCategory] =
    useState<CategoryId>('general');
  const [status, setStatus] = useState(agent.status);
  const [statusPending, setStatusPending] = useState(false);
  const [pendingDirection, setPendingDirection] = useState<'activating' | 'deactivating' | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetDefaultsOpen, setResetDefaultsOpen] = useState(false);

  // Preview conversation state — holds ONLY the simulated exchange (user
  // messages + mock AI replies). The greeting is NOT stored here; it's derived
  // from `welcomeMessage` and prepended for display, so an empty welcome shows
  // no greeting bubble — matching the live widget.
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([]);

  // Scrollbar visibility for form area
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const aiReplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collapse main sidebar on mount, restore on unmount.
  // `open` is intentionally captured once at mount — deps are [] so the closure is stable.
  useEffect(() => {
    const previousState = open;
    setOpen(false);
    return () => {
      setOpen(previousState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable ref for toggle handler to avoid infinite re-render loop in setActions effect
  const toggleRef = useRef<(checked: boolean) => void>(undefined);
  toggleRef.current = async (checked: boolean) => {
    const newStatus = checked ? 'ACTIVE' : 'INACTIVE';
    try {
      setStatusPending(true);
      setPendingDirection(checked ? 'activating' : 'deactivating');
      await updateAgent.mutateAsync({
        id: agent.id,
        data: { status: newStatus },
      });
      setStatus(newStatus as 'ACTIVE' | 'INACTIVE');
      toast.success(checked ? 'Agent activated' : 'Agent deactivated');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setStatusPending(false);
      setPendingDirection(null);
    }
  };

  // Set page header title (with back button), clear on unmount
  useEffect(() => {
    setTitle(
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/dashboard/agents')}
          aria-label="Back to agents"
          className="h-8 w-8 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span>{formData.name || agent.name}</span>
      </div>,
    );
    return () => {
      setTitle('');
    };
  }, [formData.name, agent.name, setTitle, router]);

  // Set page header actions (toggle + embed), update when status changes
  useEffect(() => {
    const cleanup = () => setActions(null);
    setActions(
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {statusPending ? (
            <span className="text-sm text-muted-foreground">
              {pendingDirection === 'activating'
                ? 'Activating...'
                : 'Deactivating...'}
            </span>
          ) : (
            <>
              <Switch
                checked={status === 'ACTIVE'}
                onCheckedChange={(checked) => toggleRef.current?.(checked)}
                aria-label="Toggle agent status"
              />
              <Badge
                variant={status === 'ACTIVE' ? 'default' : 'secondary'}
              >
                {status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </Badge>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(`/agents/demo/${agent.id}`, '_blank')}
          aria-label="Open demo"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Demo
        </Button>
        <EmbedCodeDialog publicId={agent.publicId} />
      </div>,
    );
    return cleanup;
  }, [status, statusPending, pendingDirection, agent.publicId, agent.id, setActions]);

  // Warn about unsaved changes on tab close/refresh and client-side navigation
  useUnsavedChangesWarning(hasUnsavedChanges);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
      if (aiReplyTimer.current) clearTimeout(aiReplyTimer.current);
    };
  }, []);

  // Ref for retry — always calls the latest handleSave without stale closure
  const handleSaveRef = useRef<() => void>(undefined);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Client-side validation jumps to the offending section and aborts the
      // save — it never toasts (toasts are reserved for API errors). Each
      // section renders its own inline field errors; we just surface the tab.

      // Voice config: every control is a constrained Select/Switch, so this
      // can't realistically fail from the UI — kept as a defensive guard so a
      // bad config never reaches the server as a 400.
      if (formData.voiceEnabled && formData.voiceConfig) {
        const result = voiceConfigSchema.safeParse(formData.voiceConfig);
        if (!result.success) {
          setSelectedCategory('voice');
          setSaving(false);
          return;
        }
      }

      // AI / Integration config: the numeric fields render their own inline
      // range errors (see DirectModeConfig). Jump there so the user sees them;
      // the Advanced accordion auto-expands when an advanced field is invalid.
      const aiResult = agentAiConfigUpdateSchema.safeParse(formData.aiConfig);
      if (!aiResult.success) {
        setSelectedCategory('integration');
        setSaving(false);
        return;
      }

      // Inline field validation (Behavior section). Empty conversation
      // starters / fallback phrases are rejected by the server schemas
      // (`min(1)`), so we catch them here and surface the error AT the field
      // instead of letting the save 400. Toasts are reserved for API errors.
      const errors: Record<string, string> = {};
      themeData.starters.forEach((starter, index) => {
        if (starter.message.trim().length === 0) {
          errors[`starters.${index}`] =
            "Conversation starter can't be empty — add text or remove it.";
        }
      });
      formData.fallbackPhrases.forEach((phrase, index) => {
        if (phrase.trim().length === 0) {
          errors[`fallbackPhrases.${index}`] =
            "Fallback phrase can't be empty — add text or remove it.";
        }
      });
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setSelectedCategory('behavior');
        setSaving(false);
        return;
      }

      // Data-capture fields: server rejects empty labels, malformed keys, and
      // duplicate keys (updateDataFieldsSchema). Catch them here so the error
      // shows AT the field instead of 400-ing.
      const dataFieldErrors: Record<string, string> = {};
      const seenKeys = new Set<string>();
      formData.dataFields.forEach((field, index) => {
        if (field.label.trim().length === 0) {
          dataFieldErrors[`dataFields.${index}.label`] =
            "Field label can't be empty — add a label or remove the field.";
        }
        if (!/^[a-z][a-z0-9_]*$/.test(field.key)) {
          dataFieldErrors[`dataFields.${index}.key`] =
            'Key must start with a lowercase letter and use only lowercase letters, digits, and underscores.';
        } else if (seenKeys.has(field.key)) {
          dataFieldErrors[`dataFields.${index}.key`] =
            `Duplicate key "${field.key}" — each field needs a unique key.`;
        }
        seenKeys.add(field.key);
      });
      if (Object.keys(dataFieldErrors).length > 0) {
        setFieldErrors(dataFieldErrors);
        setSelectedCategory('dataCapture');
        setSaving(false);
        return;
      }

      const payload: Record<string, unknown> = {
        name: formData.name,
        systemPrompt: formData.systemPrompt || null,
        welcomeMessage: formData.welcomeMessage || null,
        allowedDomains: formData.allowedDomains,
        voiceEnabled: formData.voiceEnabled,
        voiceConfig: formData.voiceConfig,
        // Whole aiConfig blob. Backend's `agentAiConfigUpdateSchema` is partial,
        // so sending the full object is safe — each field is validated
        // independently. Defaults are re-applied server-side on read.
        aiConfig: formData.aiConfig,
        categoryKeywords: formData.categoryKeywords,
        supportedLanguages: formData.supportedLanguages,
        sessionLifetimeHours: formData.sessionLifetimeHours,
        fallbackPhrases: formData.fallbackPhrases,
        humanTakeoverEnabled: formData.humanTakeoverEnabled,
        showTalkToHumanButton: formData.showTalkToHumanButton,
        humanConnectedLabel: formData.humanConnectedLabel.trim() || null,
      };

      // Save agent config, webhook, and theme in parallel
      const promises: Promise<unknown>[] = [
        updateAgent.mutateAsync({ id: agent.id, data: payload }),
      ];

      if (formData.webhookUrl !== savedFormData.webhookUrl) {
        promises.push(
          api.patch(`/agents/${agent.id}/webhook`, {
            webhookUrl: formData.webhookUrl || null,
          }),
        );
      }

      if (hasThemeChanges) {
        promises.push(
          updateTheme.mutateAsync({ agentId: agent.id, config: themeData }),
        );
      }

      // Knowledge Base has its own endpoint (PUT for upsert, DELETE for removal)
      // but behaviours are merged into this single Save flow so users don't
      // have to click two different save buttons. State transitions:
      //   prior → now       action
      //   ''    → ''        skip
      //   ''    → 'text'    PUT (create)
      //   'old' → 'new'     PUT (update)
      //   'old' → ''        DELETE (remove)
      const kbChanged = formData.knowledgeContent !== savedFormData.knowledgeContent;
      if (kbChanged) {
        const newContent = formData.knowledgeContent.trim();
        const oldContent = savedFormData.knowledgeContent.trim();
        if (newContent) {
          promises.push(
            api.put(`/agents/${agent.id}/knowledge`, {
              content: formData.knowledgeContent,
              sourceFileName: formData.knowledgeSourceFileName,
              sourceMimeType: formData.knowledgeSourceMimeType,
            }),
          );
        } else if (oldContent) {
          promises.push(api.delete(`/agents/${agent.id}/knowledge`));
        }
      }

      // Data-capture fields: replace-all PUT (the editor sends the whole list).
      // Only fire when changed — compared by serialised value (small list,
      // order-sensitive).
      const dataFieldsChanged =
        JSON.stringify(formData.dataFields) !==
        JSON.stringify(savedFormData.dataFields);
      if (dataFieldsChanged) {
        promises.push(
          api.put(`/agents/${agent.id}/data-fields`, {
            fields: formData.dataFields,
          }),
        );
      }

      await Promise.all(promises);

      // Optimistic-on-success cache update: write the known-new state into
      // the editor-config query so the next render shows updated data WITHOUT
      // triggering a refetch. The backend confirmed all pieces persisted; we
      // already have the canonical values in formData/themeData locally.
      //
      // Hard page reload bypasses this and hits the real GET, which is the
      // correct behaviour — no staleness windows beyond the tab's lifetime.
      queryClient.setQueryData<AgentEditorConfigResponse>(
        agentEditorConfigQueryKey(agent.id),
        (old) => {
          // Build an updated bundle. If there's no cached value (rare — only
          // happens if the query was evicted mid-save), fall back to a
          // synthesised bundle using the current agent + form state.
          const baseAgent = old?.agent ?? agent;
          const updatedAgent: Agent = {
            ...baseAgent,
            name: formData.name,
            systemPrompt: formData.systemPrompt || null,
            welcomeMessage: formData.welcomeMessage || null,
            allowedDomains: formData.allowedDomains,
            voiceEnabled: formData.voiceEnabled,
            voiceConfig: formData.voiceConfig,
            aiConfig: formData.aiConfig,
            fallbackPhrases: formData.fallbackPhrases,
            humanTakeoverEnabled: formData.humanTakeoverEnabled,
            showTalkToHumanButton: formData.showTalkToHumanButton,
            humanConnectedLabel: formData.humanConnectedLabel.trim() || null,
          };

          const newKnowledge = formData.knowledgeContent.trim()
            ? {
                id: old?.knowledge?.id ?? '',
                content: formData.knowledgeContent,
                sourceFileName: formData.knowledgeSourceFileName,
                sourceMimeType: formData.knowledgeSourceMimeType,
                contentTokens: old?.knowledge?.contentTokens ?? null,
                sourceSizeBytes: old?.knowledge?.sourceSizeBytes ?? null,
                createdAt: old?.knowledge?.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : null;

          return {
            agent: updatedAgent,
            webhookUrl: formData.webhookUrl || null,
            // Theme envelope: `{ config, version }`. Bump version on any
            // change so consumers that rely on it (widget ETag caching) see
            // the update. If theme didn't change, preserve whatever was
            // cached — synthesise from `themeData` as a last-resort fallback.
            theme: hasThemeChanges
              ? { config: themeData, version: (old?.theme?.version ?? 0) + 1 }
              : (old?.theme ?? { config: themeData, version: 0 }),
            knowledge: newKnowledge,
            // Synthesise rows from form state (id/timestamps are placeholders
            // until the next hard reload hits the real GET).
            dataFields: formData.dataFields.map((f, index) => ({
              ...f,
              id: '',
              order: index,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })),
          };
        },
      );

      markSaved(formData, themeData);
      toast.success('Changes saved successfully');
    } catch {
      toast.error('Failed to save changes', {
        action: {
          label: 'Retry',
          onClick: () => handleSaveRef.current?.(),
        },
      });
    } finally {
      setSaving(false);
    }
  }, [agent, formData, savedFormData, hasThemeChanges, themeData, api, updateAgent, updateTheme, markSaved, queryClient, setFieldErrors]);

  handleSaveRef.current = handleSave;

  const handleResetToDefaults = async () => {
    setResetDefaultsOpen(false);
    setSaving(true);
    try {
      const result = await resetTheme.mutateAsync({ agentId: agent.id });
      const newTheme = result?.config ?? defaultWidgetTheme;
      markSaved(formData, newTheme);
      toast.success('Theme reset to defaults');
    } catch {
      toast.error('Failed to reset theme to defaults');
    } finally {
      setSaving(false);
    }
  };

  const handleSendPreviewMessage = (message: string) => {
    const userMessage: PreviewMessage = {
      type: 'user',
      text: message,
      timestamp: new Date(),
    };
    setPreviewMessages((prev) => [...prev, userMessage]);

    // Simulate AI response
    aiReplyTimer.current = setTimeout(() => {
      const aiResponse: PreviewMessage = {
        type: 'system',
        text: 'Thanks for your message! This is a preview response from your chat agent.',
        timestamp: new Date(),
      };
      setPreviewMessages((prev) => [...prev, aiResponse]);
    }, 1000);
  };

  const handleScrollBarVisibility = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.classList.add('scrolling');
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      el.classList.remove('scrolling');
    }, 700);
  };

  const handleReset = () => {
    resetToSaved();
    setPreviewMessages([]);
  };

  // Build preview form data from agent form + theme data
  const previewFormData = useMemo(
    () => toPreviewFormData(formData, themeData),
    [formData, themeData],
  );

  // Stable timestamp for the derived greeting bubble (cosmetic; kept constant
  // so it doesn't jump every time the conversation changes).
  const greetingTimestamp = useMemo(() => new Date(), []);

  // Prepend the greeting only when a welcome message is configured, mirroring
  // the live widget (no greeting bubble when `welcomeMessage` is empty).
  const displayPreviewMessages = useMemo<PreviewMessage[]>(() => {
    const greeting = formData.welcomeMessage?.trim();
    if (!greeting) return previewMessages;
    return [
      { type: 'system', text: greeting, timestamp: greetingTimestamp },
      ...previewMessages,
    ];
  }, [formData.welcomeMessage, previewMessages, greetingTimestamp]);

  return (
    // Negative margins cancel the dashboard shell's content padding (px-8 py-7)
    // so the editor goes full-bleed within the centered content column.
    <div className="-mx-8 -my-7 flex h-[calc(100vh-4rem)] overflow-hidden bg-background">
      {/* Content area: Sidebar + Form + Preview */}
        {/* Config Sidebar */}
        <AgentEditorSidebar
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        {/* Form area */}
        <div className="flex min-h-0 min-w-0 flex-3 flex-col">
          <div
            // `overflow-y` is deliberately managed in globals.css (.scrollarea)
            // so `@supports (overflow: overlay)` can upgrade to an overlay
            // scrollbar on WebKit/Blink. Don't re-apply `overflow-y-auto` here
            // — Tailwind's utility would win specificity and kill the overlay.
            className="scrollarea flex-1 bg-card p-6 pb-20"
            ref={scrollRef}
            onScroll={handleScrollBarVisibility}
          >
            <AgentEditorForm selectedCategory={selectedCategory} />
          </div>

          {/* Sticky bottom action bar */}
          <div className="border-t border-border bg-card px-6 py-4 shadow-lg">
            <div className="flex justify-end gap-3">
              {/* Reset button with dropdown for "Reset to Defaults" */}
              <DropdownMenu>
                <div className="flex">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    disabled={!hasUnsavedChanges || saving}
                    className="rounded-r-none border-r-0"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset
                  </Button>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-l-none"
                      disabled={saving}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </div>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleReset}
                    disabled={!hasUnsavedChanges}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset to Last Saved
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setResetDefaultsOpen(true)}
                  >
                    <RotateCw className="mr-2 h-4 w-4" />
                    Reset to Defaults
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Save button with loading state */}
              <Button
                onClick={handleSave}
                disabled={!hasUnsavedChanges || saving}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live Preview panel */}
        <div className="flex h-full min-h-0 min-w-112.5 max-w-150 flex-2 flex-col border-l border-border bg-card">
          <AgentPreview
            formData={previewFormData}
            messages={displayPreviewMessages}
            onSendMessage={handleSendPreviewMessage}
          />
        </div>

      {/* Reset to Defaults confirmation dialog */}
      <AlertDialog open={resetDefaultsOpen} onOpenChange={setResetDefaultsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset theme to defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all theme settings to their default values. This action
              cannot be undone and your current theme customizations will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetToDefaults}>
              Reset to Defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Outer component that sets up the provider
interface AgentEditorLayoutProps {
  agent: Agent;
  webhookUrl?: string;
  initialThemeData?: import('@repo/validation').WidgetTheme;
  /**
   * Stored AgentKnowledge (if any) fetched alongside the agent. `null` means
   * no record yet — the knowledge section shows an empty textarea.
   */
  initialKnowledge?: InitialAgentKnowledge | null;
  /**
   * Stored data-capture field definitions (ordered). Empty when the agent
   * collects nothing.
   */
  initialDataFields?: EditorDataField[];
}

export function AgentEditorLayout({
  agent,
  webhookUrl,
  initialThemeData,
  initialKnowledge,
  initialDataFields,
}: AgentEditorLayoutProps) {
  const initialFormData: AgentFormData = agentToFormData(
    agent,
    webhookUrl,
    initialKnowledge ?? null,
    initialDataFields ?? [],
  );

  return (
    <AgentEditorProvider agent={agent} initialFormData={initialFormData} initialThemeData={initialThemeData}>
      <AgentEditorContent />
    </AgentEditorProvider>
  );
}
