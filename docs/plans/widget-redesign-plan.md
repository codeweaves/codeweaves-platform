# CodeWeaves Widget Redesign — Complete Plan

**Based on:** Research from Intercom, Crisp, Tidio, LiveChat, iMessage, WhatsApp, Telegram, Discord, Slack, Material Design, WCAG, and dozens of CSS references.

---

## The Problem (Current State)

The actual widget (`apps/widget/src/App.tsx`) is a 33-line skeleton with an emoji (💬) as the launcher. No styles, no CSS, no theming, no mobile responsiveness, no Shadow DOM. The rich preview exists only in the agent editor — the real embeddable widget does nothing.

---

## Target: Pixel-Level Specification

### 1. Widget Dimensions

| Property | Value | Why |
|---|---|---|
| Desktop width | **400px** | HelpCrunch/Intercom standard, slightly wider than current 380px |
| Desktop height | **580px** | Room for ~8 visible messages |
| Mobile | **100vw × 100vh** | Full screen on ≤480px, no exceptions |
| Launcher size | **60px** | Intercom standard: `$button-size: 60px` |
| Launcher offset | **20px** from bottom + right | Intercom standard: `$button-offset: 20px` |
| Header height | **64px** | Down from current 80px (wastes space) |
| Input area min-height | **52px** | Single line, expands up to 6 lines |
| z-index | **2147483647** | Max z-index, above everything on host site |

### 2. Typography

| Property | Value | Source |
|---|---|---|
| Base body font | **16px** | iOS default 17px SF Pro, Material 16px Roboto, WCAG minimum |
| Line height (messages) | **1.5** (24px at 16px) | Standard for reading |
| Header title | **15px, semibold (600)** | Slightly smaller than current 18px |
| Subtitle / secondary | **13px, regular (400)** | |
| Timestamps | **12px, regular** | Smallest readable |
| Conversation starters | **14px** | |
| Font family | **-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif** | Native system stack, no external font load |
| Max font variations | **4** (12 / 13 / 14 / 16px) | LearnUI.design rule: max 4 sizes |

### 3. Message Bubbles

Based on iMessage (most studied), WhatsApp, and Telegram specs:

| Property | Value | Notes |
|---|---|---|
| Padding | **10px 14px** (vertical / horizontal) | iMessage uses 10px 14px |
| Max width | **80%** of container | Up from current 70% |
| Border-radius (bot, first) | **18px 18px 18px 4px** | Asymmetric tail bottom-left |
| Border-radius (bot, middle) | **4px 18px 18px 4px** | Continued group |
| Border-radius (bot, last) | **4px 18px 18px 18px** | End of group |
| Border-radius (user, first) | **18px 18px 4px 18px** | Asymmetric tail bottom-right |
| Border-radius (user, middle) | **18px 4px 4px 18px** | Continued group |
| Border-radius (user, last) | **18px 4px 18px 18px** | End of group |
| Same-sender gap | **3px** | Tightly grouped (iMessage/WhatsApp style) |
| Different-sender gap | **20px** | Clear visual separation |
| Avatar | **Only on last message in group** | Not on every message |
| Avatar size | **32px** | Down from current 40px |
| Avatar gap from bubble | **8px** | |

### 4. Typing Indicator

The standard (iMessage, Facebook Messenger, WhatsApp):

```
Container: same style as bot message bubble (18px 18px 18px 4px radius)
Padding: 12px 16px
Three dots: 8px × 8px each, gap: 4px
Color: #94a3b8 (slate-400) in light, #475569 in dark
Animation: bounce keyframe, 600ms duration, 0ms / 150ms / 300ms delay
Easing: cubic-bezier(0.45, 0.05, 0.55, 0.95)
```

```css
@keyframes cw-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}
.cw-typing-dot {
  width: 8px; height: 8px; border-radius: 50%;
  animation: cw-typing-bounce 1.2s ease-in-out infinite;
}
.cw-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.cw-typing-dot:nth-child(3) { animation-delay: 0.30s; }
```

### 5. Animations & Transitions

