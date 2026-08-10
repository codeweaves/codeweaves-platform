'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useAgentEditor } from '../agent-editor-context';
import { KnowledgeSettings } from './knowledge-settings';

/**
 * "Prompt" section — everything the agent's LLM sees BEFORE the user's first
 * turn: the system prompt plus any reference knowledge. Flat layout — just
 * the two fields stacked, no intermediate headings.
 *
 * The greeting/welcome message is deliberately NOT here — it's a chat-flow UX
 * thing (what the visitor sees on widget open) and lives in BehaviorSettings.
 */
export function PromptSettings() {
  const { formData, updateFormData } = useAgentEditor();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Prompt</h3>
        <p className="text-sm text-muted-foreground">
          The agent&apos;s persona and reference knowledge.
        </p>
      </div>

      {/* System prompt -------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">System Prompt</Label>
          <InfoTooltip
            label="System Prompt"
            content={
              <>
                <p>
                  Who the agent is and how it should behave: its persona, tone and
                  rules.
                </p>
                <p>
                  Keep <strong>factual reference material</strong> out of here and put
                  it in the Knowledge Base below, so the two stay separately editable.
                </p>
                <p>Sent to the model on every chat turn.</p>
              </>
            }
          />
        </div>
        <Textarea
          value={formData.systemPrompt}
          onChange={(e) => updateFormData('systemPrompt', e.target.value)}
          placeholder="e.g., You are a helpful support assistant for ACME Corp. Answer succinctly, ask clarifying questions when needed, and follow brand tone."
          className="min-h-32"
        />
      </div>

      {/* Knowledge Base (no extra heading — embedded directly below) ---- */}
      <KnowledgeSettings />
    </div>
  );
}
