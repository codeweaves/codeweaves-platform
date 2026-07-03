'use client';

import type { CategoryId } from './agent-editor-sidebar';
import { GeneralSettings } from './sections/general-settings';
import { AppearanceSettings } from './sections/appearance-settings';
import { ChatSettings } from './sections/chat-settings';
import { BehaviorSettings } from './sections/behavior-settings';
import { PromptSettings } from './sections/prompt-settings';
import { ClassificationSettings } from './sections/classification-settings';
import { DataCaptureSettings } from './sections/data-capture-settings';
import { IntegrationSettings } from './sections/integration-settings';
import { WhatsappSettings } from './sections/whatsapp-settings';
import { BrandingSettings } from './sections/branding-settings';
import { VoiceSettings } from './sections/voice-settings';
import { HumanHandoverSettings } from './sections/human-handover-settings';

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
    case 'voice':
      return <VoiceSettings />;
    case 'prompt':
      return <PromptSettings />;
    case 'classification':
      return <ClassificationSettings />;
    case 'dataCapture':
      return <DataCaptureSettings />;
    case 'integration':
      return <IntegrationSettings />;
    case 'whatsapp':
      return <WhatsappSettings />;
    case 'branding':
      return <BrandingSettings />;
    case 'humanHandover':
      return <HumanHandoverSettings />;
    default:
      return null;
  }
}
