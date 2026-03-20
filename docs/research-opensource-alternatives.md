# Open-Source Alternatives Research for CodeWeaves Platform

**Date:** 2026-03-20
**Author:** Research Agent
**Purpose:** Identify open-source repos that can replace or accelerate CodeWeaves development

---

## What CodeWeaves Is Building (Summary)

A **multi-tenant B2B SaaS platform** for deploying customizable AI chat widgets on customer websites. Key components:

- **Dashboard** (Next.js) — Agent creation, theme editor, analytics (14 KPIs), org/user management
- **API Server** (NestJS + Prisma + PostgreSQL) — Multi-tenant backend, AI abstraction layer, RBAC, SSE streaming
- **Embeddable Widget** (Preact + Shadow DOM) — Lightweight chat bubble, voice I/O, multi-language
- **Key Differentiators:** n8n webhook integration, Indian language support (Hindi/Marathi/Hinglish), voice STT/TTS with Sarvam AI, 14 analytics KPIs, Auth0 auth, Supabase storage

---

## Top Open-Source Alternatives

### Tier 1: STRONGEST MATCHES (Can replace 70%+ of CodeWeaves)

---

### 1. Typebot
| | |
|---|---|
| **GitHub** | https://github.com/baptisteArno/typebot.io |
| **Stars** | ~30,000+ |
| **License** | Functional Source License (Fair Source) |
| **Tech Stack** | TypeScript, Next.js, Prisma, PostgreSQL, Tailwind CSS |
| **Status** | Actively maintained (2026) |

**What it does:** Visual drag-and-drop chatbot builder with embeddable widget. Self-hostable.

**Feature Match with CodeWeaves:**
- ✅ Embeddable chat widget (script tag, JS injection into DOM)
- ✅ Visual bot builder with 45+ building blocks
- ✅ Theme customization (colors, branding, avatars)
- ✅ OpenAI integration built-in
- ✅ Prisma + PostgreSQL (same as CodeWeaves)
- ✅ Next.js monorepo (similar architecture)
- ✅ Analytics (basic conversation tracking)
- ✅ Self-hostable with Docker
- ✅ Webhooks & Zapier/Make integrations

**What's Missing:**
- ❌ No multi-tenant/multi-organization architecture (single-user oriented)
- ❌ No RBAC (Super Admin / Admin / Client hierarchy)
- ❌ No NestJS backend (uses Next.js API routes)
- ❌ No voice support (STT/TTS)
- ❌ No Indian language support
- ❌ No Shadow DOM isolation
- ❌ No SSE streaming (uses different response pattern)
- ❌ No 14-KPI analytics dashboard
- ❌ No n8n integration
- ❌ No Auth0 (uses custom auth)
- ❌ Fair Source license — **NOT fully open source** (limits commercial use at scale)

**How to Adapt for CodeWeaves:**
Typebot's biggest value is its **visual flow builder UI** and **embeddable widget**. You could:
1. Fork the widget component and add Shadow DOM, voice, multi-language
2. Replace the backend entirely with your NestJS API
3. Add multi-tenancy layer on top
4. **Risk:** Fair Source license restricts commercial hosting — consult legal

**Verdict:** Great for inspiration on widget UX and flow builder, but the license and missing multi-tenancy make it risky as a direct fork.

---

### 2. Dify
| | |
|---|---|
| **GitHub** | https://github.com/langgenius/dify |
| **Stars** | 100,000+ |
| **License** | Apache 2.0 (with commercial add-ons) |
| **Tech Stack** | Python (Flask), React, PostgreSQL, Redis, Celery |
| **Status** | Very actively maintained, backed by VC funding |

**What it does:** Full LLM application development platform with visual workflow builder, RAG, agent capabilities, and API-as-a-service.

**Feature Match with CodeWeaves:**
- ✅ Multi-model support (OpenAI, Anthropic, local LLMs — 50+ providers)
- ✅ AI provider abstraction layer (swap providers easily)
- ✅ Visual workflow builder (similar to n8n concept)
- ✅ RAG pipeline built-in
- ✅ API-as-a-service (Backend-as-a-Service)
- ✅ Analytics & observability (LLMOps)
- ✅ Multi-user with RBAC
- ✅ Self-hostable with Docker
- ✅ Plugin ecosystem
- ✅ Conversation management

