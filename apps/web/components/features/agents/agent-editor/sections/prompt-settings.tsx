'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';

/**
 * "Prompt" section — the agent's persona (system prompt).
 *
 * The quick-knowledge text editor used to be embedded here; it moved to the
 * "Knowledge Base" section so BOTH knowledge modes (always-in-prompt text and
 * retrieved documents) live in one place. Nothing changed server-side — the
 * text is still injected into every chat turn.
 *
 * The greeting/welcome message is deliberately NOT here — it's a chat-flow UX
 * thing (what the visitor sees on widget open) and lives in BehaviorSettings.
 */
export function PromptSettings() {
  const { profile } = useProfile();
  const { formData, updateFormData } = useAgentEditor();

  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';
  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Prompt</h3>
        <p className="text-sm text-muted-foreground">
          The agent&apos;s persona, sent to the model on every chat turn.
        </p>
      </div>

      {/* System prompt -------------------------------------------------- */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">System Prompt</Label>
        <Textarea
          value={formData.systemPrompt}
          onChange={(e) => updateFormData('systemPrompt', e.target.value)}
          placeholder="e.g., You are a helpful support assistant for ACME Corp. Answer succinctly, ask clarifying questions when needed, and follow brand tone."
          className="min-h-32"
        />
        <p className="text-xs text-muted-foreground">
          Keep this focused on who the agent is and how it should behave. Put
          factual reference material in the Knowledge Base section so it stays
          separately editable.
        </p>
      </div>
    </div>
  );
}
