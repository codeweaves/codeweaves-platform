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
import {
  type WidgetTheme,
  defaultWidgetTheme,
  type VoiceConfigDto,
  type AgentAiConfigDto,
  type DataFieldType,
} from '@repo/validation';

/**
 * Editable shape of one data-capture field in the form (no id/order/timestamps
 * — order is implied by array position, the rest are server-managed). Mirrors
 * the `DataFieldDto` PUT payload. See the Data Capture section.
 */
export interface EditorDataField {
  key: string;
  label: string;
  type: DataFieldType;
  required: boolean;
  description: string | null;
}

export interface AgentFormData {
  name: string;
  // Admin-only fields
  systemPrompt: string;
  welcomeMessage: string;
  allowedDomains: string[];
  webhookUrl: string;
  voiceEnabled: boolean;
  voiceConfig: VoiceConfigDto | null;
  /**
   * AI orchestration config — routingMode (n8n/direct), model, temperature,
   * etc. Seeded from `agent.aiConfig` OR from Zod defaults if the agent has
   * never been configured. Always a full object in-memory so sections can
   * read fields without null-checking every access; only DIRTY fields get
   * sent on save.
   */
  aiConfig: AgentAiConfigDto;
  /**
   * Knowledge Base content (static reference text prepended to the system
   * prompt on every direct-mode turn). Lives in the form state so the single
   * main "Save Changes" button commits it alongside the rest — see
   * `handleSave` in agent-editor-layout.tsx. Empty string means no knowledge
   * attached; the save flow DELETEs a previously-stored record when the
   * content transitions from non-empty to empty.
   */
  knowledgeContent: string;
  knowledgeSourceFileName: string | null;
  knowledgeSourceMimeType: string | null;
  /**
   * Labels used by the background conversation classifier (e.g. ["Pricing",
   * "Support"]). Empty array disables categorisation for this agent.
   */
  categoryKeywords: string[];
  /**
   * ISO 639-1 codes (plus the non-standard `hinglish`) for the languages the
   * classifier should detect. Empty array disables language detection.
   */
  supportedLanguages: string[];
  /**
   * Max chat-session lifetime from createdAt, in hours. Range 6-24,
   * default 6. After this elapses the backend rotates the visitor to a
   * fresh session on their next message.
   */
  sessionLifetimeHours: number;
  /**
   * Phrases the agent replies with when it can't answer. Injected into the
   * system prompt and fuzzy-matched against replies to flag "couldn't answer"
   * in analytics. Max 3, each up to 200 chars.
   */
  fallbackPhrases: string[];
  /**
   * Data-capture field definitions — what the bot should collect from a
   * conversation (e.g. name/email/phone). Order is array position. Empty
   * disables capture. Saved via PUT /agents/:id/data-fields; the background
   * extractor reads these to pull values out of finished conversations.
   */
  dataFields: EditorDataField[];
  /**
   * Human handover (live agent takeover). Master toggle, the optional
   * "Talk to a human" widget button, and the text shown to the visitor when a
   * teammate connects (empty = a sensible built-in default). The button/line
   * COLOURS live in the widget theme (themeData.handover).
   */
  humanTakeoverEnabled: boolean;
  showTalkToHumanButton: boolean;
  humanConnectedLabel: string;
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
  /**
   * Inline client-side validation errors, keyed by field path (e.g.
   * `starters.0`, `fallbackPhrases.1`). Populated on a save attempt and
   * rendered by the owning section beside the offending input. Cleared when
   * the field is edited, on discard, and on a successful save. Toasts are
   * reserved for API errors — never client-side validation.
   */
  fieldErrors: Record<string, string>;
  setFieldErrors: (errors: Record<string, string>) => void;
  clearFieldError: (key: string) => void;
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

/**
 * Deep-merge stored theme values over the defaults. Unlike a shallow spread,
 * this fills NESTED keys added after a theme was saved (e.g. new
 * `handover.requestedLabel` / line colours) from the defaults, instead of a
 * stored section object replacing the whole default section (which left the new
 * keys undefined → empty inputs / #000000 colour pickers). Arrays (e.g.
 * `starters`) and primitives: the stored value wins as-is.
 */
function deepMergeTheme<T>(base: T, override: unknown): T {
  if (
    override === undefined ||
    override === null ||
    typeof override !== 'object' ||
    Array.isArray(override) ||
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base)
  ) {
    return override === undefined ? base : (override as T);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = { ...(base as any) };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const o = (override as Record<string, unknown>)[key];
    if (o === undefined) continue;
    out[key] = deepMergeTheme(out[key], o);
  }
  return out as T;
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
  // Human handover
  handoverEnabled: boolean;
  showHandoverButton: boolean;
  handoverButtonLabel: string;
  handoverButtonBg: string;
  handoverButtonTextColor: string;
  handoverConnectedLabel: string;
  handoverConnectedLineColor: string;
  handoverRequestedLabel: string;
  handoverRequestedLineColor: string;
  handoverEndedLabel: string;
  handoverEndedLineColor: string;
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
    // Human handover
    handoverEnabled: formData.humanTakeoverEnabled,
    showHandoverButton: formData.humanTakeoverEnabled && formData.showTalkToHumanButton,
    handoverButtonLabel: themeData.handover.buttonLabel,
    handoverButtonBg: themeData.handover.buttonBackgroundColor,
    handoverButtonTextColor: themeData.handover.buttonTextColor,
    handoverConnectedLabel:
      formData.humanConnectedLabel || "You're now connected with our team",
    handoverConnectedLineColor: themeData.handover.connectedLineColor,
    handoverRequestedLabel: themeData.handover.requestedLabel,
    handoverRequestedLineColor: themeData.handover.requestedLineColor,
    handoverEndedLabel: themeData.handover.endedLabel,
    handoverEndedLineColor: themeData.handover.endedLineColor,
  };
}

