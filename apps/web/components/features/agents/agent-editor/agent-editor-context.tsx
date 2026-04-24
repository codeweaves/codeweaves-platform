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
import { type WidgetTheme, defaultWidgetTheme, type VoiceConfigDto } from '@repo/validation';

export interface AgentFormData {
  name: string;
  // Admin-only fields
  systemPrompt: string;
  welcomeMessage: string;
  allowedDomains: string[];
  webhookUrl: string;
  voiceEnabled: boolean;
  voiceConfig: VoiceConfigDto | null;
}

interface AgentEditorContextType {
  agent: Agent;
  formData: AgentFormData;
  savedFormData: AgentFormData;
  updateFormData: <K extends keyof AgentFormData>(
    field: K,
    value: AgentFormData[K],
  ) => void;
  themeData: WidgetTheme;
  savedThemeData: WidgetTheme;
  updateThemeData: (path: string, value: unknown) => void;
  hasThemeChanges: boolean;
  hasUnsavedChanges: boolean;
  resetToSaved: () => void;
  markSaved: (data: AgentFormData, theme?: WidgetTheme) => void;
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

/** Immutable dot-path setter — shallow-copies only the affected path segments. */
function setNestedValue<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = { ...obj } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as string;
    current[key] = { ...current[key] };
    current = current[key];
  }
  const lastKey = keys[keys.length - 1] as string;
  current[lastKey] = value;
  return result as T;
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
  iconHoverBg: string;
  iconPosition: 'left' | 'right';
  iconSize: number;
  iconBorderRadius: number;
  iconShadow: string;
  iconCustomImage: string;
  bubbleEnabled: boolean;
  bubbleText: string;
  bubbleBg: string;
  bubbleTextColor: string;
  bubbleShowDelay: number;
  bubbleSound: boolean;
  // Header
  headerTitle: string;
  headerSubtitle: string;
  companyLogo: string;
  headerShowLogo: boolean;
  headerBg: string;
  headerTextColor: string;
  headerSubtitleColor: string;
  headerBorderRadius: number;
  // Chat Interface
  botAvatarShow: boolean;
  botAvatarType: 'robot' | 'machine' | 'bot' | 'support' | 'custom';
  botCustomImage: string;
  botAvatarShape: string;
  botAvatarBg: string;
  botAvatarColor: string;
  userAvatarShow: boolean;
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
  // Voice
  voiceEnabled: boolean;
}

/** Maps AgentFormData + WidgetTheme to the full PreviewFormData shape for the chat widget preview. */
export function toPreviewFormData(formData: AgentFormData, themeData: WidgetTheme): PreviewFormData {
  return {
    name: formData.name,
    greetingMessage: formData.welcomeMessage || 'Hello! How can I help you today?',
    webhookUrl: formData.webhookUrl,
    domains: formData.allowedDomains,
    // Icon
    iconBg: themeData.icon.backgroundColor,
    iconHoverBg: themeData.icon.hoverBackgroundColor,
    iconPosition: themeData.icon.position,
    iconSize: themeData.icon.size,
    iconBorderRadius: themeData.icon.borderRadius,
    iconShadow: themeData.icon.shadow,
    iconCustomImage: themeData.icon.customImageUrl ?? '',
    // Bubble
    bubbleEnabled: themeData.bubble.enabled,
    bubbleText: themeData.bubble.text,
    bubbleBg: themeData.bubble.backgroundColor,
    bubbleTextColor: themeData.bubble.textColor,
    bubbleShowDelay: themeData.bubble.delayMs,
    bubbleSound: true,
    // Header
    headerTitle: themeData.header.title,
    headerSubtitle: themeData.header.subtitle ?? '',
    companyLogo: themeData.header.logoUrl ?? '',
    headerShowLogo: themeData.header.showLogo,
    headerBg: themeData.header.backgroundColor,
    headerTextColor: themeData.header.textColor,
    headerSubtitleColor: themeData.header.subtitleColor,
    headerBorderRadius: themeData.header.borderRadius,
    // Bot messages
    botAvatarShow: themeData.botAvatar.show ?? false,
    botAvatarType: themeData.botAvatar.type as PreviewFormData['botAvatarType'],
    botCustomImage: themeData.botAvatar.customImageUrl ?? '',
    botAvatarShape: themeData.botAvatar.shape,
    botAvatarBg: themeData.botAvatar.backgroundColor,
    botAvatarColor: themeData.botAvatar.color,
    systemMessageBg: themeData.botMessage.backgroundColor,
    systemMessageTextColor: themeData.botMessage.textColor,
    systemMessageBorderRadius: themeData.botMessage.borderRadius,
    // User messages
    userAvatarShow: themeData.userAvatar.show ?? false,
    userAvatarType: themeData.userAvatar.type,
    userAvatarShape: themeData.userAvatar.shape,
    userAvatarBg: themeData.userAvatar.backgroundColor,
    userAvatarColor: themeData.userAvatar.color,
    userCustomImage: themeData.userAvatar.customImageUrl ?? '',
    userMessageBg: themeData.userMessage.backgroundColor,
    userMessageTextColor: themeData.userMessage.textColor,
    userMessageBorderRadius: themeData.userMessage.borderRadius,
    // Body
    chatBodyBg: themeData.body.backgroundColor,
    // Timestamps
    timestampColor: themeData.timestamps.color,
    showTimestamp: themeData.timestamps.show,
    // Input
    inputBg: themeData.input.backgroundColor,
    inputPlaceholder: themeData.input.placeholderText,
    inputTextColor: themeData.input.textColor,
    inputBorderRadius: themeData.input.borderRadius,
    // Send button
    sendButtonBg: themeData.sendButton.backgroundColor,
    sendButtonBorderRadius: themeData.sendButton.borderRadius,
    sendButtonIconColor: themeData.sendButton.iconColor,
    // Typography
    fontFamily: themeData.typography.fontFamily,
    defaultFontSize: themeData.typography.baseFontSize,
    // Behavior
    typingIndicator: themeData.animations.showTypingIndicator,
    conversationalStarters: themeData.starters.map((s) => s.message),
    // Branding
    brandingEnabled: themeData.branding.enabled,
    brandingTextPrefix: themeData.branding.textPrefix,
    brandingUseLogo: themeData.branding.useLogo,
    brandingLinkText: themeData.branding.linkText,
    brandingLinkUrl: themeData.branding.linkUrl,
    brandingLogo: themeData.branding.logo ?? '',
    brandingTextColor: themeData.branding.textColor,
    brandingLinkColor: themeData.branding.linkColor,
    // Voice
    voiceEnabled: formData.voiceEnabled,
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
    voiceEnabled: agent.voiceEnabled ?? false,
    voiceConfig: agent.voiceConfig ?? null,
  };
}