| Animation | Duration | Easing | Notes |
|---|---|---|---|
| Widget open (slide up) | **300ms** | `cubic-bezier(0.4, 0, 0.2, 1)` | Material standard ease |
| Widget close | **250ms** | `ease-out` | Slightly faster than open |
| Message appear | **200ms** | `ease-out` | Fade + translateY(8px → 0) |
| Launcher hover | **150ms** | `ease` | scale(1.05) |
| Launcher click | **100ms** | `ease` | scale(0.95) then open |
| Bubble prompt appear | **300ms** | `ease-out` | Fade in from below |
| Input expand | **150ms** | `ease` | Height transition |
| Typing indicator appear | **200ms** | `ease-out` | Fade in |

```css
@keyframes cw-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes cw-message-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### 6. Color System (Derived from Primary Color)

One function `deriveTheme(primary, mode)` produces everything:

**Light mode fixed values (most colors are NOT derived, they're hardcoded neutrals):**
```
bodyBg:          #ffffff
botMessageBg:    #f1f5f9   (slate-100)
botMessageText:  #0f172a   (slate-900)
inputBg:         #ffffff
inputBorder:     #e2e8f0   (slate-200)
placeholderColor:#94a3b8   (slate-400)
timestampColor:  #94a3b8   (slate-400)
separatorColor:  #f1f5f9   (slate-100)
```

**Light mode derived from primary:**
```
headerBg:        primary
headerText:      white (always — primary is always dark enough for white text)
userMessageBg:   primary
userMessageText: white
sendButtonBg:    primary
launcherBg:      primary
accentHover:     primary darkened by 10% lightness in HSL
avatarBg:        primary at 15% opacity
```

**Dark mode fixed values:**
```
bodyBg:          #0f172a   (slate-900) — NOT #000000
botMessageBg:    #1e293b   (slate-800)
botMessageText:  #f1f5f9   (slate-100)
inputBg:         #1e293b   (slate-800)
inputBorder:     #334155   (slate-700)
placeholderColor:#475569   (slate-600)
timestampColor:  #475569   (slate-600)
headerBg (dark): #1e293b   (slate-800) — override, not primary
```

**Dark mode derived from primary:**
```
userMessageBg:   primary (same)
userMessageText: white
sendButtonBg:    primary
launcherBg:      primary
accentHover:     primary lightened by 10%
```

**Roundness → border-radius mapping:**
```
sharp:   2px (messages), 4px (input/button)
rounded: 18px (messages, asymmetric), 12px (input), 10px (button)
pill:    24px (messages), 24px (input), 24px (button)
```

### 7. Five Presets (Pre-defined configs)

| Preset | Primary | Mode | Roundness | Vibe |
|---|---|---|---|---|
| **Professional** | `#1e293b` (slate-800) | light | rounded | Neutral, works on everything |
| **Ocean** | `#4f46e5` (indigo-600) | light | rounded | Modern SaaS |
| **Forest** | `#059669` (emerald-600) | light | rounded | Calm, trustworthy |
| **Midnight** | `#6366f1` (indigo-500) | dark | rounded | Premium dark |
| **Custom** | user picks | user picks | user picks | Full control |

### 8. Input Area

```
Container padding: 12px 16px
Textarea: auto-expand, single line default, max 6 lines
Textarea padding: 10px 14px
Textarea border-radius: matches roundness setting
Send button: 40px × 40px square, border-radius matches setting
Emoji button: 36px × 36px, left of send
Attachment button (future): 36px × 36px, left of emoji
Send on: Enter key
New line on: Shift+Enter
```

Auto-expand pattern (cleanest CSS-grid trick):
```css
.cw-input-wrapper {
  display: grid;
}
.cw-input-wrapper::after {
  content: attr(data-value) " ";
  white-space: pre-wrap;
  visibility: hidden;
  grid-area: 1 / 1 / 2 / 2;
}
textarea { grid-area: 1 / 1 / 2 / 2; resize: none; overflow: hidden; }
```

### 9. Header

```
Height: 64px
Padding: 0 16px
Layout: flex, space-between
Left side: avatar (32px circle) + name + subtitle/status
Right side: minimize button (32px) + close button (32px)
Online status dot: 10px circle, position: absolute, bottom-0 right-0 of avatar
  Green (#22c55e) = online, Gray (#94a3b8) = offline
  Pulsing animation for online: scale 1→1.3→1, 2s infinite
```

### 10. Scroll Behavior

