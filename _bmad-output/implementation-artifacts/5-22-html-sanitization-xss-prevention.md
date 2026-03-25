# Story 5-22: HTML Sanitization & XSS Prevention

Status: ready-for-dev

## Story
As a **website visitor**, I want AI responses with formatting (bold, links, lists) to render correctly and safely, so that I can read well-structured answers without being exposed to malicious content.

## Acceptance Criteria
1. Basic HTML formatting renders correctly (bold, italic, lists, links, code blocks)
2. All script tags and event handlers are stripped
3. Links open in new tab with `noopener noreferrer`
4. `javascript:` and `data:` URLs are blocked
5. No external sanitization library used — native DOMParser only (bundle size)
6. User messages always rendered as plain text
7. Passes all OWASP XSS vector tests

## Tasks / Subtasks
- [ ] Create HTML sanitizer utility (AC: #1, #2, #4, #5)
  - [ ] Create `apps/widget/src/utils/sanitizer.ts`
  - [ ] Implement `sanitizeHtml(rawHtml: string): string` using browser-native `DOMParser` + allowlist approach
  - [ ] Parse input with `new DOMParser().parseFromString(html, 'text/html')`
  - [ ] Walk DOM tree recursively, remove any element not in the allowlist
  - [ ] Allowed tags: `b`, `strong`, `i`, `em`, `u`, `ul`, `ol`, `li`, `p`, `br`, `span`, `a`, `code`, `pre`, `blockquote`
  - [ ] Allowed attributes: `href` (on `<a>` only, protocol-validated), `class` (for code highlighting)
  - [ ] Strip ALL other tags (unwrap children into parent, don't delete text content)
  - [ ] Strip ALL event handler attributes (`on*` pattern: `onclick`, `onerror`, `onload`, `onmouseover`, etc.)
  - [ ] Keep sanitizer under 50 lines of code — strict allowlist, not a full parser
- [ ] Implement href protocol validation (AC: #3, #4)
  - [ ] Only allow `http:`, `https:`, and `mailto:` protocols in `href` attributes
  - [ ] Block `javascript:`, `data:`, `vbscript:`, `blob:`, and any unknown protocol
  - [ ] Strip `href` entirely if protocol is not allowed (keep the `<a>` text content)
  - [ ] Normalize href: trim whitespace, lowercase protocol check to handle `JavaScript:` case
  - [ ] Handle URL-encoded `javascript:` variants (e.g., `java&#x73;cript:`)
- [ ] Implement link safety attributes (AC: #3)
  - [ ] All `<a>` tags get: `target="_blank"`, `rel="noopener noreferrer"`
  - [ ] Apply these attributes unconditionally to every `<a>` element after sanitization
  - [ ] Links open in new tab — never navigate away from the host page
- [ ] Implement plain text detection and fallback (AC: #1, #6)
  - [ ] `isPlainText(input: string): boolean` — returns true if input contains no HTML tags
  - [ ] Check with regex: `/^[^<>]*$/` (no angle brackets = plain text)
  - [ ] If plain text: convert `\n` to `<br>` and return (skip full sanitizer overhead)
  - [ ] If HTML detected: run through full sanitizer pipeline
- [ ] Wire into MessageBubble component (AC: #1, #6)
  - [ ] Bot messages: pass `content` through `sanitizeHtml()` before rendering with `dangerouslySetInnerHTML`
  - [ ] User messages: always render as plain text (escape HTML entities, never interpret as HTML)
  - [ ] Audio messages: no sanitization needed (audio bubbles render player UI, not text)
  - [ ] System messages: sanitize same as bot messages
- [ ] Validate against XSS attack vectors (AC: #2, #7)
  - [ ] `<script>alert('xss')</script>` -> script tag stripped, text content removed
  - [ ] `<img src=x onerror=alert('xss')>` -> img tag stripped entirely (not in allowlist)
  - [ ] `<a href="javascript:alert('xss')">click</a>` -> href removed, text "click" preserved
  - [ ] `<div onmouseover="alert('xss')">text</div>` -> div unwrapped, event handler stripped, "text" preserved
  - [ ] `<scr<script>ipt>alert('xss')</scr</script>ipt>` -> DOMParser handles nested tags correctly
  - [ ] `<svg onload="alert('xss')">` -> svg stripped entirely (not in allowlist)
  - [ ] `<a href="&#106;avascript:alert('xss')">` -> URL-decoded by DOMParser, `javascript:` protocol detected and blocked
  - [ ] `<iframe src="data:text/html,<script>alert(1)</script>">` -> iframe stripped (not in allowlist)
  - [ ] `<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>` -> all stripped (not in allowlist)
  - [ ] `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">` -> `data:` protocol blocked

## Dev Notes

### Sanitizer Implementation Strategy
Using `DOMParser` is both free (0KB bundle) and secure because the browser's HTML parser handles all edge cases (nested tags, encoding, malformed HTML). The approach:

1. Parse raw HTML string into a DOM tree via `DOMParser`
2. Walk the tree recursively
3. For each element: if tag is in allowlist, keep it (with filtered attributes); otherwise, replace with its text/child content
4. Serialize cleaned DOM back to HTML string

```ts
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'p', 'br', 'span', 'a', 'code', 'pre', 'blockquote']);
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function sanitizeNode(node: Node): void {
  // Walk children in reverse (safe for removal)
  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
        // Replace element with its children
        while (el.firstChild) el.parentNode!.insertBefore(el.firstChild, el);
        el.parentNode!.removeChild(el);
      } else {
        // Strip disallowed attributes
        filterAttributes(el);
        sanitizeNode(el);
      }
    }
  }
}
```

### Why Not DOMPurify
DOMPurify is the gold standard for HTML sanitization (~15KB minified, ~6KB gzipped). For a typical web app, it is the right choice. However, for an embeddable widget where every KB matters:
- The widget has a strict bundle budget
- The allowlist is small and well-defined (16 tags)
- `DOMParser` is available in all modern browsers
- Shadow DOM provides an additional isolation layer (but is NOT a substitute for sanitization)

### Plain Text Optimization
Most AI responses are plain text or simple markdown-converted HTML. The `isPlainText()` check avoids `DOMParser` overhead for the common case:
```ts
function isPlainText(input: string): boolean {
  return /^[^<>]*$/.test(input);
}
```

### User Message Safety
User messages are ALWAYS rendered as plain text — never passed through `dangerouslySetInnerHTML`. This is enforced at the component level in MessageBubble, not just by convention.

### Component Structure
- Widget app: `apps/widget/` using Preact 10.26.0
- Shadow DOM: closed, with constructable stylesheets
- Preact components use `class` attribute (not `className`)
- `dangerouslySetInnerHTML` in Preact works the same as React

### References
- MessageBubble component: `apps/widget/src/components/MessageBubble.tsx` (Story 5-9)
- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP XSS Filter Evasion: https://owasp.org/www-community/xss-filter-evasion-cheatsheet
