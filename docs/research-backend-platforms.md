# Open-Source AI Backend Platforms Research

**Date:** 2026-03-20
**Purpose:** Evaluate open-source AI chatbot backends/APIs as alternatives or companions for CodeWeaves' NestJS API

---

## Context

CodeWeaves already has a **NestJS 11 + Prisma 7 + PostgreSQL** backend with Passport-JWT auth, Swagger, Redis, Sentry, and a Turborepo monorepo (`apps/api`, `apps/web`, `apps/widget`). This research evaluates what can complement or replace parts of that stack.

---

## Platforms Evaluated

### 1. Dify — LLM App Development Platform
| | |
|---|---|
| **GitHub** | https://github.com/langgenius/dify — 114K+ stars |
| **License** | Apache 2.0 base (multi-tenant SaaS requires commercial license) |
| **Tech Stack** | Python, Flask, PostgreSQL, Redis, Celery, Next.js frontend |
| **Status** | Very active; enterprise product with full-time team |

| Requirement | Match |
|---|---|
| AI provider abstraction | YES — 50+ providers |
| SSE streaming | YES |
| Multi-tenant isolation | YES (enterprise) |
| RBAC | YES (enterprise) |
| Analytics | PARTIAL — basic usage metrics |
| NestJS/Node.js | NO — Python/Flask |
| Prisma + PostgreSQL | NO — SQLAlchemy |
| Voice (STT/TTS) | PARTIAL |

**Verdict:** Best for workflow orchestration and AI provider abstraction patterns. **License restricts SaaS usage** — study patterns only, or use as a deployed AI engine behind your NestJS API.

---

### 2. LiteLLM — AI Provider Proxy (HIGHEST VALUE)
| | |
|---|---|
| **GitHub** | https://github.com/BerriAI/litellm — 20K+ stars |
| **License** | MIT (core); enterprise features behind paywall |
| **Tech Stack** | Python, FastAPI, PostgreSQL, Redis |
| **Status** | Very active; used by Netflix, Rocket Money |

| Requirement | Match |
|---|---|
| AI provider abstraction | **YES — BEST-IN-CLASS** (100+ LLM providers, unified OpenAI-format API) |
| SSE streaming | YES |
| Multi-tenant isolation | YES — Org > Team > User > Key hierarchy |
| Cost tracking | YES — per user/team/org |
| Rate limiting | YES |
| Load balancing & fallbacks | YES |
| NestJS/Node.js | NO — Python (but exposes OpenAI-compatible REST API) |

**How to Use with CodeWeaves:**
Deploy LiteLLM as a **sidecar Docker service**. Your NestJS API calls LiteLLM's OpenAI-compatible endpoint instead of calling providers directly. This gives you:
- Instant 100+ provider support
- Load balancing and fallback routing
- Cost tracking per organization
- Zero changes to your NestJS architecture

```
NestJS API → LiteLLM Proxy → OpenAI / Anthropic / Google / Ollama / etc.
```

**Verdict:** STRONGEST recommendation as a companion service. Replaces your entire AI abstraction layer with battle-tested infrastructure. MIT licensed.

---

### 3. Langfuse — LLM Analytics & Observability (HIGHEST VALUE)
| | |
|---|---|
| **GitHub** | https://github.com/langfuse/langfuse — 23K+ stars |
| **License** | MIT (core) |
| **Tech Stack** | **TypeScript, Next.js, Prisma, PostgreSQL** |
| **Status** | Very active; YC W23 backed |

| Requirement | Match |
|---|---|
| Analytics/KPIs | **YES — BEST-IN-CLASS** LLM analytics |
| Prisma + PostgreSQL | **YES — SAME STACK** as CodeWeaves |
| Cost tracking | YES — per user/org |
| Conversation tracing | YES |
| Latency metrics | YES |
| Quality evaluations | YES |

**How to Use with CodeWeaves:**
Install `langfuse` npm package in your NestJS services. Instrument chat endpoints to send traces. This gives you:
- Conversation tracing and cost tracking per org
- Latency metrics (P50, P95, P99)
- Quality evaluations and scoring
- Custom dashboards
- Feeds data into your 14 KPI calculations

**Verdict:** PERFECT complement for analytics requirements. Same tech stack (TypeScript, Prisma, PostgreSQL). MIT licensed. Deploy alongside CodeWeaves.

---

### 4. Open WebUI
| | |
|---|---|
| **GitHub** | https://github.com/open-webui/open-webui — 117K stars |
| **License** | Custom "Open WebUI License" (requires branding preservation) |
| **Tech Stack** | Python (FastAPI), Svelte, SQLite/PostgreSQL |

| Requirement | Match |
|---|---|
| Voice (STT/TTS) | **YES — best-in-class** |
| RBAC | YES — Admin/User/Pending, group permissions, additive model |
| SSO | YES — SCIM 2.0, Okta, Azure AD |
| Multi-tenant | YES — Kubernetes multi-tenant manifests |

**Verdict:** Study RBAC permission model and voice pipeline as design references. Not suitable for direct integration (Python, custom license).

---

### 5. AnythingLLM
| | |
|---|---|
| **GitHub** | https://github.com/Mintplex-Labs/anything-llm — 40K+ stars |
| **License** | MIT |
| **Tech Stack** | **Node.js (Express)**, React, SQLite |

| Requirement | Match |
|---|---|
| Node.js backend | **YES** (Express, not NestJS) |
| AI provider abstraction | YES — all major providers |
| SSE streaming | YES |
| RBAC | PARTIAL — Admin/Manager/User per workspace |
| Embed widget | YES — dedicated embed submodule |

