/**
 * Lightweight markdown-to-HTML converter for chat messages.
 *
 * Supports: **bold**, *italic*, `code`, [links](url),
 * unordered lists (- item), ordered lists (1. item), and line breaks.
 *
 * No external dependencies — keeps widget bundle small.
 * Output is sanitized: no script injection, only safe HTML tags.
 */

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert inline markdown (bold, italic, code, links) to HTML */
function parseInline(text: string): string {
  let result = escapeHtml(text);

  // Code (backticks) — must be before bold/italic to avoid conflicts
  result = result.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:0.85em;">$1</code>');

  // Bold (**text** or __text__)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600;">$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong style="font-weight:600;">$1</strong>');

  // Italic (*text* or _text_) — avoid matching inside bold
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

  // Links [text](url) — only allow http(s) URLs
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">$1</a>',
  );

  return result;
}

/**
 * Hide a trailing markdown construct that hasn't finished arriving yet.
 *
 * A streamed reply is rendered on every chunk, so mid-flight the tail can be a
 * half-written link — "see [Impress PMS](htt" — which renderMarkdown has no
 * choice but to show as raw text, URL and all. Cutting the unterminated tail
 * means the link simply appears complete a moment later instead of unspooling
 * its syntax on screen.
 *
 * Only ever trims the END of the string, and only for constructs whose raw form
 * is genuinely ugly (links, images, code). Emphasis markers are left alone: a
 * stray "**" for one frame is not worth the risk of eating real text.
 */
export function stripTrailingIncompleteMarkdown(text: string): string {
  if (!text) return text;
  let out = text;

  // Unclosed link / image: cut back to its opening bracket. A bare "[text]"
  // with nothing following is legitimate prose and stays.
  const bracket = out.lastIndexOf('[');
  if (bracket !== -1) {
    const tail = out.slice(bracket);
    // `(?:$|[^(])` — a bracketed phrase that ENDS the text is finished prose,
    // not a link mid-flight. Requiring a character after "]" would hide real
    // content on every frame whose last token happens to be "]".
    const complete =
      /^\[[^\]]*\]\([^)]*\)/.test(tail) || /^\[[^\]]*\](?:$|[^(])/.test(tail);
    if (!complete) {
      // Include the "!" of an image so "![alt" doesn't leave a dangling "!".
      out = out.slice(0, bracket > 0 && out[bracket - 1] === '!' ? bracket - 1 : bracket);
    }
  }

  // Unterminated code fence, then an odd backtick (an inline span still open).
  const fences = out.split('```').length - 1;
  if (fences % 2 === 1) {
    out = out.slice(0, out.lastIndexOf('```'));
  } else if ((out.match(/`/g) ?? []).length % 2 === 1) {
    out = out.slice(0, out.lastIndexOf('`'));
  }

  return out;
}

/** Parse markdown text into safe HTML string */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;

  function closeList(): void {
    if (inUl) { htmlParts.push('</ul>'); inUl = false; }
    if (inOl) { htmlParts.push('</ol>'); inOl = false; }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Unordered list: - item or * item
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inUl) {
        closeList();
        htmlParts.push('<ul style="list-style:disc;padding-left:1.25rem;margin:0.25rem 0;">');
        inUl = true;
      }
      htmlParts.push(`<li style="margin:2px 0;">${parseInline(ulMatch[1]!)}</li>`);
      continue;
    }

    // Ordered list: 1. item
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inOl) {
        closeList();
        htmlParts.push('<ol style="list-style:decimal;padding-left:1.25rem;margin:0.25rem 0;">');
        inOl = true;
      }
      htmlParts.push(`<li style="margin:2px 0;">${parseInline(olMatch[1]!)}</li>`);
      continue;
    }

    // Not a list item — close any open list
    closeList();

    // Empty line = paragraph break
    if (!trimmed) {
      htmlParts.push('<br/>');
      continue;
    }

    // Regular text
    htmlParts.push(`<p style="margin:0.15rem 0;">${parseInline(trimmed)}</p>`);
  }

  closeList();
  return htmlParts.join('');
}
