# Open-Source Chat Widget UI Libraries Research

**Date:** 2026-03-20
**Purpose:** Identify the best open-source chat widget components to accelerate CodeWeaves widget development

---

## Context

The existing CodeWeaves widget (`apps/widget`) is a **Preact + Vite** scaffold with basic open/close toggle — no Shadow DOM, no streaming, no theming, and no real chat functionality yet. This research identifies the best patterns to borrow from.

---

## Widget Libraries Analyzed

### 1. BotMan Web Widget (BEST Preact Reference)
| | |
|---|---|
| **GitHub** | https://botman.io/2.0/web-widget |
| **Stars** | ~1,500 |
| **Tech Stack** | **Preact** (same as CodeWeaves!) |
| **Bundle Size** | **5 KB gzipped** |
| **License** | MIT |

**Matches:** Preact-based, 5KB bundle, script tag embed, buttons/images/video/audio templates, mobile responsive.
**Missing:** No Shadow DOM, no streaming, no voice, no theming (50+ options), tied to BotMan PHP backend.
**Value:** Proves Preact can deliver a full widget at 5KB. Study bundle strategy and IIFE packaging.

---

### 2. DHTMLX ChatBot
| | |
|---|---|
| **Site** | https://dhtmlx.com/docs/products/dhtmlxChatbot/ |
| **Bundle Size** | **65 KB gzipped** |
| **License** | MIT |

**Matches:** Lightweight (65KB), typing indicators, markdown rendering, multiple display modes (bubbles, blocks, cards), mobile responsive.
**Missing:** No Shadow DOM, no streaming, no voice, not Preact.
**Value:** Proves 150KB target is achievable. Good reference for message display modes.

---

### 3. assistant-ui (Best Streaming Reference)
| | |
|---|---|
| **GitHub** | https://github.com/assistant-ui/assistant-ui |
| **Stars** | ~8,930 |
| **Tech Stack** | TypeScript, React, Radix-style composable primitives |
| **License** | MIT |

**Matches:** Real-time streaming built-in, composable primitives, broad LLM provider support, accessibility (WCAG), 50K+ monthly npm downloads, Y Combinator backed.
**Missing:** React (not Preact), no Shadow DOM, no embed pattern, no voice, bundle likely >150KB.
**Value:** BEST reference for streaming UX, auto-scroll, and accessibility. Port patterns to Preact.

---

### 4. Hexabot Widget (Best Shadow DOM Reference)
| | |
|---|---|
| **GitHub** | https://github.com/Hexastack/Hexabot (`/widget` directory) |
| **Stars** | ~2,000+ |
| **Tech Stack** | React, Socket.IO |
| **License** | FCL-1.0-ALv2 (Fair Core — converts to Apache 2.0 after 2 years) |

**Matches:** **Shadow DOM support** (explicitly documented), embeddable, real-time chat, customizable appearance, **multilingual** support.
**Missing:** React (not Preact), no streaming, no voice, FCL license restricts direct forking.
**Value:** BEST reference for Shadow DOM integration pattern. Study but don't fork (license).

---

### 5. Chainlit Copilot Widget (Best Embed Pattern)
| | |
|---|---|
| **GitHub** | https://github.com/Chainlit/chainlit (`@chainlit/copilot` package) |
| **Stars** | ~8,000+ |
| **License** | Apache 2.0 |

**Matches:** **Shadow DOM isolation**, script tag embed (`window.mountChainlitWidget()`), thread persistence (localStorage), authentication, cross-origin deployment.
**Missing:** Coupled to Chainlit Python backend, no voice, limited theming, community-maintained since May 2025.
**Value:** `window.mountChainlitWidget()` initialization + Shadow DOM pattern directly applicable. Thread persistence via localStorage is a good pattern.

---

### 6. Microsoft BotFramework-WebChat (Best Theming Reference)
| | |
|---|---|
| **GitHub** | https://github.com/microsoft/BotFramework-WebChat |
| **Stars** | ~1,600 |
| **License** | MIT |

**Matches:** **100+ `styleOptions` properties** (gold standard for theming), Shadow DOM support (partial), typing indicators, **speech-to-text** (Cognitive Services), **multi-language**, WCAG accessibility.
**Missing:** Very large bundle, tied to Azure Bot Framework, Shadow DOM has bugs.
**Value:** BEST reference for the **50+ theme options system**. Study the `styleOptions` API design. Only major project with both Shadow DOM AND speech support.

---

### 7. Voiceflow react-chat (Best API Pattern)
| | |
|---|---|
| **GitHub** | https://github.com/voiceflow/react-chat (ARCHIVED) |
| **License** | MIT |

**Matches:** Full chat widget, script tag embed, registers `window.voiceflow.chat` global API, custom action system, monorepo structure (separate packages for UI kit vs embed wrapper).
**Missing:** Archived (no longer maintained), React, no Shadow DOM, no streaming.
**Value:** The `window.voiceflow.chat` global API pattern and two-package architecture (UI kit + embed wrapper) are excellent patterns.

---