interface AgentEditorProviderProps {
  children: ReactNode;
  agent: Agent;
  initialFormData: AgentFormData;
  initialThemeData?: WidgetTheme;
}

export function AgentEditorProvider({
  children,
  agent,
  initialFormData,
  initialThemeData = defaultWidgetTheme,
}: AgentEditorProviderProps) {
  const [savedFormData, setSavedFormData] =
    useState<AgentFormData>(initialFormData);
  const [formData, setFormData] = useState<AgentFormData>(initialFormData);

  const [savedThemeData, setSavedThemeData] =
    useState<WidgetTheme>(initialThemeData);
  const [themeData, setThemeData] = useState<WidgetTheme>(initialThemeData);

  const updateFormData = useCallback(
    <K extends keyof AgentFormData>(field: K, value: AgentFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const updateThemeData = useCallback(
    (path: string, value: unknown) => {
      setThemeData((prev) => setNestedValue(prev, path, value));
    },
    [],
  );

  // NOTE: deepEqual traverses the full WidgetTheme tree on every theme state change.
  // If perf becomes an issue, consider a dirty flag set by updateThemeData instead.
  const hasThemeChanges = useMemo(
    () => !deepEqual(themeData, savedThemeData),
    [themeData, savedThemeData],
  );

  const hasUnsavedChanges = useMemo(
    () => !deepEqual(formData, savedFormData) || hasThemeChanges,
    [formData, savedFormData, hasThemeChanges],
  );

  const resetToSaved = useCallback(() => {
    setFormData(savedFormData);
    setThemeData(savedThemeData);
  }, [savedFormData, savedThemeData]);

  const markSaved = useCallback((data: AgentFormData, theme?: WidgetTheme) => {
    setSavedFormData(data);
    setFormData(data);
    if (theme) {
      setSavedThemeData(theme);
      setThemeData(theme);
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      agent,
      formData,
      savedFormData,
      updateFormData,
      themeData,
      savedThemeData,
      updateThemeData,
      hasThemeChanges,
      hasUnsavedChanges,
      resetToSaved,
      markSaved,
    }),
    [
      agent, formData, savedFormData, updateFormData,
      themeData, savedThemeData, updateThemeData,
      hasThemeChanges, hasUnsavedChanges, resetToSaved, markSaved,
    ],
  );

  return (
    <AgentEditorContext.Provider value={contextValue}>
      {children}
    </AgentEditorContext.Provider>
  );
}