/**
 * AI config defaults — mirror the Zod schema defaults in `agentAiConfigSchema`
 * but declared here so the frontend doesn't pull in `zod`'s parse machinery
 * just for defaults. Keep these in sync with packages/validation when Zod
 * defaults change.
 */
const DEFAULT_AI_CONFIG: import('@repo/validation').AgentAiConfigDto = {
  routingMode: 'n8n',
  temperature: 0.7,
  maxTokens: 4096,
  maxContextMessages: 20,
  maxInputTokens: 8000,
  contextStrategy: 'hybrid',
  ragEnabled: true,
  ragTopK: 5,
  ragSimilarityThreshold: 0.7,
  ragRerankEnabled: true,
  ragContextualChunking: false,
  cachingEnabled: true,
  piiRedactionEnabled: false,
  piiLogRedaction: true,
};

/**
 * Shape of the `AgentKnowledge` row when returned from GET /agents/:id/knowledge.
 * Kept minimal (only the fields the form needs) so this file stays decoupled
 * from the full use-agent-knowledge hook's type.
 */
export interface InitialAgentKnowledge {
  content: string;
  sourceFileName: string | null;
  sourceMimeType: string | null;
}

export function agentToFormData(
  agent: Agent,
  webhookUrl = '',
  initialKnowledge: InitialAgentKnowledge | null = null,
  initialDataFields: EditorDataField[] = [],
): AgentFormData {
  return {
    name: agent.name,
    systemPrompt: agent.systemPrompt ?? '',
    welcomeMessage: agent.welcomeMessage ?? '',
    allowedDomains: agent.allowedDomains ?? [],
    webhookUrl,
    voiceEnabled: agent.voiceEnabled ?? false,
    voiceConfig: agent.voiceConfig ?? null,
    // Merge stored aiConfig over defaults so every field has a value —
    // sections don't need to null-check each read. On save, the backend's
    // partial-update Zod schema accepts whichever fields we send.
    aiConfig: { ...DEFAULT_AI_CONFIG, ...(agent.aiConfig ?? {}) },
    // Knowledge base: empty string when no record exists. Save logic in the
    // layout compares this against `savedFormData` to decide whether to
    // PUT /knowledge, DELETE /knowledge, or skip.
    knowledgeContent: initialKnowledge?.content ?? '',
    knowledgeSourceFileName: initialKnowledge?.sourceFileName ?? null,
    knowledgeSourceMimeType: initialKnowledge?.sourceMimeType ?? null,
    categoryKeywords: agent.categoryKeywords ?? [],
    supportedLanguages: agent.supportedLanguages ?? [],
    sessionLifetimeHours: agent.sessionLifetimeHours ?? 6,
    fallbackPhrases: agent.fallbackPhrases ?? [],
    dataFields: initialDataFields,
    humanTakeoverEnabled: agent.humanTakeoverEnabled ?? false,
    showTalkToHumanButton: agent.showTalkToHumanButton ?? false,
    humanConnectedLabel: agent.humanConnectedLabel ?? '',
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
  initialThemeData,
}: AgentEditorProviderProps) {
  const [savedFormData, setSavedFormData] =
    useState<AgentFormData>(initialFormData);
  const [formData, setFormData] = useState<AgentFormData>(initialFormData);

  // Deep-merge the saved theme over defaults so newly-added keys — top-level OR
  // nested (e.g. `handover.requestedLabel` / line colours) — are always present
  // with their defaults, even for themes saved before the key existed. A shallow
  // spread would let a stored `handover` object replace the default one whole,
  // leaving the new fields undefined (empty inputs / #000000 pickers).
  const baseTheme: WidgetTheme = deepMergeTheme(defaultWidgetTheme, initialThemeData);
  const [savedThemeData, setSavedThemeData] = useState<WidgetTheme>(baseTheme);
  const [themeData, setThemeData] = useState<WidgetTheme>(baseTheme);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

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
    setFieldErrors({});
  }, [savedFormData, savedThemeData]);

  const markSaved = useCallback((data: AgentFormData, theme?: WidgetTheme) => {
    setSavedFormData(data);
    setFormData(data);
    if (theme) {
      setSavedThemeData(theme);
      setThemeData(theme);
    }
    setFieldErrors({});
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
      fieldErrors,
      setFieldErrors,
      clearFieldError,
    }),
    [
      agent, formData, savedFormData, updateFormData,
      themeData, savedThemeData, updateThemeData,
      hasThemeChanges, hasUnsavedChanges, resetToSaved, markSaved,
      fieldErrors, clearFieldError,
    ],
  );

  return (
    <AgentEditorContext.Provider value={contextValue}>
      {children}
    </AgentEditorContext.Provider>
  );
}