### 8. chatscope/chat-ui-kit-react (Best Component Taxonomy)
| | |
|---|---|
| **GitHub** | https://github.com/chatscope/chat-ui-kit-react |
| **Stars** | 1,707 |
| **License** | MIT |

**Matches:** Most comprehensive component library — MessageList, Message, MessageInput, ChatContainer, Avatar, TypingIndicator, ConversationHeader. Well-documented with Storybook.
**Missing:** 719KB package, no Shadow DOM, no streaming, no voice, React only.
**Value:** BEST component taxonomy reference. Their component breakdown is the most complete model for what components CodeWeaves needs.

---

### 9. BotUI (Best Conversation Starters Reference)
| | |
|---|---|
| **GitHub** | https://github.com/botui/botui |
| **Stars** | 2,914 |
| **License** | MIT |

**Matches:** `createBot` API for programmatic control, action buttons, select inputs, guided conversation flows.
**Missing:** No Shadow DOM, no streaming, no voice, no theming, linear flow only.
**Value:** Best reference for conversation starters and quick-reply guided flows.

---

### 10. react-chatbot-kit (Best Extensibility Pattern)
| | |
|---|---|
| **GitHub** | https://github.com/FredrikOseberg/react-chatbot-kit |
| **Stars** | ~1,500 |
| **License** | MIT |

**Matches:** Widget/ActionProvider/MessageParser three-layer architecture for extensibility.
**Value:** The parsing input → triggering actions → rendering widgets pattern maps well to CodeWeaves' needs.

---

### 11. AnythingLLM Embed
| | |
|---|---|
| **GitHub** | https://github.com/Mintplex-Labs/anythingllm-embed |
| **License** | MIT |

**Matches:** Script tag embed with `data-*` attributes for config (data-position, data-window-height, data-button-color, data-language, data-chat-icon).
**Missing:** 658KB bundle (too heavy), no Shadow DOM, no voice.
**Value:** The `data-*` attribute configuration pattern for script-tag embedding is clean and user-friendly.

---

### 12. HelixML chat-widget + chat-embed
| | |
|---|---|
| **GitHub** | https://github.com/helixml/chat-widget + https://github.com/helixml/chat-embed |

**Value:** Two-package architecture (React component library + IIFE embed wrapper) is a clean separation pattern.

---

## Comparative Matrix

| Requirement | BotMan | DHTMLX | assistant-ui | Hexabot | Chainlit | BotFramework | BotUI |
|---|---|---|---|---|---|---|---|
| Script tag embed | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Shadow DOM | ❌ | ❌ | ❌ | **✅** | **✅** | Partial | ❌ |
| 50+ theme options | ❌ | ❌ | ✅* | ❌ | ❌ | **✅** | ❌ |
| Streaming | ❌ | ❌ | **✅** | ❌ | ✅ | ❌ | ❌ |
| Voice I/O | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** | ❌ |
| Conversation starters | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| Typing indicators | Basic | **✅** | **✅** | ✅ | ✅ | **✅** | ❌ |
| <150KB bundle | **✅ (5KB)** | **✅ (65KB)** | ❌ | ❌ | ? | ❌ | ✅ |
| Multi-language | ❌ | ❌ | ❌ | **✅** | ❌ | **✅** | ❌ |
| Preact compatible | **✅** | Vanilla | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Recommended Pattern Adoption

No single project meets all requirements. Build a **custom Preact widget** drawing from these patterns:

| Pattern | Source Project |
|---|---|
| Preact + IIFE bundle architecture | **BotMan** (5KB proves Preact can be tiny) |
| Shadow DOM initialization | **Hexabot** + **Chainlit** |
| `window.CodeWeaves.init()` global API | **Voiceflow** (`window.voiceflow.chat` pattern) |
| `data-*` attribute configuration | **AnythingLLM Embed** |
| `styleOptions` theme object (50+ props) | **BotFramework-WebChat** |
| Streaming message renderer | **assistant-ui** (auto-scroll, chunk rendering) |
| Component taxonomy | **chatscope** (MessageList, TypingIndicator, Avatar, etc.) |
| Conversation starters / guided flows | **BotUI** (action buttons, select inputs) |
| Widget/action-provider extensibility | **react-chatbot-kit** (three-layer architecture) |
| Multi-language architecture | **Hexabot** |
| Thread persistence | **Chainlit** (localStorage threadId) |

## Target Architecture

- **Core:** Preact (~4.5KB) + custom components
- **Build:** Vite IIFE bundle (already configured in codebase)
- **Isolation:** Shadow DOM with injected stylesheets
- **Theming:** CSS custom properties via shadow root, configured through `styleOptions` object
- **Target bundle:** 40-80KB gzipped (achievable: BotMan = 5KB, DHTMLX = 65KB)

## Voice I/O Note

No open-source widget provides good voice reference. Build from scratch using:
- **STT:** Web Speech API (`SpeechRecognition`) or Sarvam AI / Deepgram
- **TTS:** Web Speech API (`SpeechSynthesis`) or Sarvam AI / ElevenLabs
