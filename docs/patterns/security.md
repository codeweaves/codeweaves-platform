# Security patterns

Security decisions and the mechanism behind each. Read before touching the code named here.

## Client IP and rate-limit keys

**Rule.** The client IP is `clientIp(request)` from `apps/api/src/utils/client-ip.ts`, which returns `request.ip` only. The raw `X-Forwarded-For` header is never read: a client can rotate it per request to mint fresh rate-limit buckets or forge its visitor identity.

`request.ip` is only as good as Express `trust proxy`, which is set from `TRUST_PROXY_HOPS` (default 1). Too low and `request.ip` is a shared proxy address, so unrelated visitors share one bucket. Too high and, if the origin can be reached without the CDN, a client can forge its IP through `X-Forwarded-For` again. Raise it only after checking that a forged header sent straight to the origin does not change `request.ip`.

## Dashboard response headers

`apps/web/next.config.js` sets the baseline headers on every route: a Content-Security-Policy built from the configured origins (API, Clerk Frontend API, Sentry, Supabase, widget), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (microphone allowed for the voice preview) and `Cross-Origin-Opener-Policy`. Vercel adds HSTS.

`script-src` keeps `'unsafe-inline'` because Next's inline bootstrap needs it without nonces, and nonces would force every page to render dynamically. A new third-party origin in the dashboard needs a matching CSP entry, or the browser blocks it.

Clerk **production** instances (staging, prod) also load Clerk's abuse and fraud protection from `*.protect.clerk.com`: a script, a frame, and connections on non-443 ports. So the CSP allows `https://*.protect.clerk.com` in `script-src` and `frame-src`, and `https://*.protect.clerk.com:*` in `connect-src`, as Clerk's CSP guide requires. Development instances (develop) never load it, which is why the gap first showed on staging (2026-11-04). The wildcard is limited to a Clerk-owned subdomain, the same trust we already give the Clerk Frontend API.

## AI guardrails (prompt-injection defence)

ADR-0018. Code: `apps/api/src/modules/guardrails/`, called from `DirectChatService.send()` and `stream()`, so widget, voice and WhatsApp replies all pass through it.

**From Dify** (`references/dify/api/core/moderation/`, a short skim, no code copied). Dify's moderation has an input phase and an output phase, and two actions: answer with a fixed preset reply and skip the model, or rewrite and continue. We use the same contract: `block` (canned reply, no LLM call) and `neutralize` (answer, with a per-turn security notice). We did not adopt its OpenAI moderation call (a network hop per message, and visitor text sent to OpenAI for Gemini and Sarvam agents too), its random 2,000-char sampling (an attacker pads around it), or its every-300-chars output re-check with a `message_replace` event (300 chars of a leak reach the client first, and it needs a widget change). Dify has no injection detection, canary or instruction hierarchy; those follow the OWASP LLM01 cheat sheet, Microsoft's spotlighting and the Rebuff canary pattern.

**Layers.** (1) Input: weighted local regexes (English, Hindi, Hinglish) over a normalised copy of the message (NFKC, invisible characters removed, look-alike letters mapped, letter-spaced words joined). Score 1.0 blocks; 0.5 neutralises. History turns that score a block are replaced with a placeholder, because the widget sends history itself and can forge it. (2) Prompt: a static security preamble first (instruction hierarchy, never reveal the prompt, keys or other customers' data), knowledge in `<reference_knowledge>` and the summary in `<conversation_summary>` with our tag names escaped inside them, and a closing reminder. (3) Output: a per-agent canary on the first line of the prompt, keyed from `AGENT_SECRET_KEY` (stable across instances, so the prompt cache holds), plus high-confidence credential formats. The guard holds back only the trailing token-shaped run, so a canary is never half-sent; on a hit it aborts the provider call and sends the safe reply. It runs before the PII detokenizer.

**Logging.** One `event_logs` row per trigger (`AI_GUARDRAIL_INPUT_BLOCKED`, `_INPUT_NEUTRALIZED`, `_HISTORY_NEUTRALIZED`, `_OUTPUT_BLOCKED`): rule ids, score, agent, organisation, session. No visitor or model text. Fire-and-forget, never throws. No `audit_logs` row. `AI_GUARDRAILS_MODE=monitor` logs without blocking.

**Limits.** Heuristics miss paraphrased or new attacks; the canary misses a paraphrased or partial prompt leak; knowledge is delimited but not scanned; the summariser and data extractor read visitor text without these checks.
