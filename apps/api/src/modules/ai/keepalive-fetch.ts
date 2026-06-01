import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Shared undici HTTP dispatcher with aggressive keep-alive. Reused across every
 * AI SDK provider (Gemini, OpenAI, Groq, OpenRouter) so a warm pool of TCP+TLS
 * connections persists between calls instead of re-handshaking every request.
 *
 * Why this exists:
 *   - Node's built-in `fetch` opens a fresh TCP+TLS connection per request
 *     (default Agent has keepAlive disabled on older Node versions, and
 *     connections idle-close quickly even when it's on).
 *   - TLS handshake to googleapis.com / openai.com adds 100-300ms per call
 *     — potentially multiple RTTs if the cluster is on a different continent
 *     from the LLM provider's endpoint.
 *   - Chat is a hot path: every saved handshake is one less second the user
 *     waits for the first token.
 *
 * Tunings:
 *   - keepAliveTimeout: 30s      — match typical LLM inter-call gap; keeps
 *                                   connections warm for back-and-forth chat
 *                                   without leaking idle sockets.
 *   - keepAliveMaxTimeout: 5min  — upper ceiling per RFC 9110; the upstream
 *                                   may close sooner (Cloudflare ~100s).
 *   - connections: 32            — max concurrent sockets per origin; plenty
 *                                   for a single-container API, way under
 *                                   LLM provider per-IP limits.
 *   - pipelining: 1              — disabled; LLM streaming responses aren't
 *                                   pipeline-safe (long-lived SSE/chunked).
 *
 * One dispatcher per process — it's stateful and reused by every caller.
 */
const aiDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 300_000,
  connections: 32,
  pipelining: 1,
});

/**
 * `fetch` wrapper that routes through the shared keep-alive dispatcher.
 *
 * Shape matches the global `fetch` so AI SDK providers accept it via their
 * `fetch` option. We cast through `unknown` because undici's fetch signature
 * is a near-superset of the Web Fetch API — compatible at runtime, not
 * structurally identical at compile time.
 */
export const keepAliveFetch = ((
  input: RequestInfo | URL,
  init?: RequestInit,
) =>
  undiciFetch(input as never, { ...init, dispatcher: aiDispatcher } as never)
) as unknown as typeof fetch;