Smart scroll — what ChatGPT/Cursor use:
- If user is at bottom (within 100px): auto-scroll to bottom on new message
- If user has scrolled up: DON'T auto-scroll, show "↓ New messages" pill
- "New messages" pill: fixed bottom of message area, primary bg, click to scroll down + dismiss
- For streaming AI responses: scroll follows the bottom of the growing message

### 11. Empty State / Welcome Screen

When widget first opens (0 messages, only system greeting):
```
Center of message area:
  Bot avatar (48px)
  Agent name (16px, semibold)
  "Ask me anything" or custom subtitle (14px, muted)
  [Conversation starters as cards below, not just buttons]
```

Conversation starter style — pill buttons with chevron:
```
Background: white (light) / slate-800 (dark)
Border: 1px solid slate-200 / slate-700
Text: 14px, slate-700 / slate-300
Padding: 10px 16px
Border-radius: 12px (or roundness setting)
Chevron → icon right-aligned
Hover: bg slate-50 / slate-700
```

### 12. Markdown in Bot Messages

Support these and nothing more (keep bundle small):
- `**bold**` and `*italic*`
- `` `inline code` `` — styled with monospace, bg slate-100/slate-800
- ` ```code block``` ` — full-width, bg slate-900/slate-100, white/dark text, monospace
- `[link](url)` — primary color, underline, `target="_blank" rel="noopener"`
- `- list items` — unordered lists with proper indent
- `\n\n` — paragraph breaks

Do NOT support: tables, headings (H1-H6), images, HTML tags. Keep parser to <2KB.

### 13. Shadow DOM Architecture

```
Host page
└── <div id="cw-host">              ← injected by embed script
    └── Shadow Root (mode: 'open')
        ├── <style>widget.css</style>   ← all widget CSS injected here
        ├── <style>custom.css</style>   ← customer's customCSS injected here
        └── <div id="cw-root">          ← Preact renders here
```

Key: Use `all: initial` on the shadow host to prevent host CSS leaking in, then re-apply widget styles explicitly.

### 14. Lazy Loading (Two-Phase)

**Phase 1 — Loader (<15KB):**
- Renders only the launcher button
- Reads config from `data-*` attributes or fetches from API
- On launcher click → dynamically imports Phase 2

**Phase 2 — Full Widget (~130KB):**
- Chat window, message list, input, markdown parser, emoji picker
- Lazy loaded on first click only

**Embed script pattern:**
```html
<script 
  src="https://cdn.codeweaves.com/widget.js"
  data-agent-id="abc123"
  data-position="right"
  async
></script>
```

**Global API (exposed after load):**
```javascript
window.CodeWeaves = {
  open()          // opens chat window
  close()         // closes chat window  
  toggle()        // toggles
  sendMessage(text) // programmatically sends a message
  on(event, fn)   // subscribe to events: 'open', 'close', 'message', 'ready'
  setUser({ id, email, name }) // identify user
}
```

### 15. Mobile Full-Screen

At `max-width: 480px`:
```css
.cw-window {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  /* Account for iOS safe areas */
  padding-bottom: env(safe-area-inset-bottom);
}
.cw-launcher { display: none; } /* hide when window is open on mobile */
```

Header on mobile: show ← back arrow instead of minimize button.

### 16. Dark Mode Detection

```javascript
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
// If config.mode === 'auto': follow OS
// If config.mode === 'dark': always dark
// If config.mode === 'light': always light
prefersDark.addEventListener('change', e => { if (config.mode === 'auto') applyMode(e.matches ? 'dark' : 'light'); });
```

### 17. Accessibility (WCAG AA)

```
Message list:  role="log" aria-label="Chat messages" aria-live="polite"
New message:   aria-live="polite" on the log role handles announcements
Input:         role="textbox" aria-label="Type a message" aria-multiline="true"
Send button:   aria-label="Send message"
Close button:  aria-label="Close chat"
Launcher:      aria-label="Open chat" aria-expanded={isOpen}
Contrast:      4.5:1 minimum for all text
Focus:         visible outline on all interactive elements, 2px offset
Keyboard:      Tab through all controls, Escape closes, Enter sends
Zoom:          works up to 200% zoom
```

### 18. Notification Badge

