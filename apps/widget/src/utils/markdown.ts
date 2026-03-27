/**
 * Lightweight markdown-to-HTML converter for AI responses.
 * Only emits tags in the sanitizer allowlist — sanitizeHtml() is always run after.
 * Zero dependencies.
 */

/** Placeholder to protect code blocks from inline pattern processing */
const CODE_BLOCK_PLACEHOLDER = '\x00CB';
const INLINE_CODE_PLACEHOLDER = '\x00IC';

/**
 * Convert basic markdown to HTML.
 * Supports: bold, italic, links, inline code, code blocks, lists, paragraphs.
 */
export function markdownToHtml(text: string): string {
  if (!text) return '';

  let html = text;

  // Extract code blocks and inline code FIRST — replace with placeholders
  // so bold/italic/link regexes don't touch their contents
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code>${escapeForCodeBlock(code.trimEnd())}</code></pre>`);
    return `${CODE_BLOCK_PLACEHOLDER}${idx}${CODE_BLOCK_PLACEHOLDER}`;
  });

  // Inline code (` ... `)
  html = html.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeForCodeBlock(code)}</code>`);
    return `${INLINE_CODE_PLACEHOLDER}${idx}${INLINE_CODE_PLACEHOLDER}`;
  });

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (but not inside words for _)
  // Negative lookbehind prevents matching list markers: only match * when preceded by space/start after non-word
  html = html.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<em>$1</em>');

  // Links: [text](url) — escape quotes in URL to prevent attribute injection
  html = html.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_m, linkText, url) =>
    `<a href="${escapeAttr(url)}">${linkText}</a>`,
  );

  // Process lines for lists and paragraphs
  html = processBlocks(html);

  // Restore code blocks and inline codes from placeholders
  html = html.replace(
    new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)${CODE_BLOCK_PLACEHOLDER}`, 'g'),
    (_m, idx) => codeBlocks[parseInt(idx, 10)] ?? '',
  );
  html = html.replace(
    new RegExp(`${INLINE_CODE_PLACEHOLDER}(\\d+)${INLINE_CODE_PLACEHOLDER}`, 'g'),
    (_m, idx) => inlineCodes[parseInt(idx, 10)] ?? '',
  );

  return html;
}

/** Escape characters that would be interpreted as HTML inside code blocks */
function escapeForCodeBlock(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape characters in HTML attribute values */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/** Convert line-based structures: lists, paragraphs */
function processBlocks(html: string): string {
  const lines = html.split('\n');
  const result: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      result.push(`<p>${paragraph.join('\n')}</p>`);
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip code block placeholders — they are restored later
    if (line.includes(CODE_BLOCK_PLACEHOLDER)) {
      if (inList) { result.push(`</${inList}>`); inList = null; }
      flushParagraph();
      result.push(line);
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
    const olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);

    if (ulMatch) {
      flushParagraph();
      if (inList !== 'ul') {
        if (inList) result.push(`</${inList}>`);
        result.push('<ul>');
        inList = 'ul';
      }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      flushParagraph();
      if (inList !== 'ol') {
        if (inList) result.push(`</${inList}>`);
        result.push('<ol>');
        inList = 'ol';
      }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inList) {
        result.push(`</${inList}>`);
        inList = null;
      }

      // Empty line = paragraph break
      if (line.trim() === '') {
        flushParagraph();
      } else {
        paragraph.push(line);
      }
    }
  }

  if (inList) result.push(`</${inList}>`);
  flushParagraph();

  return result.join('\n');
}
