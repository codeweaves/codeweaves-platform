/**
 * Slack webhook and Better Stack heartbeat URLs carry their secret in the path.
 * Keep only the origin for event_logs, so the secret never lands in a row.
 */
export function redactUrlPath(url: string): string {
  try {
    return `${new URL(url).origin}/[REDACTED]`;
  } catch {
    return "[REDACTED]";
  }
}