```
Launcher gets a badge when widget is minimized + new message arrives:
Position: absolute, top: 0, right: 0
Size: 20px circle
Background: #ef4444 (red-500)
Text: white, 11px, bold
Shows count up to 9, then "9+"
Animate in: scale from 0 to 1, 200ms bounce
```

### 19. Sound Notification

Use Web Audio API — no audio file needed, zero KB impact:
```javascript
function playNotificationSound() {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.frequency.value = 800;
  oscillator.type = 'sine';
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.3);
}
```
Only plays when widget is minimized/closed and `config.sound.enabled === true`.

### 20. CSS Class Names (Stable for Custom CSS)

All classes prefixed `.cw-` so customers can target them:

```
.cw-host           Widget host container
.cw-launcher       Floating launcher button
.cw-launcher-badge Unread count badge
.cw-bubble-prompt  Tooltip above launcher
.cw-window         Chat window container
.cw-header         Header bar
.cw-header-avatar  Bot/company avatar in header
.cw-header-title   Agent name
.cw-header-subtitle Subtitle/status text
.cw-status-dot     Online status indicator
.cw-messages       Scrollable message area
.cw-message        Individual message wrapper
.cw-message--user  User message modifier
.cw-message--bot   Bot message modifier
.cw-message--first First in group modifier
.cw-message--last  Last in group modifier
.cw-bubble         Message bubble
.cw-avatar         Message avatar
.cw-timestamp      Timestamp text
.cw-starters       Conversation starters container
.cw-starter        Individual starter button
.cw-typing         Typing indicator wrapper
.cw-typing-dot     Individual typing dot
.cw-input-area     Input section container
.cw-input-wrapper  Auto-expand wrapper
.cw-input          The textarea
.cw-emoji-btn      Emoji picker toggle
.cw-send-btn       Send button
.cw-branding       "Powered by" footer
.cw-new-messages   "New messages" scroll pill
.cw-empty-state    Welcome screen (no messages)
```

---

## What Changes in the Agent Editor

### Remove entirely:
- Individual border-radius sliders for header, user messages, bot messages, input, send button (5 sliders → 1 roundness picker)
- Individual color pickers for: header text, subtitle, bot avatar bg, bot avatar icon, user avatar bg, user avatar icon, bot message bg, bot message text, input bg, input text, input placeholder, send button icon, timestamp, branding text, branding link (15 color pickers → 0, all derived)
- Avatar type selector (robot/machine/bot/support icons look developer-y, not professional)
- Avatar shape selector (always rounded square — cleaner)
- Typography font size slider (fixed at 16px)
- Separate `iconSize` slider

### Keep:
- Primary color picker (1)
- Mode: Light / Dark / Auto (3-button)
- Roundness: Sharp / Rounded / Pill (3-button)  
- Position: Left / Right
- Custom icon image upload
- Bubble prompt: text, enabled toggle, delay
- Header: title, subtitle, logo upload
- Behavior: greeting message, typing indicator toggle, conversation starters (up to 4)
- System prompt (admin only)
- Webhook URL, allowed domains (admin only)

### Add:
- Preset selector: 5 visual cards at the top (Professional / Ocean / Forest / Midnight / Custom)
- Dark mode toggle as part of preset/mode selection
- **Advanced section** (collapsed accordion):
  - Custom CSS textarea with stable class name reference
  - Sound notification toggle
  - Session persistence toggle

### New simplified editor flow:
```
1. Pick a preset (one click, done for most users)
2. Optionally change primary color if Custom selected
3. Optionally change position (left/right)
4. Set agent name, subtitle, logo
5. Write greeting + conversation starters
6. Advanced: custom CSS if needed
```

---

## File Structure After Redesign

