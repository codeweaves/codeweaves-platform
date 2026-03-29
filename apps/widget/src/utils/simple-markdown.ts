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
      htmlParts.push(`<li style="margin:2px 0;">${parseInline(ulMatch[1])}</li>`);
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
      htmlParts.push(`<li style="margin:2px 0;">${parseInline(olMatch[1])}</li>`);
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
