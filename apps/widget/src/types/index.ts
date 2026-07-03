/** Widget initialization configuration passed via script tag data attributes */
export interface WidgetConfig {
  /** The agent's public ID (from script tag) */
  agentId: string;
  /** API base URL for fetching configuration */
  apiBaseUrl: string;
}

/** Theme properties matching the --cw-* CSS custom property namespace */
export interface WidgetTheme {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  border: string;
  radius: string;
  fontFamily: string;
  fontSize: string;
}

/** Widget state: closed (trigger visible), expanded (full chat), minimized (header-only) */
export type WidgetState = 'closed' | 'expanded' | 'minimized';

/** Agent information returned by the config API */
export interface AgentConfig {
  name: string;
  greeting: string;
  starters: string[];
  voiceEnabled?: boolean;
  voiceConfig?: {
    sttEnabled?: boolean;
    ttsEnabled?: boolean;
    defaultLanguage?: string;
    supportedLanguages?: string[];
    autoDetectLanguage?: boolean;
  } | null;
  /** Human handover (live agent takeover). Button shows only when both are true. */
  humanTakeoverEnabled?: boolean;
  showTalkToHumanButton?: boolean;
  /** Shown to the visitor when a teammate connects (also the button's tooltip fallback). */
  humanConnectedLabel?: string | null;
}

/** Full widget configuration loaded from the API */
export interface LoadedWidgetConfig {
  theme: Record<string, unknown> | null;
  agent: AgentConfig;
  allowedDomains: string[];
}

/** A single chat message — alias for Message (Story 5-21 migration) */
export type { Message as ChatMessage } from './message';

/** Response from POST /public/chat/send */
export interface SendMessageResponse {
  sessionId: string;
  messageId: string;
  reply: string;
  assistantMessageId: string;
  metadata: {
    streamingMode: string;
    backendReceivedAt: string;
    n8nReceivedAt: string | null;
    agentRepliedAt: string | null;
    backendRespondedAt: string;
    responseLatencyMs: number;
  };
}

/** Rate-limit error body from the chat endpoints */
export interface RateLimitErrorBody {
  error: true;
  message: string;
  retryAfterSeconds: number;
}