```
apps/widget/src/
  loader.ts                    Entry: renders launcher only (<15KB)
  widget.ts                    Entry: full widget (lazy loaded)
  components/
    ChatWindow.tsx             Main container, slide-up animation
    Header.tsx                 64px header, status dot, controls
    MessageList.tsx            Scroll area with grouping logic
    MessageBubble.tsx          Bubble + avatar + timestamp
    TypingIndicator.tsx        3-dot bounce animation
    ConversationStarters.tsx   Pill buttons on empty state
    InputArea.tsx              Auto-expand textarea + emoji + send
    LauncherButton.tsx         Floating button + badge
    BubblePrompt.tsx           Tooltip above launcher
    BrandingFooter.tsx         "Powered by" footer
    NewMessagesPill.tsx        Scroll indicator
    EmojiPicker.tsx            Basic emoji grid
  hooks/
    useMessages.ts             Message state + streaming
    useAutoScroll.ts           Smart scroll behavior
    useTheme.ts                CSS variable injection + dark mode
    useMediaQuery.ts           Mobile detection
    useSound.ts                Web Audio API notification
    useSession.ts              localStorage conversation persistence
  utils/
    markdown.ts                Lightweight parser (<2KB)
    derive-theme.ts            Re-export from packages/validation
    shadow-dom.ts              Shadow root mounting
  styles/
    widget.css                 All .cw-* styles, no Tailwind
    animations.css             @keyframes definitions
  types.ts                     Widget-local types

packages/validation/src/
  theme.ts                     SimplifiedWidgetConfig type + Zod schema
  theme-derive.ts              deriveTheme(primary, mode, roundness) function
  theme-presets.ts             5 preset objects
  theme-migrate.ts             legacyTheme → SimplifiedWidgetConfig

apps/web/.../agent-editor/
  sections/
    preset-settings.tsx        NEW: 5 preset cards + primary color
    appearance-settings.tsx    SIMPLIFIED: position, icon, bubble prompt
    chat-settings.tsx          SIMPLIFIED: header content only (no colors)
    behavior-settings.tsx      UNCHANGED: greeting, typing, starters
    advanced-settings.tsx      NEW: custom CSS textarea + sound toggle
    branding-settings.tsx      SIMPLIFIED: content only, no color pickers
    prompt-settings.tsx        UNCHANGED
    integration-settings.tsx   UNCHANGED
  chat-widget-surface.tsx      UPDATED: new dimensions, grouping, derives colors
  agent-editor-context.tsx     UPDATED: SimplifiedWidgetConfig state type
```

---

## Implementation Order

### Phase 0 — Schema (do first, everything depends on it)
1. `packages/validation/src/theme.ts` — add `SimplifiedWidgetConfig` type
2. `packages/validation/src/theme-derive.ts` — `deriveTheme()` function
3. `packages/validation/src/theme-presets.ts` — 5 presets
4. `packages/validation/src/theme-migrate.ts` — legacy migration

### Phase 1 — Widget Rebuild (parallel after Phase 0)
1. CSS file with all `.cw-*` classes and keyframes
2. `LauncherButton.tsx` + `BubblePrompt.tsx` (loader bundle)
3. `Header.tsx`
4. `MessageBubble.tsx` with grouping logic + markdown
5. `MessageList.tsx` + `useAutoScroll.ts`
6. `TypingIndicator.tsx`
7. `ConversationStarters.tsx`
8. `InputArea.tsx` with auto-expand + emoji
9. `ChatWindow.tsx` (assembles everything)
10. `loader.ts` + Shadow DOM mounting
11. Mobile responsive styles

### Phase 2 — Editor (parallel with Phase 1)
1. Update `agent-editor-context.tsx` to `SimplifiedWidgetConfig`
2. New `preset-settings.tsx` section
3. Simplify `appearance-settings.tsx`
4. Simplify `chat-settings.tsx` (remove all color pickers)
5. New `advanced-settings.tsx` with custom CSS textarea
6. Update `chat-widget-surface.tsx` preview to match new design

### Phase 3 — API
1. Public widget-config endpoint (GET /public/agents/:id/widget-config)
2. Theme service: support both old and new schema

---

## Bundle Size Target

| Bundle | Target | Contents |
|---|---|---|
| Loader (initial) | **<15KB** gzipped | Launcher, BubblePrompt, config fetch |
| Full widget | **<140KB** gzipped | Everything else |
| Total | **<155KB** | Well under 150KB for full widget |

Comparison: Crisp ~100KB, LiveChat 256KB, Zendesk 500KB+

---

## What We Are NOT Building (Yet)

- File/image attachments (needs backend storage)
- Video chat
- Co-browsing
- Rich cards / carousels
- Spaces/tabs like Intercom
- RTL language support
- Voice input in widget (backend handles Sarvam AI)
