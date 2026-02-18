'use client';

import { useState, useEffect } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useApiClient } from '@/lib/api-client';
import { useUpdateAgent, type Agent } from '@/hooks/use-agents';
import { EmbedCodeDialog } from '../embed-code-dialog';
import { AgentEditorSidebar, type CategoryId } from './agent-editor-sidebar';
import { AgentEditorForm } from './agent-editor-form';
import {
  AgentEditorProvider,
  useAgentEditor,
  agentToFormData,
  type AgentFormData,
} from './agent-editor-context';

// Inner component that uses context
function AgentEditorContent() {
  const {
    agent,
    formData,
    hasUnsavedChanges,
    resetToSaved,
    markSaved,
  } = useAgentEditor();
  const api = useApiClient();
  const updateAgent = useUpdateAgent();

  const [selectedCategory, setSelectedCategory] =
    useState<CategoryId>('general');
  const [status, setStatus] = useState(agent.status);
  const [statusPending, setStatusPending] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const handleToggleStatus = async (checked: boolean) => {
    const newStatus = checked ? 'ACTIVE' : 'INACTIVE';
    try {
      setStatusPending(true);
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
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build PATCH payload from changed fields
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {agent.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure your chat agent settings
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Status toggle */}
            <div className="flex items-center gap-2">
              <Switch
                checked={status === 'ACTIVE'}
                onCheckedChange={handleToggleStatus}
                disabled={statusPending}
                aria-label="Toggle agent status"
              />
              <Badge
                variant={status === 'ACTIVE' ? 'default' : 'secondary'}
              >
                {status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </Badge>
            </div>

            {/* Embed code — all roles */}
            <EmbedCodeDialog publicId={agent.publicId} />
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <AgentEditorSidebar
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        {/* Form */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            <AgentEditorForm selectedCategory={selectedCategory} />
          </div>

          {/* Sticky action bar */}
          <div className="border-t bg-background px-6 py-4">
            <div className="flex items-center justify-end gap-3">
              {hasUnsavedChanges && (
                <span className="mr-auto text-sm text-muted-foreground">
                  You have unsaved changes
                </span>
              )}
              <Button
                variant="outline"
                onClick={resetToSaved}
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
