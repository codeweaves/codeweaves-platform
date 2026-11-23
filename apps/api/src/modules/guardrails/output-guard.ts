/**
 * Output guard for model replies (ADR-0018), streaming-safe.
 *
 * Two rules: the per-agent canary from the security preamble (its presence
 * means the model is echoing the system prompt), and credential patterns.
 *
 * Latency: text is released as soon as it ends in a character that cannot be
 * part of a canary or a credential (a space, punctuation, any non-Latin
 * letter). Only the trailing run of token characters is held back, usually
 * less than one word. A canary is one such run, so it can never be half-sent:
 * it is either fully released (and checked first) or fully held. A run longer
 * than MAX_HOLD is released anyway, so memory is bounded.
 *
 * Runs on the RAW model text, before the PII stream detokenizer: a re-hydrated
 * customer value is never mistaken for a secret, and the detokenizer still
 * receives whole `[CATEGORY_N]` placeholders (`[` and `]` are release points).
 */

export type OutputRule = "canary_leak" | `secret_${string}`;

export interface OutputViolation {
  rule: OutputRule;
}

/** Characters a canary or a credential is made of. Everything else is a release point. */
const TOKEN_CHAR = /[A-Za-z0-9_\-.+/=:@]/;

/** Longest token run held back before it is released unchecked-as-whole. */
export const MAX_HOLD = 512;

/**
 * Released text kept for the next check, so a pattern with spaces in it (a
 * PEM header) or one cut by MAX_HOLD is still caught when its end arrives.
 */
const TAIL_LEN = 128;

const SECRET_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "openai_key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { id: "stripe_clerk_key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { id: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { id: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "slack_token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  {
    id: "github_token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/,
  },
  {
    id: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  // The header alone appears in docs; a real key has its base64 body after it.
  {
    id: "private_key",
    re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----\s*[A-Za-z0-9+/]{40,}/,
  },
  // A password that is not an obvious docs placeholder (user:password@, <pass>).
  {
    id: "database_url",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:@/]*:(?!(?:password|passwd|pass|pwd|secret|changeme|your[-_]?password|x{3,}|\*+|<[^>@\s]*>|\[[^\]@\s]*\]|\{[^}@\s]*\})@)[^\s@/]+@/i,
  },
];

/** First violation in `text`, or null. Pure. */
export function findOutputViolation(
  text: string,
  canary: string | null,
): OutputViolation | null {
  if (canary && text.toLowerCase().includes(canary)) {
    return { rule: "canary_leak" };
  }
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) return { rule: `secret_${p.id}` };
  }
  return null;
}

export interface OutputGuardOptions {
  /** Lower-case canary; null skips the canary rule. */
  canary: string | null;
  /** false = monitor mode: record the violation but keep releasing text. */
  enforce: boolean;
}

export class StreamOutputGuard {
  private held = "";
  private tail = "";
  private found: OutputViolation | null = null;
  private stopped = false;

  constructor(private readonly opts: OutputGuardOptions) {}

  /** The first violation seen (in either mode), or null. */
  get violation(): OutputViolation | null {
    return this.found;
  }

  /** True once an enforced violation has stopped the stream. */
  get blocked(): boolean {
    return this.stopped;
  }

  /** Process one delta; returns the text that is safe to send now. */
  push(delta: string): string {
    if (this.stopped) return "";
    this.held += delta;
    let cut = this.held.length;
    while (cut > 0 && TOKEN_CHAR.test(this.held[cut - 1]!)) cut--;
    if (this.held.length - cut > MAX_HOLD) cut = this.held.length;
    if (cut === 0) return "";
    const release = this.held.slice(0, cut);
    this.held = this.held.slice(cut);
    return this.check(release);
  }

  /** Release whatever is still held (call once, after the stream ends). */
  end(): string {
    if (this.stopped) return "";
    const rest = this.held;
    this.held = "";
    return this.check(rest);
  }

  private check(release: string): string {
    if (!release) return "";
    const window = this.tail + release;
    this.tail = window.slice(-TAIL_LEN);
    if (!this.found) {
      const v = findOutputViolation(window, this.opts.canary);
      if (v) {
        this.found = v;
        if (this.opts.enforce) {
          this.stopped = true;
          this.held = "";
          return "";
        }
      }
    }
    return release;
  }
}
