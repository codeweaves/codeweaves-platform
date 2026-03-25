# Embeddable Chat Widget Architecture Research

Deep research into how production chat widgets are actually implemented, based on source code analysis of major open-source projects.

---

## 1. Chatwoot

**Source**: [github.com/chatwoot/chatwoot](https://github.com/chatwoot/chatwoot)

### Architecture: IFRAME (with direct-DOM trigger button)

Chatwoot uses a **two-part architecture**:
- **Trigger bubble button**: Vanilla JS DOM elements injected directly into host page (no Shadow DOM)
- **Chat window**: Full Vue.js app running inside an iframe

### How it works

**SDK Loader (`sdk.js`):**
- Injects a `<script>` tag that loads the Chatwoot SDK
- Creates DOM elements for the bubble holder and chat button
- Creates an iframe (`#chatwoot_live_chat_widget`) with the chat app URL

**Bubble creation (`bubbleHelpers.js`):**
```javascript
// Direct DOM creation - no Shadow DOM
export const bubbleHolder = document.createElement('div');
export const chatBubble = document.createElement('button');
export const closeBubble = document.createElement('button');
// ...
body.appendChild(bubbleHolder);
```

**Iframe creation (`IFrameHelper.js`):**
```javascript
const iframe = document.createElement('iframe');
iframe.id = 'chatwoot_live_chat_widget';
iframe.allow = 'camera;microphone;fullscreen;display-capture;picture-in-picture;clipboard-write;';
iframe.src = `${baseUrl}/widget?website_token=${token}`;
```

### CSS Isolation
- **Iframe**: Natural CSS isolation - the Vue app has its own document context
- **Bubble**: Uses `.woot-` prefixed class names to minimize conflicts. NO Shadow DOM.
- Global stylesheet injected with scoped classes

### Z-Index
- `z-index: 2147483000` on both bubble and widget holder (near max safe integer)
- `position: fixed !important`

### Sizing / Responsive
- Desktop: Fixed dimensions for the iframe holder
- Mobile (<=667px): Full-screen takeover (`100vw x 100vh`)
- `setFrameHeightToFitContent()` dynamically adjusts iframe height

### Communication
- **postMessage API** with `chatwoot-widget:` prefix
- Host sends: `iframe.contentWindow.postMessage('chatwoot-widget:' + JSON.stringify(...))`
- Host receives: `window.onmessage` listener parsing prefixed messages
- Events: widget state changes, conversation updates, agent messages

### Bundle Size
- The widget iframe loads the full Vue.js chat app (~200-300KB estimated)
- The SDK loader script itself is lightweight (~15-20KB)

### Key Takeaway
Chatwoot proves that **iframe for chat window + direct DOM for trigger button** is a battle-tested pattern used by thousands of production sites.

---

## 2. Botpress Webchat

**Source**: [github.com/botpress/messaging](https://github.com/botpress/messaging) (inject package)

### Architecture: IFRAME

Botpress uses an **iframe-based architecture** similar to Chatwoot:

**Injection pattern:**
```html
<script src="https://cdn.botpress.cloud/webchat/v2.3/inject.js"></script>
<script>
  window.botpressWebChat.init({
    host: 'https://cdn.botpress.cloud/webchat/v2.3',
    botId: 'YOUR_BOT_ID',
    botName: 'My Bot'
  });
</script>
```

### How it works
- `inject.js` creates an iframe element and appends it to the document body
- The webchat React app loads inside the iframe
- Communication via `postMessage` for events like conversation creation
- The `window.botpressWebChat` API exposes `init`, `open`, `close`, `sendEvent`, etc.

### CSS Isolation
- Full iframe isolation - chat UI styles cannot conflict with host page
- No Shadow DOM used

### Z-Index
- High z-index values on the iframe container (exact value in inject.js)
- Fixed positioning at bottom-right corner

### Bundle Size
- Inject script: ~10-15KB
- Full webchat app (loaded in iframe): larger, loaded asynchronously

### Key Takeaway
Botpress uses the same proven iframe pattern. The inject script is tiny; the heavy UI loads in the sandboxed iframe.

---

## 3. Typebot

**Source**: [github.com/baptisteArno/typebot.io](https://github.com/baptisteArno/typebot.io) (`packages/embeds/js`)

### Architecture: WEB COMPONENTS (Custom Elements) with SolidJS

Typebot takes a different approach from Chatwoot/Botpress. It uses **native Custom Elements** (Web Components).

### How it works

**Registration (`window.ts`):**
```javascript
// Creates custom elements and appends to body
function initBubble() {
  const element = document.createElement('typebot-bubble');
  Object.assign(element, props);
  document.body.prepend(element);
}

function initPopup() {
  const element = document.createElement('typebot-popup');
  Object.assign(element, props);
  document.body.prepend(element);
}

function initStandard() {
  // Finds existing <typebot-standard> element and assigns props
}
```

**Component rendering:**
- Built with **SolidJS** (not React) for smaller bundle size
- Components render via custom element definitions (`<typebot-bubble>`, `<typebot-popup>`, `<typebot-standard>`)
- Bubble button uses CSS animations: `hover:scale-110 active:scale-95 transition-transform`
- Uses CSS custom properties for dynamic sizing

### CSS Isolation
- Custom Elements with scoped styles
- Uses Tailwind-like utility classes compiled at build time
- Style injection happens within the component scope

### Z-Index
- Managed via CSS custom properties (`--button-size` etc.)
- Fixed positioning for bubble mode

### Bundle Size
- SolidJS keeps the bundle small compared to React-based alternatives
- The embed JS package is self-contained

### Key Takeaway
Typebot uses **Custom Elements + SolidJS** instead of iframes. This gives better performance but less isolation than iframe approach. No evidence of Shadow DOM usage in the custom elements.

---

## 4. Papercups

**Source**: [github.com/papercups-io/chat-widget](https://github.com/papercups-io/chat-widget) + [chat-window](https://github.com/papercups-io/chat-window)

### Architecture: IFRAME (two-repo split)

Papercups has one of the clearest iframe architectures:

- **`chat-widget`**: The outer shell (vanilla JS) that creates the iframe and trigger button
- **`chat-window`**: A separate React app that runs inside the iframe

### How it works

**Configuration flow:**
1. `widget.js` initializes from `window.Papercups` config
2. Combines client config with backend-fetched widget settings
3. Passes all config to the chat window iframe via **URL query parameters**
4. For React SDK usage, supports `config:update` postMessage events

**Communication:**
- Initial config: URL query params on iframe src
- Runtime updates: `postMessage` with `config:update` event type
- The vanilla JS library (`Papercups/Browser`) handles all conversation logic without React

### CSS Isolation
- Full iframe isolation
- Widget trigger button uses scoped class names in host page

### Key Takeaway
Papercups demonstrates the **cleanest separation**: config via URL params, updates via postMessage. The two-repo approach (widget shell + iframe app) is a strong architectural pattern.

---

## 5. Rocket.Chat LiveChat

**Source**: [github.com/RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) (`packages/livechat`)

### Architecture: IFRAME + Preact

Rocket.Chat LiveChat is notable because it uses **Preact** for the chat UI inside the iframe.

### How it works

**Widget injection (`widget.ts`):**
```javascript
// Creates wrapper div with iframe inside
const widget = document.createElement('div');
widget.className = 'rocketchat-widget';
// position: fixed

const iframe = document.createElement('iframe');
iframe.id = 'rocketchat-iframe';
// Loads the Preact livechat app

document.body.appendChild(widget);
```

### CSS Isolation
- Full iframe isolation
- Widget wrapper uses `.rocketchat-widget` class

### Z-Index
- `z-index: 12345` (notably lower than Chatwoot's 2147483000)
- `position: fixed`

### Sizing
Three states managed via constants:
- **Open**: 365px width x 525px height
- **Minimized**: 54px x 54px (just the button)
- **Margin**: 16px

### Responsive
- Detects mobile via `(max-device-width: 480px)` media query
- Mobile: full-screen (`100vh x 100%`) when opened
- Manages document scroll position for mobile interactions

### Communication
- Bidirectional `postMessage` API
- Messages include source identification and function call data

### Key Takeaway
Rocket.Chat proves that **Preact inside an iframe** works at scale. The livechat app is written in Preact for its small footprint. Z-index of 12345 is more conservative than Chatwoot.

---

## 6. n8n Chat Widget (`@n8n/chat`)

**Source**: [github.com/n8n-io/n8n](https://github.com/n8n-io/n8n) (`packages/@n8n/chat`) | [npm](https://www.npmjs.com/package/@n8n/chat)

### Architecture: DIRECT DOM INJECTION (Vue 3)

The n8n chat widget takes the simplest approach - it mounts a Vue 3 app directly into the host page DOM.

### How it works

**Initialization:**
```javascript
import { createChat } from '@n8n/chat';
import '@n8n/chat/style.css';

createChat({
  webhookUrl: 'https://your-n8n-instance/webhook/xxx',
});
```

The `createChat` function:
1. Creates a Vue 3 app via `createApp()`
2. Mounts it directly to a target DOM element (or creates one)
3. Injects the CSS stylesheet into the host page

### CSS Isolation
- **None** - CSS is injected directly into the host page `<head>`
- Uses CSS custom variables for theming
- Relies on specific class naming to avoid conflicts
- Host page CSS CAN and DOES affect the widget

### Z-Index
- Managed via CSS custom variables
- No special isolation

### Bundle Size
- Latest version 1.13.2
- Vue 3 dependency adds to bundle size
- CSS loaded as a separate stylesheet

### Key Takeaway
The n8n chat widget has the **weakest CSS isolation** of all widgets studied. It injects directly into the DOM with no iframe or Shadow DOM. This works for controlled environments but is risky for embedding on arbitrary customer websites. **Not a good model for our use case.**

---

## 7. assistant-ui

**Source**: [github.com/assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | [assistant-ui.com](https://www.assistant-ui.com/)

### Architecture: REACT COMPONENT LIBRARY (not an embeddable widget)

assistant-ui is fundamentally different from the other tools here. It is a **React component library** (like shadcn/ui for chat), not an embeddable widget.

### How it works
- Provides composable UI primitives inspired by Radix UI and cmdk
- Components: message bubbles, input areas, suggestion chips, action buttons
- Handles streaming, auto-scrolling, markdown rendering, accessibility
- Requires React as a peer dependency

### Embedding
- **Not designed for third-party embedding** - it's meant to be used within your own React app
- No iframe, Shadow DOM, or web component wrapper
- You would need to wrap it yourself for embedding

### Key Takeaway
assistant-ui is a great **component library** for building chat UIs within your own app, but it has **no embedding/isolation story**. You would need to build the iframe/Shadow DOM wrapper yourself.

---

## 8. Voiceflow Widget

**Source**: [github.com/voiceflow/react-chat](https://github.com/voiceflow/react-chat) (archived Aug 2025) | [docs.voiceflow.com](https://docs.voiceflow.com/docs/chat-widget)

### Architecture: SHADOW DOM (embedded mode) + CSS Class Prefixing

Voiceflow is notable for using **Shadow DOM in embedded mode**.

### How it works

**Two render modes:**
```javascript
window.voiceflow.chat.load({
  verify: { projectID: '<ID>' },
  url: 'https://general-runtime.voiceflow.com',
  versionID: 'production',
  render: {
    mode: 'embedded',  // or 'overlay'
    target: document.getElementById('chat-container')
  }
});
```

- **Overlay mode**: Widget floats over the page (ignores target element)
- **Embedded mode**: Mounts into target element via Shadow DOM, treating target as host

### CSS Isolation
- Uses `.vfrc-` prefixed class names
- In embedded mode: Shadow DOM provides hard boundary
- In overlay mode: relies on class prefixing (weaker isolation)

### Customization
```javascript
assistant: {
  color: '#387dff',
  fontFamily: 'inherit',
  side: 'right',
  spacing: { side: '30', bottom: '30' },
  renderMode: 'widget',
  stylesheet: 'https://example.com/custom-styles.css'  // external CSS injection
}
```

### Key Takeaway
Voiceflow demonstrates a **dual-mode approach**: Shadow DOM for embedded, class prefixing for overlay. The `stylesheet` configuration option for custom CSS injection is a clever pattern.

**NOTE**: The react-chat repo was archived in Aug 2025 and is no longer maintained.

---

## 9. iframe vs Shadow DOM: Deep Analysis

### Why Intercom, Drift, Zendesk, etc. Use iframes

**Security isolation:**
- iframe creates a completely separate browsing context
- Host page JavaScript cannot access iframe content (same-origin policy)
- Protects sensitive chat data (customer info, conversation history)
- Drift explicitly documents iframe support for sites with strict CSP

**Total CSS isolation:**
- No CSS can leak in or out of an iframe, period
- No need for `!important` overrides
- No need to worry about CSS specificity wars

**JavaScript isolation:**
- Host page errors cannot crash the widget
- Widget errors cannot crash the host page
- Memory leaks in either context are contained

**Battle-tested at scale:**
- Intercom serves millions of sites with iframe approach
- 15+ years of iframe browser support
- Zero edge cases with CSS inheritance

### Why Some Prefer Shadow DOM

**Performance:**
- Same document context, no separate rendering pipeline
- No cross-origin overhead for same-origin widgets
- Faster initial render (no separate document load)

**Communication:**
- Direct DOM access (no postMessage needed for simple cases)
- Shared JavaScript context
- Can access host page APIs directly

**SEO & Accessibility:**
- Content is part of the main document
- Screen readers can traverse shadow boundaries
- No iframe accessibility quirks

### Comparison Table

| Feature | iframe | Shadow DOM |
|---------|--------|------------|
| CSS isolation | Complete | Complete (but inherited props leak through) |
| JS isolation | Complete | None |
| Security | Strong (CSP, same-origin) | Weak (same JS context) |
| Performance | Separate render context | Same document context |
| Communication | postMessage only | Direct access |
| Bundle loaded | Separate document | Same document |
| Z-index management | Easy (separate stacking) | Complex (host stacking context) |
| Mobile full-screen | Extra work needed | Natural |
| Accessibility | Tricky | Better |
| Browser support | Universal | 96%+ |
| Style inheritance | None | font-family, color, etc. leak |

### postMessage Communication Pattern

```javascript
// HOST PAGE (parent)
// Sending to widget iframe
const iframe = document.getElementById('chat-widget-iframe');
iframe.contentWindow.postMessage(
  JSON.stringify({
    type: 'widget:config',
    payload: { theme: 'dark', user: { name: 'John' } }
  }),
  'https://widget.yourdomain.com'  // ALWAYS specify target origin
);

// Receiving from widget iframe
window.addEventListener('message', (event) => {
  // CRITICAL: Always validate origin
  if (event.origin !== 'https://widget.yourdomain.com') return;

  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'widget:resize':
      iframe.style.height = data.payload.height + 'px';
      break;
    case 'widget:open':
      iframe.style.display = 'block';
      break;
    case 'widget:close':
      iframe.style.display = 'none';
      break;
  }
});

// IFRAME CONTENT (child)
// Sending to host
window.parent.postMessage(
  JSON.stringify({
    type: 'widget:resize',
    payload: { height: document.body.scrollHeight }
  }),
  '*'  // or specific parent origin
);

// Receiving from host
window.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'widget:config') {
    applyConfig(data.payload);
  }
});
```

### iframe Sizing/Positioning Pattern

```javascript
// Widget container styles
const container = document.createElement('div');
Object.assign(container.style, {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  width: '380px',
  height: '600px',
  zIndex: '2147483000',
  border: 'none',
  borderRadius: '12px',
  overflow: 'hidden',
  boxShadow: '0 5px 40px rgba(0,0,0,0.16)',
  transition: 'all 0.3s ease'
});

// iframe fills its container
const iframe = document.createElement('iframe');
Object.assign(iframe.style, {
  width: '100%',
  height: '100%',
  border: 'none'
});

// Mobile detection and full-screen
const mql = window.matchMedia('(max-width: 480px)');
mql.addEventListener('change', (e) => {
  if (e.matches) {
    Object.assign(container.style, {
      width: '100vw',
      height: '100vh',
      bottom: '0',
      right: '0',
      borderRadius: '0'
    });
  }
});
```

### The HYBRID Approach (Best of Both Worlds)

Several production widgets (including Chatwoot) use a hybrid:

```
Host Page DOM
├── <div class="widget-bubble"> (Shadow DOM or direct DOM)
│   └── Trigger button (small, styled, lightweight)
└── <div class="widget-container">
    └── <iframe src="..."> (Full chat app)
        └── [Separate document with React/Vue/Preact chat UI]
```

**Why this works:**
- **Trigger button** is tiny (<5KB), can use Shadow DOM for style isolation
- **Chat window** is complex (100KB+), gets full iframe isolation
- Button in the host page means no iframe z-index/positioning complexity for the trigger
- Chat window in iframe gets complete security + style isolation
- postMessage bridges the two contexts

**This is the recommended pattern for production SaaS widgets.**

---

## 10. Preact + Shadow DOM: Technical Deep Dive

### The Good News

Unlike React (pre-v19), **Preact does NOT use document-level event delegation**. Preact applies event listeners directly to individual DOM elements. This means Preact works much better in Shadow DOM than React does.

From the Preact maintainers ([Issue #2887](https://github.com/preactjs/preact/issues/2887)):
> "The nuanced differences of delegation vs direct binding and why delegation isn't a good default"

### Basic Preact Shadow DOM Rendering

```javascript
import { h, render } from 'preact';
import App from './App';

// Create shadow host
const host = document.createElement('div');
host.id = 'my-widget';
document.body.appendChild(host);

// Attach shadow root
const shadow = host.attachShadow({ mode: 'open' });

// Create mount point inside shadow
const mountPoint = document.createElement('div');
shadow.appendChild(mountPoint);

// Render Preact app into shadow DOM
render(<App />, mountPoint);
```

### Using preact-custom-element (Official)

```javascript
import register from 'preact-custom-element';

const ChatWidget = ({ apiKey, theme }) => (
  <div class="chat-container">
    {/* ... chat UI ... */}
  </div>
);

// Register as custom element with Shadow DOM
register(ChatWidget, 'my-chat-widget', ['api-key', 'theme'], {
  shadow: true  // Enable Shadow DOM
});
```

Usage in HTML:
```html
<my-chat-widget api-key="xxx" theme="dark"></my-chat-widget>
```

### Using preact-shadow-root (by Jason Miller, Preact creator)

```javascript
import Shadow from 'preact-shadow-root';

const Widget = () => (
  <div>
    <Shadow>
      <div class="isolated">
        I am rendered in Shadow DOM
        <style>{`
          .isolated { color: red; }
        `}</style>
      </div>
    </Shadow>
  </div>
);
```

### Style Injection Strategies

**Strategy 1: Inline `<style>` tag in shadow root**
```javascript
const shadow = host.attachShadow({ mode: 'open' });

// Inject styles
const style = document.createElement('style');
style.textContent = `
  :host { all: initial; display: block; }
  .chat-container { /* ... */ }
`;
shadow.appendChild(style);
```

**Strategy 2: `<link>` tag for external CSS**
```javascript
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://cdn.yourdomain.com/widget.css';
shadow.appendChild(link);
```

**Strategy 3: Constructable Stylesheets (modern)**
```javascript
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { all: initial; display: block; }
  .chat-container { /* ... */ }
`);
shadow.adoptedStyleSheets = [sheet];
```

### Known Gotchas with Preact + Shadow DOM

**1. CSS Inheritance Leaks**

Shadow DOM blocks direct CSS selectors but NOT inherited properties:
```css
/* Host page */
body { font-family: Comic Sans; color: purple; }
/* These WILL leak into shadow DOM! */
```

Fix with `:host` reset:
```css
:host {
  all: initial;        /* Reset ALL inherited properties */
  font-family: system-ui;
  color: #333;
}
```

**2. Global Click Listeners / Focus Traps**

Events that bubble out of shadow DOM get **retargeted** - the `event.target` becomes the shadow host element, not the actual clicked element inside:
```javascript
// On host page, this won't see elements inside shadow DOM
document.addEventListener('click', (e) => {
  console.log(e.target); // Will be the shadow host, not the inner button
});
```

This breaks:
- Menu libraries detecting "click outside"
- Modal focus traps
- Analytics click tracking on host page

**3. Portals for Modals/Dropdowns**

If your chat widget has dropdowns or modals, they need to break out of the shadow DOM stacking context:
```javascript
import { createPortal } from 'preact/compat';

// Create a separate shadow host at body level for portals
const portalHost = document.createElement('div');
portalHost.id = 'widget-portal';
portalHost.attachShadow({ mode: 'open' });
document.body.appendChild(portalHost);

const Dropdown = ({ children }) => {
  return createPortal(children, portalHost.shadowRoot);
};
```

**4. forceUpdate / Re-render Issues**

When rendering directly to a shadow root, `useReducer` and force updates may not propagate correctly. Always render to a `<div>` inside the shadow root, not to the shadow root itself:
```javascript
// BAD
render(<App />, shadow);

// GOOD
const mount = document.createElement('div');
shadow.appendChild(mount);
render(<App />, mount);
```

---

## Summary: Recommended Architecture for Our Widget

Based on this research, here is the recommended approach for a production SaaS chat widget:

### Tier 1 Recommendation: Hybrid iframe + Shadow DOM

```
Loader Script (~5KB, IIFE)
├── Creates Shadow DOM host for trigger button
│   └── Renders Preact bubble button (tiny, isolated styles)
├── Creates iframe for chat window
│   └── Loads full Preact chat app (complete isolation)
└── postMessage bridge between button and iframe
```

**Why:**
- Proven by Chatwoot (thousands of production sites)
- Trigger button in Shadow DOM = small, style-isolated, no z-index issues
- Chat window in iframe = complete CSS + JS + security isolation
- Preact for both = tiny bundle, no event delegation issues

### Tier 2 Alternative: Full Shadow DOM (no iframe)

If iframe feels too heavy:
- Use `preact-custom-element` with `shadow: true`
- Inject styles via constructable stylesheets
- Use `:host { all: initial; }` to prevent inheritance
- Use portal shadow hosts for modals/dropdowns
- Accept that JS isolation won't exist (host errors can affect widget)

### Z-Index Strategy
- Use `2147483000` (Chatwoot's proven value, near max)
- Make configurable via `data-z-index` attribute on script tag

### Bundle Size Targets
- Loader script: <10KB gzipped
- Chat UI (in iframe or lazy-loaded): <100KB gzipped
- Use Preact (3KB) instead of React (40KB+)

### Critical Production Requirements
1. **Never break the host page** - wrap everything in try/catch
2. **Validate postMessage origins** - always check `event.origin`
3. **Mobile-first responsive** - full-screen on small viewports
4. **Async loading** - `defer` or `async` script, never block page render
5. **Configurable via data attributes** on the script tag
6. **Fail silently** - widget is a guest on someone else's site

---

## Sources

- [Chatwoot GitHub - SDK & Widget](https://github.com/chatwoot/chatwoot)
- [Botpress Messaging - Inject & Webchat](https://github.com/botpress/messaging)
- [Typebot Embeds](https://github.com/baptisteArno/typebot.io)
- [Papercups Chat Widget](https://github.com/papercups-io/chat-widget)
- [Papercups Chat Window](https://github.com/papercups-io/chat-window)
- [Rocket.Chat LiveChat](https://github.com/RocketChat/Rocket.Chat.Livechat)
- [n8n Chat Widget](https://www.npmjs.com/package/@n8n/chat)
- [assistant-ui](https://github.com/assistant-ui/assistant-ui)
- [Voiceflow React-Chat](https://github.com/voiceflow/react-chat)
- [Voiceflow Embed Docs](https://docs.voiceflow.com/docs/embed-customize-styling)
- [Preact Shadow DOM Guide](https://dev.to/tryeladd/preact-in-the-shadow-dom-ao8)
- [Preact + Shadow DOM Widget (CompanyCam)](https://dev.to/companycam/build-an-embeddable-widget-using-preact-and-the-shadow-dom-33lm)
- [preact-custom-element](https://preactjs.com/guide/v10/preact-custom-element/)
- [preact-shadow-root by Jason Miller](https://github.com/developit/preact-shadow-root)
- [Preact Event Handling Issue #2887](https://github.com/preactjs/preact/issues/2887)
- [Shadow DOM vs iframes (HackerNoon)](https://hackernoon.com/shadow-dom-vs-iframes-which-one-actually-works)
- [Building Embeddable React Widgets (MakerKit)](https://makerkit.dev/blog/tutorials/embeddable-widgets-react)
- [Courier Shadow DOM Guide](https://www.courier.com/blog/how-to-use-the-shadow-dom-to-isolate-styles-on-a-dom-that-isnt-yours)
- [iframe postMessage Resize Pattern](https://www.tracylum.com/blog/2018-05-21-using-windowpostmessage-to-resize-an-iframe/)
- [Drift iframe Security](https://devdocs.drift.com/docs/securing-drift-on-your-site-with-an-iframe)
