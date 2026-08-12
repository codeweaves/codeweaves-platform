/**
 * Text destined for a TTS engine — "what the agent SAYS", as opposed to "what
 * the agent WROTE".
 *
 * The LLM writes one string that serves two very different consumers:
 *   - the chat transcript / WhatsApp message, which WANTS Markdown and links
 *   - the voice pipeline, which has to pronounce every character it is given
 *
 * Handed raw Markdown, a TTS engine reads the syntax out loud: an answer with
 * four link references becomes half a minute of "h-t-t-p-s colon slash slash
 * w-w-w dot ... dot p-h-p". So the voice paths run their text through
 * `toSpeakableText()` first and keep the ORIGINAL string for display.
 *
 * Every transform here is display-safe by construction: callers pass a copy,
 * never the stored message.
 */

/** Emoji / pictographs / flags / skin-tone + variation modifiers / ZWJ / keycap. */
const EMOJI_SYMBOL_RE =
  // Intentionally matches emoji plus their ZWJ / variation-selector / skin-tone /
  // keycap "glue" so compound emoji strip cleanly. The misleading-character-class
  // rule is about accidental combos; here it's deliberate.
  // eslint-disable-next-line no-misleading-character-class
  /[0-9#*]\u{FE0F}?\u{20E3}|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\p{Extended_Pictographic}]/gu;

/**
 * A URL together with any bracket it sits inside, so "see (https://x.com/a)"
 * doesn't leave an empty "( )" behind for the engine to pause on.
 *
 * Deliberately scoped to explicit URLs (`http://`, `https://`, `www.`). A bare
 * "anandrathipms.com" reads acceptably as speech, and a looser pattern starts
 * eating ordinary prose ("e.g.", version numbers, file names).
 */
const URL_WITH_WRAPPER_RE =
  /[([<]?\s*(?:https?:\/\/|www\.)[^\s<>()[\]{}"'`]+[)\]>]?/gi;

/**
 * Strip Markdown down to plain prose for TTS, so the agent speaks the words and
 * not the symbols (no "asterisk asterisk bold"). Keeps the text inside emphasis,
 * headings, links, and code; drops the markers.
 */
export function markdownToPlainText(input: string): string {
  if (!input) return input;
  let text = input;
  // Fenced code blocks -> keep the inner content (drop the fences/lang).
  text = text.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  // Inline code -> content.
  text = text.replace(/`([^`\n]+)`/g, '$1');
  // Images -> alt text; links -> link text.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Heading markers.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  // Blockquote + list markers at line start — BEFORE the emphasis strip, so a
  // "* " bullet isn't mistaken for (and partly eaten by) an emphasis marker.
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  // Emphasis / strikethrough markers.
  text = text.replace(/\*\*|__|~~|\*|_|~/g, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Drop explicit URLs. Runs AFTER `markdownToPlainText`, so `[MNC PMS](https://…)`
 * has already collapsed to its label "MNC PMS" and only genuinely bare URLs are
 * left — those carry no spoken meaning, and the user can see (and click) them in
 * the transcript.
 */
export function stripUrlsForSpeech(text: string): string {
  if (!text) return text;
  return text.replace(URL_WITH_WRAPPER_RE, ' ');
}

/**
 * Turn line breaks into sentence breaks so a bulleted list gets spoken with
 * pauses ("MNC PMS. Impress PMS. Decennium PMS.") instead of running together
 * once the whitespace is collapsed. Skipped where the line already ends in
 * punctuation, so we never emit ".." or ":.".
 */
function lineBreaksToPauses(text: string): string {
  return text.replace(/[ \t]*\n+[ \t]*/g, (_match, offset: number) => {
    const preceding = text.slice(0, offset).trimEnd().slice(-1);
    if (!preceding) return ' ';
    return /[.,!?;:]/.test(preceding) ? ' ' : '. ';
  });
}

/**
 * Clean up the artifacts the strips above leave behind — a removed URL turns
 * "view it here: ." into "view it here." rather than a stray dangling colon.
 */
function tidySpokenPunctuation(text: string): string {
  return text
    // Empty brackets left where a wrapped URL used to be.
    .replace(/\(\s*\)|\[\s*\]|<\s*>/g, ' ')
    // " ." -> "."
    .replace(/\s+([.,!?;:])/g, '$1')
    // "here: ." -> "here."
    .replace(/[:;,]\s*(?=[.!?])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Text to SEND TO TTS: Markdown syntax removed, URLs dropped, emoji stripped,
 * whitespace collapsed. Callers keep the ORIGINAL text for the transcript.
 *
 * Emoji matter beyond politeness: Sarvam's TTS 400s on text with no language
 * characters ("Text must contain at least one character from the allowed
 * languages"), and a bare/trailing "🔧🤖" is the classic trigger. Same for a
 * sentence that was nothing but a link — check `hasSpeakableContent()` on the
 * result and skip synthesis when it comes back false.
 *
 * Idempotent: safe to call on text that has already been through it.
 */
export function toSpeakableText(text: string): string {
  if (!text) return '';
  let out = markdownToPlainText(text);
  out = stripUrlsForSpeech(out);
  out = out.replace(EMOJI_SYMBOL_RE, '');
  // Residual Markdown noise the passes above can leave when a construct is
  // split across chunks (an unpaired backtick, a table pipe).
  out = out.replace(/[`|]/g, ' ');
  out = lineBreaksToPauses(out);
  return tidySpokenPunctuation(out);
}

/** True when there's something worth speaking (≥1 letter or digit). Emoji-only /
 *  punctuation-only / URL-only chunks return false → skip TTS entirely (still
 *  shown as text). */
export function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
