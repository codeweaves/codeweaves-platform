'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Agent } from '@/hooks/use-agents';

export interface AgentFormData {
  name: string;
  // Admin-only fields
  systemPrompt: string;
  welcomeMessage: string;
  allowedDomains: string[];
  webhookUrl: string;
  // Branding (placeholder — stored in AgentTheme in Epic 4)
  brandingEnabled: boolean;
  brandingTextPrefix: string;
  brandingLinkText: string;
  brandingLinkUrl: string;
}

interface AgentEditorContextType {
  agent: Agent;
  formData: AgentFormData;
  savedFormData: AgentFormData;
  updateFormData: <K extends keyof AgentFormData>(
    field: K,
    value: AgentFormData[K],
  ) => void;
  hasUnsavedChanges: boolean;
  resetToSaved: () => void;
  markSaved: (data: AgentFormData) => void;
}

const AgentEditorContext = createContext<AgentEditorContextType | undefined>(
  undefined,
);

export function useAgentEditor() {
  const context = useContext(AgentEditorContext);
  if (!context) {
    throw new Error(
      'useAgentEditor must be used within an AgentEditorProvider',
    );
  }
  return context;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
  );
}

/** Full form data shape used by the ChatWidgetSurface preview.
 *  Fields not yet persisted are filled with defaults by `toPreviewFormData`. */
export interface PreviewFormData {
  name: string;
  greetingMessage: string;
  webhookUrl: string;
  domains: string[];
  // Appearance
  iconBg: string;
  iconPosition: 'left' | 'right';
  iconBorderRadius: number;
  bubbleText: string;
  bubbleBg: string;
  bubbleTextColor: string;
  bubbleShowDelay: number;
  bubbleSound: boolean;
  // Header
  headerTitle: string;
  headerSubtitle: string;
  companyLogo: string;
  headerBg: string;
  headerTextColor: string;
  headerBorderRadius: number;
  // Chat Interface
  botAvatarType: 'robot' | 'machine' | 'bot' | 'support' | 'custom';
  botCustomImage: string;
  botAvatarShape: string;
  botAvatarBg: string;
  botAvatarColor: string;
  userAvatarType: string;
  userAvatarShape: string;
  userAvatarBg: string;
  userAvatarColor: string;
  userCustomImage: string;
  userMessageBg: string;
  userMessageTextColor: string;
  userMessageBorderRadius: number;
  systemMessageBg: string;
  systemMessageTextColor: string;
  systemMessageBorderRadius: number;
  chatBodyBg: string;
  timestampColor: string;
  showTimestamp: boolean;
  inputBg: string;
  inputPlaceholder: string;
  inputTextColor: string;
  inputBorderRadius: number;
  sendButtonBg: string;
  sendButtonBorderRadius: number;
  sendButtonIconColor: string;
  // Typography
  fontFamily: string;
  defaultFontSize: number;
  // Behavior
  typingIndicator: boolean;
  conversationalStarters: string[];
  // Branding
  brandingEnabled: boolean;
  brandingTextPrefix: string;
  brandingUseLogo: boolean;
  brandingLinkText: string;
  brandingLinkUrl: string;
  brandingLogo: string;
  brandingTextColor: string;
  brandingLinkColor: string;
}

