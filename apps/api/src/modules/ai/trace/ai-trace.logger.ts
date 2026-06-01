import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';

/**
 * Dedicated Pino logger for AI orchestration traces.
 *
 * Writes to TWO destinations simultaneously:
 *   1. stdout via pino-pretty (dev only) — human-readable, colored, for `bun run dev` watching
 *   2. `logs/ai-trace.log` via pino-roll — newline-delimited JSON, daily rotation, 7-day retention
 *
 * Scope: this logger ONLY handles AI trace events. All other NestJS logs
 * (HTTP requests, DB queries, business events) continue to use the built-in
 * NestJS Logger. Keep this isolated to avoid blast-radius on unrelated code.
 *
 * Customisation via env vars:
 *   AI_TRACE_LOG_LEVEL    — pino level (default 'info')
 *   AI_TRACE_LOG_DIR      — log directory (default 'logs')
 *   AI_TRACE_LOG_STDOUT   — '0' to disable terminal output, '1' to force in prod (default: on in dev, off in prod)
 *   AI_TRACE_LOG_FILE     — '0' to disable file output (default: on)
 */

const logDir = process.env.AI_TRACE_LOG_DIR ?? 'logs';
const level = process.env.AI_TRACE_LOG_LEVEL ?? 'info';
const isDev = process.env.NODE_ENV !== 'production';

// Eagerly create the log directory — pino-roll will also do this but failing early
// on a bad path gives a clearer error than a silent worker crash.
try {
  mkdirSync(logDir, { recursive: true });
} catch {
  // If we can't create it, pino-roll will surface the error when it tries to write.
}

const stdoutEnabled = process.env.AI_TRACE_LOG_STDOUT
  ? process.env.AI_TRACE_LOG_STDOUT === '1'
  : isDev;
const fileEnabled = process.env.AI_TRACE_LOG_FILE !== '0';

// pino-pretty translateTime format reference:
//   'HH:MM:ss.l' → '14:23:01.234'

const targets: pino.TransportTargetOptions[] = [];

if (stdoutEnabled) {
  targets.push({
    target: 'pino-pretty',
    level,
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname,context',
      singleLine: false,
      messageFormat: '(ai.trace) {msg}',
    },
  });
}

if (fileEnabled) {
  targets.push({
    target: 'pino-roll',
    level,
    options: {
      file: join(logDir, 'ai-trace.log'),
      frequency: 'daily',
      size: '50m',
      limit: { count: 7 },
      mkdir: true,
    },
  });
}

/**
 * The AI trace logger. Always bind context via child loggers rather than
 * passing `context` in every call:
 *
 *   const log = aiTraceLogger.child({ traceId, agentId });
 *   log.info({ step: 'rag.vector_search', durationMs: 24, topK: 20 }, 'rag.vector_search');
 */
export const aiTraceLogger = pino(
  {
    level,
    base: { ctx: 'ai.trace' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  targets.length > 0
    ? pino.transport({ targets })
    : // Fallback: if both destinations disabled (pathological config), write nothing.
      // We still return a functional pino instance so callers don't NPE on .info().
      pino.destination({ dest: '/dev/null', sync: false }),
);
