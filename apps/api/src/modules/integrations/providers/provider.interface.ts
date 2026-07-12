import type { ToolSet } from 'ai';
import type { IntegrationProvider } from '@repo/validation';

/**
 * Step-indicator labels for a tool, shown live in the widget while the model
 * works ("Checking your CRM…" → "✓ Fetched customer data").
 */
export interface ToolStepMeta {
  activeLabel: string;
  doneLabel: string;
  errorLabel: string;
}

/** Result of a provider connection test (dashboard "Test" button). */
export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/**
 * Contract every concrete integration implements. Deliberately NOT a generic
 * connector platform: providers are first-class code, credentials are typed
 * per provider, API hosts are pinned constants inside each provider. The LLM
 * only ever sees tool name + description + input schema; credentials are
 * resolved server-side from the integration row (never from model output —
 * the confused-deputy rule from the integrations plan §7.2).
 */
export interface IntegrationProviderDef {
  readonly provider: IntegrationProvider;

  /** Parse + validate raw credentials; throws BadRequest-worthy ZodError. */
  parseCredentials(raw: unknown): Record<string, string>;

  /** Masked display hint for the dashboard, e.g. "pat-…4f2a". */
  credentialHint(credentials: Record<string, string>): string;

  /** Live connection test with the given credentials. Never throws. */
  testConnection(
    credentials: Record<string, string>,
  ): Promise<ConnectionTestResult>;

  /**
   * Build the AI SDK tools this integration contributes to a chat turn.
   * `execute` implementations must return STRINGS (structured error text on
   * failure, never throw — the model should be able to read the failure and
   * recover conversationally).
   */
  buildTools(credentials: Record<string, string>): ToolSet;

  /** Step labels keyed by tool name (must cover every tool in buildTools). */
  readonly toolStepMeta: Record<string, ToolStepMeta>;
}

/** Hard timeout for any single outbound tool call — chat UX beats completeness. */
export const TOOL_CALL_TIMEOUT_MS = 10_000;

/** Tool results are truncated to keep the model context bounded. */
export const TOOL_RESULT_MAX_CHARS = 4_000;

/** Truncate a tool result string to the shared cap. */
export function truncateToolResult(text: string): string {
  return text.length <= TOOL_RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n…[truncated]`;
}
