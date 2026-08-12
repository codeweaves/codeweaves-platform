/**
 * Rebuilds the DISPLAY text for each sentence the voice pipeline emits,
 * including the whitespace that preceded it in the original reply.
 *
 * Why this exists: `SentenceBuffer` hands back trimmed sentences, which is what
 * TTS wants but throws away the newline between list items. The client has no
 * way to know what was dropped, so it joins the pieces with a space — turning
 *
 *     - MNC PMS: focuses on large caps.
 *     - Impress PMS: multi-cap strategy.
 *
 * into "- MNC PMS: focuses on large caps. - Impress PMS: multi-cap strategy.",
 * one line, which Markdown renders as a SINGLE bullet. The list only springs
 * apart at the end of the reply, when the full text replaces the streamed
 * transcript. On a voice turn that's the whole answer spent looking at the wrong
 * layout.
 *
 * Slicing out of the accumulated raw text keeps the real separator, so the
 * progressive transcript is identical to the finished one and the client can
 * concatenate chunks verbatim.
 */
export class DisplayTextTracker {
  private consumed = 0;

  /** @param source Returns the raw reply text accumulated so far. */
  constructor(private readonly source: () => string) {}

  /**
   * Display text for `sentence`: the sentence itself plus whatever whitespace
   * sat between it and the previous one. Falls back to the bare sentence if it
   * can't be located in the raw text (defensive — the buffer only ever trims).
   */
  next(sentence: string): string {
    const raw = this.source();
    const start = raw.indexOf(sentence, this.consumed);
    if (start === -1) return sentence;
    const end = start + sentence.length;
    const display = raw.slice(this.consumed, end);
    this.consumed = end;
    return display;
  }
}
