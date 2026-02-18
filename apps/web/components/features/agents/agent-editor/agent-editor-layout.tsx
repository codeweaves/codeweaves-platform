'use client';

import { useState, useEffect, useRef } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useSidebar } from '@/components/ui/sidebar';
import { usePageHeader } from '@/components/layout/page-header';
import { useApiClient } from '@/lib/api-client';
import { useUpdateAgent, type Agent } from '@/hooks/use-agents';
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
} from './agent-editor-context';

// Inner component that uses context
function AgentEditorContent() {
  const {
    agent,
    formData,
    savedFormData,
    hasUnsavedChanges,
    resetToSaved,
    markSaved,
  } = useAgentEditor();
  const api = useApiClient();
  const updateAgent = useUpdateAgent();
  const { setOpen, open } = useSidebar();
  const { setTitle, setActions } = usePageHeader();

  const [selectedCategory, setSelectedCategory] =
    useState<CategoryId>('general');
  const [status, setStatus] = useState(agent.status);
  const [statusPending, setStatusPending] = useState(false);
  const [pendingDirection, setPendingDirection] = useState<'activating' | 'deactivating' | null>(null);
  const [saving, setSaving] = useState(false);

  // Preview messages state
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([
    {
      type: 'system',
      text: formData.welcomeMessage || 'Hello! How can I help you today?',
      timestamp: new Date(),
    },
  ]);

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

  // Set page header title, clear on unmount
  useEffect(() => {
    setTitle(formData.name || agent.name);
    return () => {
      setTitle('');
    };
  }, [formData.name, agent.name, setTitle]);

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
        <EmbedCodeDialog publicId={agent.publicId} />
      </div>,
    );
    return cleanup;
  }, [status, statusPending, pendingDirection, agent.publicId, setActions]);

  // Update greeting in preview when welcomeMessage changes
  useEffect(() => {
    setPreviewMessages((prev) => [
      {
        type: 'system',
        text: formData.welcomeMessage || 'Hello! How can I help you today?',
        timestamp: new Date(),
      },
      ...prev.slice(1),
    ]);
  }, [formData.welcomeMessage]);

  // Warn about unsaved changes when leaving
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
      if (aiReplyTimer.current) clearTimeout(aiReplyTimer.current);
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        systemPrompt: formData.systemPrompt || null,
        welcomeMessage: formData.welcomeMessage || null,
        allowedDomains: formData.allowedDomains,
      };

      await updateAgent.mutateAsync({ id: agent.id, data: payload });

      // Save webhook separately if changed
      if (formData.webhookUrl !== undefined) {
        await api.patch(`/agents/${agent.id}/webhook`, {
          webhookUrl: formData.webhookUrl || null,
        });
      }

      markSaved(formData);
      toast.success('Agent updated successfully');
    } catch {
      toast.error('Failed to save changes');
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
    setPreviewMessages([
      {
        type: 'system',
        text: savedFormData.welcomeMessage || 'Hello! How can I help you today?',
        timestamp: new Date(),
      },
    ]);
  };

  // Build preview form data with defaults for theme fields
  const previewFormData = toPreviewFormData(formData);

  return (
    // -m-6 offsets the parent <main>'s p-6 padding for full-bleed editor layout
    <div className="-m-6 flex h-[calc(100vh-4rem)] overflow-hidden bg-gray-50">
      {/* Content area: Sidebar + Form + Preview */}
        {/* Config Sidebar */}
        <AgentEditorSidebar
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        {/* Form area */}
        <div className="flex min-h-0 min-w-0 flex-3 flex-col">
          <div
            className="scrollarea flex-1 overflow-y-auto bg-white p-6 pb-20"
            ref={scrollRef}
            onScroll={handleScrollBarVisibility}
          >
            <AgentEditorForm selectedCategory={selectedCategory} />
          </div>

          {/* Sticky bottom action bar */}
          <div className="border-t border-gray-200 bg-white px-6 py-4 shadow-lg">
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={!hasUnsavedChanges || saving}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasUnsavedChanges || saving}
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live Preview panel */}
        <div className="flex h-full min-h-0 min-w-112.5 max-w-150 flex-2 flex-col border-l border-gray-200 bg-white">
          <AgentPreview
            formData={previewFormData}
            messages={previewMessages}
            onSendMessage={handleSendPreviewMessage}
          />
        </div>
    </div>
  );
}

// Outer component that sets up the provider
interface AgentEditorLayoutProps {
  agent: Agent;
  webhookUrl?: string;
}

export function AgentEditorLayout({
  agent,
  webhookUrl,
}: AgentEditorLayoutProps) {
  const initialFormData: AgentFormData = agentToFormData(agent, webhookUrl);

  return (
    <AgentEditorProvider agent={agent} initialFormData={initialFormData}>
      <AgentEditorContent />
    </AgentEditorProvider>
  );
}