**What's Missing:**
- ❌ No embeddable widget (it's a full app, not a widget platform)
- ❌ Python backend (not Node.js/NestJS)
- ❌ No multi-tenant B2B SaaS architecture
- ❌ No theme customization for end-user-facing widget
- ❌ No voice support (STT/TTS)
- ❌ No Indian language focus
- ❌ No Shadow DOM widget
- ❌ No n8n webhook integration (has its own workflow engine)
- ❌ No 14-KPI analytics dashboard (has different metrics)

**How to Adapt for CodeWeaves:**
Use Dify as the **AI backend/orchestration layer** instead of building your own AI abstraction:
1. Deploy Dify as the AI engine behind your NestJS API
2. Use Dify's API to send messages and get responses
3. Build your own widget, dashboard, and multi-tenant layer on top
4. Leverage Dify's 50+ LLM provider integrations instead of building your own

**Verdict:** BEST option for replacing the AI abstraction layer. Use it as the brains, build the rest yourself. Apache 2.0 license is startup-friendly.

---

### 3. Flowise
| | |
|---|---|
| **GitHub** | https://github.com/FlowiseAI/Flowise |
| **Stars** | 36,000+ |
| **License** | Apache 2.0 |
| **Tech Stack** | TypeScript, Node.js, React, LangChain |
| **Status** | Actively maintained (2026) |

**What it does:** Visual drag-and-drop AI agent/chatbot builder with embeddable widget.

**Feature Match with CodeWeaves:**
- ✅ **Embeddable chat widget** (script tag, React component, iframe)
- ✅ Widget theme customization (colors, button, icon, position)
- ✅ Node.js/TypeScript backend (closer to CodeWeaves stack)
- ✅ Multi-model support (OpenAI, Anthropic, Ollama, local models)
- ✅ RAG support with vector databases
- ✅ Streaming responses
- ✅ API endpoints for all chatflows
- ✅ Self-hostable with Docker
- ✅ Domain-based access control on widget
- ✅ Embed proxy server (security layer)
- ✅ Apache 2.0 license

**What's Missing:**
- ❌ No multi-tenant architecture
- ❌ No RBAC hierarchy (basic auth only)
- ❌ No analytics dashboard (14 KPIs)
- ❌ No voice support (STT/TTS)
- ❌ No Indian language support
- ❌ No Shadow DOM on widget
- ❌ No Auth0 integration
- ❌ No NestJS (uses Express)
- ❌ No Prisma (uses TypeORM)
- ❌ No n8n-style webhook routing

**How to Adapt for CodeWeaves:**
Flowise's **embed widget (FlowiseChatEmbed)** is the most directly reusable component:
1. Fork `FlowiseChatEmbed` as your widget base — add Shadow DOM, voice, multi-language
2. Use Flowise as the AI orchestration backend (replace n8n)
3. Build your NestJS multi-tenant API as a proxy layer in front of Flowise
4. Add your dashboard, analytics, and RBAC on top

**Verdict:** BEST match for the widget + AI backend combo. Apache 2.0 is perfect. The widget is lightweight and customizable. Combine with your own NestJS multi-tenant layer.

---

### Tier 2: STRONG PARTIAL MATCHES (Can replace specific components)

---

### 4. Chatwoot
| | |
|---|---|
| **GitHub** | https://github.com/chatwoot/chatwoot |
| **Stars** | 27,900+ |
| **License** | MIT |
| **Tech Stack** | Ruby on Rails, Vue.js, PostgreSQL, Redis |
| **Status** | Actively maintained (March 2026) |

**What it does:** Open-source customer support platform with live chat widget, omnichannel inbox, and AI agent ("Captain").

**Feature Match with CodeWeaves:**
- ✅ **Embeddable website chat widget** (mature, battle-tested)
- ✅ Multi-tenant / multi-organization
- ✅ RBAC (Agent, Admin, Super Admin roles)
- ✅ Widget customization (colors, branding)
- ✅ AI-powered auto-responses (Captain)
- ✅ Analytics & reporting
- ✅ Self-hostable with Docker
- ✅ MIT License (fully open)
- ✅ Omnichannel (chat, email, WhatsApp, social)
- ✅ Webhook integrations

**What's Missing:**
- ❌ Ruby on Rails backend (not Node.js/NestJS)
- ❌ Not designed for AI-first chatbots (it's a support tool)
- ❌ No AI provider abstraction / LLM swapping
- ❌ No visual chat flow builder
- ❌ No SSE streaming for AI responses
- ❌ No voice support (STT/TTS)
- ❌ No Indian language focus
- ❌ No Shadow DOM widget isolation
- ❌ No n8n integration
- ❌ No 14-KPI analytics (has support-oriented metrics)

**How to Adapt for CodeWeaves:**
Best used as **inspiration for the multi-tenant architecture and widget**:
1. Study Chatwoot's multi-tenant data isolation patterns
2. Reference their RBAC implementation
3. Learn from their widget embed approach
4. **Don't fork** — the Ruby stack doesn't match

**Verdict:** Great reference for multi-tenancy and widget design patterns, but wrong tech stack for direct use.

---

### 5. LibreChat
| | |
|---|---|
| **GitHub** | https://github.com/danny-avila/LibreChat |
| **Stars** | 34,800+ |
| **License** | MIT |
| **Tech Stack** | Node.js (Express), React, MongoDB |
| **Status** | Very actively maintained (acquired by ClickHouse) |

**What it does:** Enhanced ChatGPT clone with multi-provider support, agents, MCP, code interpreter.

**Feature Match with CodeWeaves:**
- ✅ Multi-provider AI support (OpenAI, Anthropic, Google, Azure, etc.)
- ✅ AI provider switching (exactly what CodeWeaves needs)
- ✅ Streaming responses
- ✅ Multi-user with SSO (OAuth, SAML, LDAP)
- ✅ RBAC & admin controls
- ✅ Node.js backend (same ecosystem)
- ✅ Conversation management & search
- ✅ MIT License
- ✅ Enterprise-adopted (Daimler Truck)
- ✅ MCP support, agents, code interpreter

**What's Missing:**
- ❌ No embeddable widget (it's a full web app)
- ❌ No multi-tenant B2B SaaS model
- ❌ MongoDB (not PostgreSQL/Prisma)
- ❌ Express (not NestJS)
- ❌ No theme customization for customer-facing widget
- ❌ No voice support (STT/TTS)
- ❌ No analytics dashboard (14 KPIs)
- ❌ No n8n integration
- ❌ No Indian language focus

**How to Adapt for CodeWeaves:**
Best used for the **AI provider abstraction pattern**:
1. Study how LibreChat handles multi-provider routing
2. Reference their streaming implementation
3. Look at their admin panel roadmap (2026)
4. **Don't fork** — architecture too different

**Verdict:** Excellent reference for AI provider abstraction and streaming patterns. MIT licensed.

---

### 6. Open WebUI
| | |
|---|---|
| **GitHub** | https://github.com/open-webui/open-webui |
| **Stars** | 124,000+ |
| **License** | MIT |
| **Tech Stack** | Python (FastAPI), SvelteKit, SQLite/PostgreSQL |
| **Status** | Most popular open-source AI chat UI (2026) |

**What it does:** Self-hosted ChatGPT alternative with RAG, voice, pipelines, and model management.

**Feature Match with CodeWeaves:**
- ✅ Multi-model support (Ollama, OpenAI-compatible APIs)
- ✅ Voice support (STT/TTS built-in!)
- ✅ RAG pipeline
- ✅ SSO and RBAC
- ✅ Audit logs
- ✅ MIT License
- ✅ Pipelines (modular workflow concept)
- ✅ Community marketplace

**What's Missing:**
- ❌ No embeddable widget (full app, not widget — though feature requested)
- ❌ Python/SvelteKit (not Node.js/NestJS/React)
- ❌ No multi-tenant B2B model
- ❌ No theme customization for embed
- ❌ No analytics dashboard
- ❌ No n8n integration

**How to Adapt for CodeWeaves:**
1. Study their voice (STT/TTS) implementation — most mature in OSS
2. Reference their pipeline/workflow concept
3. There's a community embed widget: https://github.com/taylorwilsdon/open-webui-embeddable-widget

**Verdict:** Best reference for voice implementation. Too different architecturally for direct use.

---

### 7. AnythingLLM
| | |
|---|---|
| **GitHub** | https://github.com/Mintplex-Labs/anything-llm |
| **Stars** | 35,000+ |
| **License** | MIT |
| **Tech Stack** | Node.js, React, SQLite, various vector DBs |
| **Status** | Actively maintained (2026) |

**What it does:** All-in-one AI app with document chat, RAG, multi-user, and **embeddable chat widget**.

**Feature Match with CodeWeaves:**
- ✅ **Embeddable chat widget** (dedicated submodule: `anythingllm-embed`)
- ✅ Widget customization (colors, icons, button style, language)
- ✅ Domain filtering on widget (allowed domains list)
- ✅ Chat rate limiting on widget
- ✅ Multi-user with permissions
- ✅ Multi-model support (OpenAI, Anthropic, local LLMs)
- ✅ Node.js backend (same ecosystem)
- ✅ RAG with any document type
- ✅ MIT License
- ✅ Dynamic model override per widget

**What's Missing:**
- ❌ No multi-tenant B2B architecture
- ❌ No NestJS (uses Express)
- ❌ No Prisma/PostgreSQL (uses SQLite)
- ❌ No SSE streaming in widget (different pattern)
- ❌ No voice support
- ❌ No analytics dashboard
- ❌ No Shadow DOM isolation
- ❌ No Indian language support
- ❌ No RBAC hierarchy (basic roles only)
- ❌ No n8n integration

**How to Adapt for CodeWeaves:**
The **anythingllm-embed** widget is a solid starting point:
1. Fork `anythingllm-embed` for widget base
2. Add Shadow DOM, voice buttons, multi-language
3. Point it at your NestJS backend instead of AnythingLLM
4. Use AnythingLLM's RAG pipeline as reference

**Verdict:** The embed widget + domain filtering + rate limiting is very relevant. MIT license is perfect.

---

### 8. Langflow
| | |
|---|---|
| **GitHub** | https://github.com/langflow-ai/langflow |
| **Stars** | 50,000+ |
| **License** | MIT |
| **Tech Stack** | Python, React, LangChain |
| **Status** | Actively maintained (2026) |

**What it does:** Low-code AI app builder with visual flow editor, multi-agent orchestration, and embeddable chat.

**Feature Match with CodeWeaves:**
- ✅ **Embeddable chat web component** (`langflow-embedded-chat`)
- ✅ Visual flow builder (like n8n for AI)
- ✅ Multi-model support
- ✅ API + MCP server
- ✅ Customizable widget styling
- ✅ MIT License

**What's Missing:**
- ❌ Python backend (not Node.js)
- ❌ No multi-tenant
- ❌ No RBAC
- ❌ No voice, no Indian languages
- ❌ No analytics dashboard

**How to Adapt:** Use as the AI workflow engine behind your NestJS API (similar to using n8n).

---

### Tier 3: NICHE / COMPLEMENTARY

---

### 9. ConvoStack
| | |
|---|---|
| **GitHub** | https://github.com/ConvoStack/convostack |
| **License** | MIT |
| **Tech Stack** | TypeScript, React, Node.js, GraphQL |

Plug-and-play embeddable AI chatbot widget + backend framework. Closest architecture to CodeWeaves but **appears unmaintained** (low activity). Good for code reference.

### 10. Botpress
| | |
|---|---|
| **GitHub** | https://github.com/botpress/botpress |
| **Stars** | 13,000+ |
| **License** | MIT (v13+) / AGPL (v12) |

Full chatbot platform with visual flow builder, multi-channel, agent routing. Cloud-first now — OSS version is limited. Good for reference on agent routing patterns.

---

## Recommendation Matrix

| Requirement | Best OSS Match |
|---|---|
| **Embeddable Widget** | Flowise (FlowiseChatEmbed) or AnythingLLM (anythingllm-embed) |
| **AI Provider Abstraction** | Dify (50+ providers) or LibreChat |
| **Visual Flow Builder** | Flowise, Dify, or Langflow |
| **Multi-Tenant Architecture** | Chatwoot (reference only — Ruby) |
| **RBAC** | Chatwoot or LibreChat |
| **Voice (STT/TTS)** | Open WebUI (most mature) |
| **Analytics Dashboard** | Chatwoot (support metrics) — none match 14 KPIs |
| **Streaming (SSE)** | LibreChat, Flowise |
| **Shadow DOM Widget** | None — must build custom |
| **Indian Language Support** | None — must build custom with Sarvam AI |
| **n8n Integration** | None direct — Typebot has Zapier/Make |

---

## Recommended Strategy for Your Startup

### Option A: "Flowise + Custom Layer" (RECOMMENDED)

**Use Flowise as the AI engine + widget base, build multi-tenant SaaS on top.**

```
Your Custom Layer (NestJS):
├── Multi-tenant API (organizations, users, RBAC)
├── Auth0 integration
├── Analytics engine (14 KPIs)
├── Voice processing (Sarvam AI, Deepgram)
└── Indian language routing

Flowise (AI Backend):
├── LLM orchestration (replaces n8n)
├── RAG pipelines
├── 50+ model providers
└── API endpoints

FlowiseChatEmbed (Widget Base - Fork):
├── Add Shadow DOM isolation
├── Add voice buttons (STT/TTS)
├── Add multi-language UI
├── Add Indian language detection
└── Enhance theme customization
```

**Pros:** Apache 2.0 license, Node.js/TypeScript stack, mature widget, 36K+ stars community
**Cons:** Need to build multi-tenancy, RBAC, analytics, voice from scratch
**Time saved:** ~40-50% on AI orchestration and widget

---

### Option B: "Dify as Brain + Custom Everything Else"

**Use Dify API as the AI backend, build everything else custom.**

```
Your NestJS API:
├── Proxies chat requests to Dify API
├── Multi-tenant layer
├── Auth0 + RBAC
├── Analytics (14 KPIs)
├── Voice processing
└── Widget config management

Dify (AI Backend):
├── 50+ LLM providers
├── RAG pipelines
├── Workflow orchestration
├── LLMOps / observability
└── API-as-a-Service

Custom Widget (Preact):
├── Built from scratch with Shadow DOM
├── Voice I/O
├── Multi-language
└── Full theme customization
```

**Pros:** Most powerful AI engine (100K+ stars), Apache 2.0, replaces n8n entirely
**Cons:** Python backend (ops complexity), widget must be built from scratch
**Time saved:** ~30-40% on AI layer only

---

### Option C: "Build It All, Reference OSS" (Current Path)

**Continue building CodeWeaves as designed, use OSS projects as reference.**

Borrow patterns from:
- **Flowise/AnythingLLM** → Widget embed architecture
- **LibreChat** → AI provider abstraction & streaming
- **Chatwoot** → Multi-tenant patterns & RBAC
- **Open WebUI** → Voice (STT/TTS) implementation
- **Dify** → Workflow orchestration patterns

**Pros:** Full control, exact architecture you want, no license risks
**Cons:** Longest development time
**Time saved:** ~10-15% from code references

---

### Option D: "Hybrid — AnythingLLM Embed + Dify Backend + Custom NestJS"

**Cherry-pick the best components:**

1. **Fork `anythingllm-embed`** → Widget (MIT, Node.js, customizable, domain filtering)
2. **Deploy Dify** → AI orchestration (Apache 2.0, replaces n8n + AI abstraction)
3. **Build custom NestJS API** → Multi-tenant, RBAC, Auth0, analytics, voice
4. **Build custom Next.js dashboard** → Theme editor, analytics, org management

**Pros:** Best of all worlds, all MIT/Apache licensed, fastest time to market
**Cons:** Integration complexity between components
**Time saved:** ~50-60%

---

## Final Recommendation

**Go with Option D (Hybrid)** for fastest time-to-market:

1. **Widget:** Fork AnythingLLM embed widget (MIT) — add Shadow DOM, voice, Indian languages
2. **AI Engine:** Deploy Dify (Apache 2.0) — replaces n8n with 50+ providers + RAG + workflows
3. **Backend:** Build your NestJS multi-tenant API — this is your core IP (RBAC, analytics, voice routing)
4. **Dashboard:** Build your Next.js dashboard — another core IP piece (theme editor, 14 KPIs)

Your **unique value** is the **multi-tenant B2B SaaS layer + Indian language voice support + 14-KPI analytics** — none of the OSS alternatives have this. Focus your engineering effort there and leverage OSS for commodity features (AI orchestration, widget chrome).

---

## License Summary

| Project | License | Safe for Commercial SaaS? |
|---|---|---|
| Dify | Apache 2.0 | ✅ Yes |
| Flowise | Apache 2.0 | ✅ Yes |
| AnythingLLM | MIT | ✅ Yes |
| LibreChat | MIT | ✅ Yes |
| Chatwoot | MIT | ✅ Yes |
| Open WebUI | MIT | ✅ Yes |
| Langflow | MIT | ✅ Yes |
| Typebot | Functional Source | ⚠️ Restricted (limits commercial hosting) |
| Botpress v12 | AGPL | ⚠️ Copyleft (must open-source derivatives) |
