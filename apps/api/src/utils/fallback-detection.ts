/**
 * Detects whether an assistant reply is a "couldn't answer" (fallback) reply,
 * by fuzzy-matching it against the agent's configured fallback phrases.
 *
 * Dependency-free: uses the Sørensen–Dice coefficient over character bigrams
 * (0..1 similarity, robust to minor wording/punctuation differences). The
 * agent is prompted to reply with ONLY a fallback phrase when it gives up, so
 * a true fallback reply is ~the phrase — which is exactly what this catches.
 * (If agents start paraphrasing heavily, swap in embedding cosine later; the
 * call sites and the stored score stay the same.)
 *
 * Cheap, and called AFTER the reply is already sent to the user, so it adds
 * zero latency to the conversation.
 */

/** Best-match similarity at/above this counts as a fallback. Tune via the stored score. */
const SIMILARITY_THRESHOLD = 0.7;
/** Replies longer than this multiple of the longest phrase are real answers — skip the compare. */
const LENGTH_FACTOR = 1.5;

export interface FallbackResult {
  /**
   * true  = judged a "couldn't answer"
   * false = evaluated and it was a real answer
   * null  = not evaluated (agent has no phrases) — excluded from the rate denominator
   */
  couldntAnswer: boolean | null;
  /** Best similarity (0..1) against the phrases; null when not evaluated. */
  couldntAnswerScore: number | null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sørensen–Dice coefficient over character bigrams. Returns 0..1. */
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };

  const a2 = bigrams(a);
  const b2 = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of a2) {
    const bc = b2.get(bg);
    if (bc) overlap += Math.min(count, bc);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/**
 * @param reply   The assistant's reply text.
 * @param phrases The agent's configured fallback phrases (0–3).
 */
export function detectFallback(reply: string, phrases: string[] | null | undefined): FallbackResult {
  if (!phrases || phrases.length === 0) return { couldntAnswer: null, couldntAnswerScore: null };

  const r = normalize(reply);
  if (!r) return { couldntAnswer: null, couldntAnswerScore: null };

  const normPhrases = phrases.map(normalize).filter((p) => p.length > 0);
  if (normPhrases.length === 0) return { couldntAnswer: null, couldntAnswerScore: null };

  // Length pre-filter: a genuine give-up reply is ~the phrase; a real answer is
  // much longer. Skip the comparison entirely for clearly-long replies.
  const longest = Math.max(...normPhrases.map((p) => p.length));
  if (r.length > longest * LENGTH_FACTOR) return { couldntAnswer: false, couldntAnswerScore: 0 };

  let best = 0;
  for (const p of normPhrases) {
    const sim = diceSimilarity(r, p);
    if (sim > best) best = sim;
  }

  return {
    couldntAnswer: best >= SIMILARITY_THRESHOLD,
    couldntAnswerScore: Math.round(best * 1000) / 1000,
  };
}
