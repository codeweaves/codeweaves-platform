'use client';

import type { CategoryId } from './agent-editor-sidebar';
import { GeneralSettings } from './sections/general-settings';
import { AppearanceSettings } from './sections/appearance-settings';
import { ChatSettings } from './sections/chat-settings';
import { BehaviorSettings } from './sections/behavior-settings';
import { PromptSettings } from './sections/prompt-settings';
import { IntegrationSettings } from './sections/integration-settings';
import { BrandingSettings } from './sections/branding-settings';

interface AgentEditorFormProps {
  selectedCategory: CategoryId;
}

export function AgentEditorForm({ selectedCategory }: AgentEditorFormProps) {
  switch (selectedCategory) {
    case 'general':
      return <GeneralSettings />;
    case 'appearance':
      return <AppearanceSettings />;
    case 'chat':
      return <ChatSettings />;
    case 'behavior':
      return <BehaviorSettings />;
    case 'prompt':
      return <PromptSettings />;
    case 'integration':
      return <IntegrationSettings />;
    case 'branding':
      return <BrandingSettings />;
    default:
      return null;
  }
}