**Verdict:** Most architecturally relevant (Node.js). Study LLM provider adapter pattern and workspace isolation model. Port patterns to NestJS modules.

---

### 6. LibreChat
| | |
|---|---|
| **GitHub** | https://github.com/danny-avila/LibreChat — 22K+ stars |
| **License** | MIT |
| **Tech Stack** | Node.js (Express), React, MongoDB |

| Requirement | Match |
|---|---|
| AI provider switching | YES |
| SSE streaming | **YES — best implementation** (delta buffering, Redis cross-replica) |
| Auth | YES — multi-user, presets |
| MCP support | YES |

**Verdict:** Study SSE streaming with delta buffering and Redis cross-replica delivery — directly applicable to CodeWeaves.

---

### 7. LobeChat
| | |
|---|---|
| **GitHub** | https://github.com/lobehub/lobe-chat — 67K stars |
| **License** | MIT |
| **Tech Stack** | Next.js, TypeScript, PostgreSQL |

| Requirement | Match |
|---|---|
| AI provider abstraction | YES — unified backend adapter |
| Voice (TTS/STT) | **YES — built-in** |
| Plugin system | YES — 10K+ tools |

**Verdict:** Study TTS/STT implementation and unified model adapter pattern.

---

### 8. FastGPT
| | |
|---|---|
| **GitHub** | https://github.com/labring/FastGPT — 30K+ stars |
| **License** | Apache 2.0 with SaaS restriction |
| **Tech Stack** | TypeScript, Next.js, MongoDB, PostgreSQL |

**Verdict:** License restricts SaaS usage — **NOT viable** without commercial authorization. Study workflow orchestration patterns only.

---

## Recommended Composable Architecture

No single platform matches all 12 CodeWeaves requirements. The best approach is **composable companion services**:

### Tier 1: Deploy as Services (Immediate Value)

| Service | Purpose | Integration |
|---|---|---|
| **LiteLLM** (MIT) | AI provider proxy — 100+ LLMs, cost tracking, load balancing | Docker sidecar; NestJS calls OpenAI-compatible API |
| **Langfuse** (MIT) | LLM analytics, tracing, cost per org, evaluations | Docker sidecar; `langfuse` npm SDK in NestJS |
| **n8n** (already planned) | Workflow automation | Docker; webhook triggers from NestJS |

### Tier 2: Study & Port Patterns

| Source | What to Port |
|---|---|
| **AnythingLLM** | LLM provider adapter pattern (Node.js), workspace isolation |
| **LibreChat** | SSE streaming with delta buffering, Redis cross-replica delivery |
| **Open WebUI** | RBAC additive permission model, SCIM 2.0, voice pipeline |
| **LobeChat** | TTS/STT integration, unified model adapter |
| **Dify** | Workflow orchestration patterns |

### Tier 3: Build In-House (CodeWeaves Core IP)

These must remain in your NestJS backend:
- Multi-tenant data isolation (org-based Prisma filtering)
- 3-tier RBAC hierarchy (Super Admin / Admin / Client)
- Auth0 integration (passport-jwt — already in your stack)
- HMAC verification middleware
- Widget embed SDK (apps/widget)
- 14 core KPI aggregation layer (fed by Langfuse traces)
- Indian language voice routing (Sarvam AI)

---

## Key Discovery: LiteLLM + Langfuse Stack

The most impactful finding is that **LiteLLM + Langfuse** together can replace your entire AI abstraction layer AND analytics backend:

```
┌─────────────────────────────────────────────────┐
│  CodeWeaves NestJS API (your core IP)           │
│  - Multi-tenant, RBAC, Auth0, Widget config     │
│  - Voice routing (Sarvam AI)                    │
│  - 14 KPI aggregation                           │
└──────────────┬──────────────┬───────────────────┘
               │              │
               ▼              ▼
┌──────────────────┐  ┌──────────────────────────┐
│  LiteLLM Proxy   │  │  Langfuse                │
│  (MIT, Docker)   │  │  (MIT, Docker)           │
│                  │  │                          │
│  - 100+ LLMs    │  │  - Conversation traces   │
│  - Load balance  │  │  - Cost per org/user     │
│  - Fallback     │  │  - Latency metrics       │
│  - Cost tracking │  │  - Quality evaluations   │
│  - Rate limiting │  │  - Prisma + PostgreSQL   │
└──────┬───────────┘  └──────────────────────────┘
       │
       ▼
┌──────────────────┐
│  LLM Providers   │
│  OpenAI, Claude  │
│  Gemini, Ollama  │
│  Mistral, etc.   │
└──────────────────┘
```

This replaces n8n for AI orchestration while keeping n8n for workflow automation. Both LiteLLM and Langfuse are MIT licensed and can be added to your existing `docker-compose.yml`.

---

## Sources

- [Dify](https://github.com/langgenius/dify) — 114K stars
- [LiteLLM](https://github.com/BerriAI/litellm) — 20K stars, MIT
- [LiteLLM Multi-Tenant Docs](https://docs.litellm.ai/docs/proxy/multi_tenant_architecture)
- [Langfuse](https://github.com/langfuse/langfuse) — 23K stars, MIT
- [Langfuse Chatbot Analytics](https://langfuse.com/faq/all/chatbot-analytics)
- [Open WebUI](https://github.com/open-webui/open-webui) — 117K stars
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) — 40K stars, MIT
- [LibreChat](https://github.com/danny-avila/LibreChat) — 22K stars, MIT
- [LobeChat](https://github.com/lobehub/lobe-chat) — 67K stars, MIT
- [FastGPT](https://github.com/labring/FastGPT) — 30K stars