const previewDefaults: Omit<PreviewFormData, 'name' | 'greetingMessage' | 'webhookUrl' | 'domains'> = {
  iconBg: '#3B82F6',
  iconPosition: 'right',
  iconBorderRadius: 14,
  bubbleText: 'Need help?',
  bubbleBg: '#3B82F6',
  bubbleTextColor: '#FFFFFF',
  bubbleShowDelay: 3,
  bubbleSound: true,
  headerTitle: 'Chat Support',
  headerSubtitle: "We're here to help",
  companyLogo: '',
  headerBg: '#3B82F6',
  headerTextColor: '#FFFFFF',
  headerBorderRadius: 14,
  botAvatarType: 'robot',
  botCustomImage: '',
  botAvatarShape: 'circle',
  botAvatarBg: '#3B82F6',
  botAvatarColor: '#FFFFFF',
  userAvatarType: 'male',
  userAvatarShape: 'circle',
  userAvatarBg: '#3B82F6',
  userAvatarColor: '#FFFFFF',
  userCustomImage: '',
  userMessageBg: '#3B82F6',
  userMessageTextColor: '#FFFFFF',
  userMessageBorderRadius: 14,
  systemMessageBg: '#F3F4F6',
  systemMessageTextColor: '#1F2937',
  systemMessageBorderRadius: 14,
  chatBodyBg: '#F9FAFB',
  timestampColor: '#6B7280',
  showTimestamp: true,
  inputBg: '#FFFFFF',
  inputPlaceholder: 'Type your message...',
  inputTextColor: '#6B7280',
  inputBorderRadius: 14,
  sendButtonBg: '#3B82F6',
  sendButtonBorderRadius: 14,
  sendButtonIconColor: '#FFFFFF',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  defaultFontSize: 16,
  typingIndicator: true,
  conversationalStarters: ['How can I help you?', 'What would you like to know?', 'Need assistance?'],
  brandingEnabled: true,
  brandingTextPrefix: 'Powered by',
  brandingUseLogo: false,
  brandingLinkText: 'Codeweaves',
  brandingLinkUrl: 'https://codeweaves.com',
  brandingLogo: '',
  brandingTextColor: '#6B7280',
  brandingLinkColor: '#2563EB',
};

/** Maps our lean AgentFormData to the full PreviewFormData shape for the chat widget preview. */
export function toPreviewFormData(formData: AgentFormData): PreviewFormData {
  return {
    ...previewDefaults,
    name: formData.name,
    greetingMessage: formData.welcomeMessage || 'Hello! How can I help you today?',
    webhookUrl: formData.webhookUrl,
    domains: formData.allowedDomains,
    // Override branding from our form data
    brandingEnabled: formData.brandingEnabled,
    brandingTextPrefix: formData.brandingTextPrefix,
    brandingLinkText: formData.brandingLinkText,
    brandingLinkUrl: formData.brandingLinkUrl,
  };
}

export function agentToFormData(
  agent: Agent,
  webhookUrl = '',
): AgentFormData {
  return {
    name: agent.name,
    systemPrompt: agent.systemPrompt ?? '',
    welcomeMessage: agent.welcomeMessage ?? '',
    allowedDomains: agent.allowedDomains ?? [],
    webhookUrl,
    brandingEnabled: true,
    brandingTextPrefix: 'Powered by',
    brandingLinkText: 'Codeweaves',
    brandingLinkUrl: 'https://codeweaves.com',
  };
}

interface AgentEditorProviderProps {
  children: ReactNode;
  agent: Agent;
  initialFormData: AgentFormData;
}

export function AgentEditorProvider({
  children,
  agent,
  initialFormData,
}: AgentEditorProviderProps) {
  const [savedFormData, setSavedFormData] =
    useState<AgentFormData>(initialFormData);
  const [formData, setFormData] = useState<AgentFormData>(initialFormData);

  const updateFormData = useCallback(
    <K extends keyof AgentFormData>(field: K, value: AgentFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const hasUnsavedChanges = useMemo(
    () => !deepEqual(formData, savedFormData),
    [formData, savedFormData],
  );

  const resetToSaved = useCallback(() => {
    setFormData(savedFormData);
  }, [savedFormData]);

  const markSaved = useCallback((data: AgentFormData) => {
    setSavedFormData(data);
    setFormData(data);
  }, []);

  return (
    <AgentEditorContext.Provider
      value={{
        agent,
        formData,
        savedFormData,
        updateFormData,
        hasUnsavedChanges,
        resetToSaved,
        markSaved,
      }}
    >
      {children}
    </AgentEditorContext.Provider>
  );
}
