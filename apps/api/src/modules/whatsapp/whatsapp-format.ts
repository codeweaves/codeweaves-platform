/**
 * Convert the Markdown an LLM emits into WhatsApp's own text-formatting syntax.
 *
 * WhatsApp is NOT Markdown:
 *   bold     *text*       (single asterisks)   <- Markdown uses **text**
 *   italic   _text_                             <- Markdown uses *text* or _text_
 *   strike   ~text~
 *   code     ```block``` / `inline`             (kept as-is)
 *
 * Without this, a reply like "**Hi** [docs](https://x.com)" renders on WhatsApp
 * literally as "**Hi** [docs](https://x.com)" — visible asterisks and link syntax.
 *
 * Applied at SEND time only. The stored ChatMessage keeps the original Markdown so
 * the widget + conversation history stay channel-neutral.
 */

// NUL-byte sentinels, built via fromCharCode so the source stays pure ASCII. They
// contain no '*' (the italic pass can't mistake them for emphasis) and never occur
// in real LLM text (no false collisions). All are stripped before returning.
const NUL = String.fromCharCode(0);
const BOLD = `${NUL}B${NUL}`;
const codeToken = (i: number) => `${NUL}C${i}${NUL}`;
const BOLD_COLLAPSE = new RegExp(`(?:${NUL}B${NUL}){2,}`, 'g');

export function markdownToWhatsapp(input: string): string {
  if (!input) return input;

  // 1. Protect code (fenced ``` blocks + `inline`) from every transform below.
  const codeBlocks: string[] = [];
  let text = input.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    codeBlocks.push(m);
    return codeToken(codeBlocks.length - 1);
  });

  // 2. Headings (#..######) -> bold the line (WhatsApp has no headings).
  text = text.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, `${BOLD}$1${BOLD}`);

  // 3. Bullets: Markdown "* "/"+ " -> "- " ("* " would collide with bold).
  text = text.replace(/^([ \t]*)[*+][ \t]+/gm, '$1- ');

  // 4. Bold: **x** / __x__ -> sentinel-wrapped, so the single '*' we emit for
  //    italic next can't be confused with it.
  text = text.replace(/\*\*(.+?)\*\*/gs, `${BOLD}$1${BOLD}`);
  text = text.replace(/__(.+?)__/gs, `${BOLD}$1${BOLD}`);

  // 5. Italic: Markdown *x* -> WhatsApp _x_. (Markdown _x_ already matches WA, so
  //    underscores are left untouched.) Guards avoid matching list/space edges.
  text = text.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '_$1_');

  // 6. Images ![alt](url) -> url ; links [text](url) -> "text (url)".
  text = text.replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)');

  // 7. Collapse nested/adjacent bold sentinels, then restore as WhatsApp '*'.
  text = text.replace(BOLD_COLLAPSE, BOLD).split(BOLD).join('*');

  // 8. Restore protected code spans verbatim (function replacer avoids '$' issues).
  codeBlocks.forEach((block, i) => {
    text = text.replace(codeToken(i), () => block);
  });

  // 9. Tidy: collapse 3+ blank lines and trim.
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// Markdown -> plain prose for TTS now lives with the rest of the speech-text
// handling (URL and emoji stripping) in common/text/speakable-text.ts, so the
// WhatsApp voice note and the widget voice turn speak text the same way.
// Re-exported for the existing import sites.
export { markdownToPlainText } from '../../common/text/speakable-text';
