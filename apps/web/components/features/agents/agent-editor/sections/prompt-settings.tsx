'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAgentEditor } from '../agent-editor-context';
import { useProfile } from '@/hooks/use-profile';

export function PromptSettings() {
  const { profile } = useProfile();
  const { formData, updateFormData } = useAgentEditor();

  const isAdmin =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'ADMIN';

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Prompt</h3>
        <p className="text-sm text-muted-foreground">
          Define the agent&apos;s initial context and your organization&apos;s
          information.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Initial Context</Label>
          <Textarea
            value={formData.systemPrompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateFormData('systemPrompt', e.target.value)}
            placeholder="e.g., You are a helpful support assistant for ACME Corp. Answer succinctly, ask clarifying questions when needed, and follow brand tone."
            className="min-h-[120px]"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Welcome Message</Label>
          <Textarea
            value={formData.welcomeMessage}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              updateFormData('welcomeMessage', e.target.value)
            }
            placeholder="e.g., Hello! How can I help you today?"
            className="min-h-[80px]"
          />
          <p className="text-xs text-muted-foreground">
            The first message displayed to users when the chat widget opens.
          </p>
        </div>
      </div>
    </div>
  );
}
