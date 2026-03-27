/**
 * HTML sanitizer using browser-native DOMParser + strict allowlist.
 * Zero dependencies, zero bundle cost — DOMParser is built into every browser.
 *
 * Pipeline: raw HTML → DOMParser → recursive tree walk → allowlisted output
 */

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li',
  'p', 'br', 'span', 'a', 'code', 'pre', 'blockquote',
]);

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Returns true if the string contains no HTML tags (pure text) */
export function isPlainText(input: string): boolean {
  return /^[^<>]*$/.test(input);
}

/**
 * Sanitize an HTML string: strip disallowed tags (preserving text content),
 * remove event handlers, validate href protocols, enforce link safety.
 */
export function sanitizeHtml(raw: string): string {
  if (!raw) return '';

  // Fast path: no HTML tags → just convert newlines to <br>
  if (isPlainText(raw)) {
    return escapeHtml(raw).replace(/\n/g, '<br>');
  }

  const doc = new DOMParser().parseFromString(raw, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

/** Escape HTML entities for plain text rendering */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Recursively sanitize a DOM node tree in-place */
function sanitizeNode(node: Node): void {
  // Walk children in reverse (safe for removal/insertion)
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i]!;

    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      // Script and style tags: remove entirely (including text content)
      if (tag === 'script' || tag === 'style') {
        el.parentNode!.removeChild(el);
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: replace element with its children (preserve text content)
        while (el.firstChild) {
          el.parentNode!.insertBefore(el.firstChild, el);
        }
        el.parentNode!.removeChild(el);
        // Re-scan from the same index since children were inserted
        i = Math.min(i + 1, node.childNodes.length);
        continue;
      }

      // Allowed tag — filter attributes
      filterAttributes(el);
      sanitizeNode(el);
    }
  }
}

/** Strip all attributes except explicitly allowed ones */
function filterAttributes(el: Element): void {
  const tag = el.tagName.toLowerCase();
  const toRemove: string[] = [];

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    const name = attr.name.toLowerCase();

    // Allow 'class' only on code/pre elements (for code highlighting)
    if (name === 'class' && (tag === 'code' || tag === 'pre')) continue;

    // Allow 'href' only on <a> tags, with protocol validation
    if (name === 'href' && tag === 'a') {
      if (!isHrefSafe(attr.value)) {
        toRemove.push(attr.name);
      }
      continue;
    }

    // Remove everything else (including all on* event handlers)
    toRemove.push(attr.name);
  }

  for (const name of toRemove) {
    el.removeAttribute(name);
  }

  // Enforce link safety on all <a> tags
  if (tag === 'a') {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * Validate that an href uses a safe protocol.
 * DOMParser already decodes HTML entities (&#106;avascript: → javascript:),
 * so we check the decoded value directly.
 */
function isHrefSafe(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed, 'https://placeholder.invalid');
    return SAFE_PROTOCOLS.has(url.protocol);
  } catch {
    // Relative URLs are safe (they resolve against the page origin)
    // But reject anything that looks like it has a protocol
    return !/^\s*[a-z][a-z0-9+.-]*:/i.test(trimmed);
  }
}
