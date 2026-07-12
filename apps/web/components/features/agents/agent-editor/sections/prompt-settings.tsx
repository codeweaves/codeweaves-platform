'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';
import { KnowledgeSettings } from './knowledge-settings';

/**
 * "Prompt" section — everything the agent's LLM sees BEFORE the user's first
 * turn: the system prompt plus any reference knowledge. Flat layout — just
 * the two fields stacked, no intermediate headings.
 *
 * The paste-text knowledge editor lives HERE (deliberate, per product owner):
 * it's the mode for normal bots that don't need RAG — the text rides along on
 * every reply. The RAG document pipeline lives in the separate "Knowledge
 * Base" section.
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
          The agent&apos;s persona and reference knowledge, sent to the model
          on every chat turn.
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
          factual reference material in the Knowledge Base below so it stays
          separately editable.
        </p>
      </div>

      {/* Knowledge Base (no extra heading — embedded directly below) ---- */}
      <KnowledgeSettings />
    </div>
  );
}
