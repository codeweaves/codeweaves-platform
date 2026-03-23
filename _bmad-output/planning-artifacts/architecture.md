# Architecture Document - CodeWeaves Platform

**Version:** 1.1.0
**Author:** Winston (Architect Agent)
**Date:** 2026-03-14
**Status:** Approved for Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision Records (ADRs)](#2-architecture-decision-records-adrs)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Monorepo Structure](#4-monorepo-structure)
5. [Backend Architecture (NestJS)](#5-backend-architecture-nestjs)
6. [Frontend Architecture (Next.js)](#6-frontend-architecture-nextjs)
7. [Widget Architecture (Preact + Shadow DOM)](#7-widget-architecture-preact--shadow-dom)
8. [Shared Packages](#8-shared-packages)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Database Architecture](#10-database-architecture)
11. [API Design](#11-api-design)
12. [Real-Time Communication (SSE)](#12-real-time-communication-sse)
13. [AI Service Abstraction Layer](#13-ai-service-abstraction-layer)
14. [Analytics Architecture](#14-analytics-architecture)
15. [Infrastructure & DevOps](#15-infrastructure--devops)
16. [Security Architecture](#16-security-architecture)
17. [Observability & Monitoring](#17-observability--monitoring)
18. [Performance Requirements](#18-performance-requirements)
19. [Testing Strategy](#19-testing-strategy)
20. [Voice Architecture](#20-voice-architecture)
21. [Appendix: File Structure Reference](#21-appendix-file-structure-reference)

---

## 1. Executive Summary

CodeWeaves is a multi-tenant B2B SaaS platform for deploying customizable AI chat widgets. The platform consists of three main applications:

1. **Dashboard (apps/web)** - Next.js admin interface for organization management
2. **API Server (apps/api)** - NestJS backend handling all business logic
3. **Embeddable Widget (apps/widget)** - Preact-based chat widget for customer websites

### Key Architectural Principles

- **Monorepo-first**: All code in single Turborepo for consistency
- **API-first**: All data access through NestJS API layer
- **Type-safe**: Zod schemas shared across frontend/backend
- **Security-first**: Auth0 for authentication, no RLS dependency
- **Observable**: Sentry integration across all applications

---

## 2. Architecture Decision Records (ADRs)

### ADR-001: Monorepo with Turborepo

**Status:** Accepted
**Context:** Need consistent tooling, shared code, and atomic deployments
**Decision:** Use Turborepo with pnpm workspaces
**Consequences:**
- Single repository for all applications and packages
- Shared TypeScript configuration
- Cached builds for faster CI/CD
- Coordinated versioning

### ADR-002: NestJS for Backend

**Status:** Accepted
**Context:** Need enterprise-grade Node.js backend with strong typing
**Decision:** Use NestJS with modular architecture
**Consequences:**
- Dependency injection for testability
- Built-in Swagger support
- Guards and interceptors for cross-cutting concerns
- Prisma ORM integration

### ADR-003: Next.js v16 for Dashboard

**Status:** Accepted
**Context:** Need modern React framework with SSR capabilities
**Decision:** Use Next.js v16 with App Router
**Consequences:**
- Server Components for performance
- Built-in routing and API routes (only for BFF patterns)
- Tailwind CSS v4 integration
- Shadcn UI components

### ADR-004: Preact + Shadow DOM for Widget

**Status:** Accepted
**Context:** Need lightweight, embeddable widget with CSS isolation
**Decision:** Use Preact with closed Shadow DOM
**Consequences:**
- 3KB React-like runtime
- Complete CSS isolation from host pages
- Shared UI components via packages/widget-ui
- CSS Variables for theme customization

### ADR-005: Auth0 for Authentication

**Status:** Accepted
**Context:** Need enterprise authentication without building from scratch
**Decision:** Use Auth0 exclusively (NO Supabase Auth)
**Consequences:**
- Social logins (Google, GitHub, Microsoft)
- MFA support out of the box
- JWT verification in NestJS
- Frontend SDK for login flow

### ADR-006: Application-Level Data Access (No RLS)

**Status:** Accepted
**Context:** Need full control over data access patterns
**Decision:** All data filtering at NestJS application level
**Consequences:**
- Prisma queries always include organization_id filter
- Service-layer tenant isolation
- Simpler database migrations
- Easier debugging and testing

### ADR-007: Backend-Proxied AI Responses

**Status:** Accepted
**Context:** Need secure, observable AI integration
**Decision:** All AI requests proxied through NestJS backend
**Consequences:**
- Unified logging and metrics
- Easy provider switching
- No exposed webhook URLs
- Rate limiting and security controls

### ADR-008: Hybrid Analytics Processing

**Status:** Accepted
**Context:** Need real-time metrics without sacrificing performance
**Decision:** Real-time for recent data (7 days), batch aggregation for historical
**Consequences:**
- BullMQ for async job processing
- Materialized views for historical KPIs
- Sub-second dashboard loads
- 15-minute delay acceptable for older data

### ADR-009: CSS Variables for Theme Customization

**Status:** Accepted
**Context:** Need consistent theming between dashboard preview and widget
**Decision:** All 50+ theme options as CSS Custom Properties
**Consequences:**
- Shared theme transformer in packages/theme
- Identical rendering in preview and production
- Runtime theme updates without rebuilds
- Minimal CSS overhead (~2KB for variables)

### ADR-010: Zustand + TanStack Query for State Management

**Status:** Accepted
**Context:** Need lightweight, modern state management for dashboard application
**Decision:** Use TanStack Query for server state, Zustand for client state
**Consequences:**
- TanStack Query handles all API data (caching, refetching, loading states)
- Zustand for minimal client state (UI state, drafts, preferences)
- ~2KB total bundle vs ~11KB for Redux
- Simpler mental model: server state vs client state separation
- No providers needed for Zustand
- Redux DevTools compatible (Zustand middleware)

### ADR-011: Voice Provider Adapter Pattern with Multilingual Routing

**Status:** Accepted
**Context:** Need to support voice input/output (STT/TTS) for chat widgets with strong Indian regional language support (Hindi, Marathi, Hinglish). Different providers excel at different languages, and we need flexibility to swap providers without changing business logic.
**Decision:** Implement a voice provider adapter pattern (mirroring the AI provider pattern) with language-based routing. Use Sarvam AI as primary provider for Indian languages/Hinglish, with Deepgram and ElevenLabs as alternatives. Bhashini as a free fallback.
**Consequences:**
- Common `VoiceProvider` interface for all STT/TTS providers
- Language-based routing: Indian languages → Sarvam AI, English-dominant → Deepgram/ElevenLabs
- Per-agent voice configuration (provider, language, enable/disable STT/TTS independently)
- Voice is a pre-processor (STT) and post-processor (TTS) wrapping the existing text chat flow — n8n/AI layer remains unaware of voice
- Non-streaming: full response from n8n before TTS begins (n8n limitation)
- Future Realtime API path designed but deferred to Phase 2

### ADR-012: Resend for Transactional Email

**Status:** Accepted
**Context:** Need a transactional email service for invitation emails, password resets, and notifications
**Decision:** Use Resend (resend.com) via their Node.js SDK
**Consequences:**
- Simple HTTP-based API, no SMTP configuration needed
- Official `resend` npm package with TypeScript support
- Environment variable: `RESEND_API_KEY` for authentication
- Domain verification required for production sending
- Free tier sufficient for development (100 emails/day)
- EmailModule wraps Resend SDK for dependency injection

### ADR-013: Streaming Pipeline — n8n Chat Trigger + WebSocket STT/TTS

**Status:** Accepted
**Date:** 2026-03-23
**Context:** Voice conversation latency was ~9 seconds (STT 2s + AI 4s + TTS 3s) due to sequential HTTP calls. Text chat used simulated streaming (word-splitting a complete response). Testing revealed n8n's Chat Trigger URL supports real token-by-token streaming (verified: 47 chunks, 701ms to first token, ~54ms between tokens). All three STT providers (Sarvam, Deepgram, ElevenLabs) support WebSocket real-time streaming. Both TTS providers (Sarvam, ElevenLabs) support WebSocket streaming.
**Decision:** Migrate from HTTP-based sequential pipeline to streaming pipeline:
1. Replace simulated SSE text streaming with real n8n Chat Trigger token streaming (text + voice)
2. Replace HTTP-based STT with WebSocket streaming STT (voice only)
3. Replace HTTP-based TTS with WebSocket streaming TTS, triggered progressively per sentence (voice only)
4. n8n input remains non-streaming (n8n buffers full request body — this is a known, accepted limitation)

**Consequences:**
- Text chat: real token-by-token streaming to frontend via SSE (eliminates fake 20ms delay chunking)
- Voice: perceived latency drops from ~9-12s to ~4-5s (STT 0.3s + AI first sentence ~1-2s + TTS first sentence ~0.5s)
- New WebSocket connection management in providers (connection pooling, reconnection, cleanup)
- Sentence boundary detection needed for progressive TTS
- Metadata extraction changes: timestamps from n8n stream chunks replace `n8nReceivedAt`/`agentRepliedAt` fields
- The existing `webhookUrl` (stored in `AgentSecret`) points to the n8n Chat Trigger URL — no separate field needed
- Streaming is the default and only mode; the simulated word-splitting chunking is replaced entirely
- Metadata extraction changes: timestamps from n8n stream chunks replace `n8nReceivedAt`/`agentRepliedAt` fields

---

## 3. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────────┐
│     CDN (Static Assets)      │    │           Auth0                          │
│  - Widget JS bundle          │    │  - User Authentication                   │
│  - Dashboard static files    │    │  - JWT Token Issuance                    │
│  - Images, fonts             │    │  - Social Login Providers                │
└──────────────────────────────┘    └──────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOAD BALANCER / REVERSE PROXY                        │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
        ┌───────────┴───────────┐                  │
        ▼                       ▼                  │
┌───────────────────┐  ┌───────────────────┐       │
│  Dashboard App    │  │   Widget App      │       │
│  (Next.js v16)    │  │   (Static JS)     │       │
│                   │  │                   │       │
│  - Admin UI       │  │  - Chat Interface │       │
│  - Theme Editor   │  │  - Voice I/O      │       │
│  - Analytics      │  │  - Shadow DOM     │       │
│  - Agent Config   │  │                   │       │
└───────────────────┘  └───────────────────┘       │
        │                       │                  │
        └───────────┬───────────┘                  │
                    ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NestJS API Server (apps/api)                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │ Auth Module │ │ Agent Module│ │ Chat Module │ │ Analytics Module        ││
│  │ - JWT Guard │ │ - CRUD      │ │ - SSE Stream│ │ - KPI Calculation       ││
│  │ - RBAC      │ │ - Theme     │ │ - History   │ │ - BullMQ Jobs           ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────────┘│
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │ Org Module  │ │ User Module │ │ Voice Module│ │ AI Abstraction Layer    ││
│  │ - Tenancy   │ │ - Invites   │ │ - STT/TTS   │ │ - Provider Interface    ││
│  │ - Settings  │ │ - Roles     │ │ - Lang Det. │ │ - n8n Integration       ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
        ┌───────────┴───────────┐                  │
        ▼                       ▼                  ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────────┐
│  Supabase         │  │  Redis            │  │  n8n (AI Workflows)           │
│  (PostgreSQL)     │  │                   │  │                               │
│  - All app data   │  │  - Session cache  │  │  - LLM orchestration          │
│  - Object Storage │  │  - Rate limiting  │  │  - Custom webhooks            │
│  - Backups        │  │  - Job queues     │  │  - Per-agent configs          │
└───────────────────┘  └───────────────────┘  └───────────────────────────────┘
                                                           │
                                                           ▼
                                               ┌───────────────────────────────┐
                                               │  External AI Providers        │
                                               │  (via n8n abstraction)        │
                                               │  - OpenAI                     │
                                               │  - Anthropic                  │
                                               │  - Google AI                  │
                                               └───────────────────────────────┘
```

---

## 4. Monorepo Structure

```
codeweaves-platform/
├── apps/
│   ├── web/                      # Next.js Dashboard Application
│   │   ├── app/                  # App Router pages
│   │   │   ├── (auth)/           # Auth-required routes
│   │   │   │   ├── dashboard/
│   │   │   │   ├── agents/
│   │   │   │   ├── analytics/
│   │   │   │   ├── settings/
│   │   │   │   └── layout.tsx
│   │   │   ├── (public)/         # Public routes
│   │   │   │   ├── login/
│   │   │   │   └── signup/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── components/           # Dashboard-specific components
│   │   │   ├── agents/
│   │   │   ├── analytics/
│   │   │   ├── theme-editor/
│   │   │   └── widget-preview/
│   │   ├── lib/                  # Dashboard utilities
│   │   │   ├── api-client.ts
│   │   │   ├── auth.ts
│   │   │   └── utils.ts
│   │   ├── store/                # Zustand stores
│   │   │   ├── ui.store.ts       # UI state (sidebar, modals)
│   │   │   ├── theme-editor.store.ts # Theme draft state
│   │   │   └── index.ts
│   │   ├── hooks/                # Custom hooks
│   │   │   ├── queries/          # TanStack Query hooks
│   │   │   │   ├── use-agents.ts
│   │   │   │   ├── use-analytics.ts
│   │   │   │   └── use-user.ts
│   │   │   └── index.ts
│   │   ├── styles/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── api/                      # NestJS Backend Application
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.module.ts
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── guards/
│   │   │   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   │   │   └── roles.guard.ts
│   │   │   │   │   ├── strategies/
│   │   │   │   │   │   └── jwt.strategy.ts
│   │   │   │   │   └── decorators/
│   │   │   │   │       ├── current-user.decorator.ts
│   │   │   │   │       └── roles.decorator.ts
│   │   │   │   ├── users/
│   │   │   │   │   ├── users.module.ts
│   │   │   │   │   ├── users.controller.ts
│   │   │   │   │   ├── users.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── organizations/
│   │   │   │   │   ├── organizations.module.ts
│   │   │   │   │   ├── organizations.controller.ts
│   │   │   │   │   ├── organizations.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── agents/
│   │   │   │   │   ├── agents.module.ts
│   │   │   │   │   ├── agents.controller.ts
│   │   │   │   │   ├── agents.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── themes/
│   │   │   │   │   ├── themes.module.ts
│   │   │   │   │   ├── themes.controller.ts
│   │   │   │   │   ├── themes.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── chat/
│   │   │   │   │   ├── chat.module.ts
│   │   │   │   │   ├── chat.controller.ts
│   │   │   │   │   ├── chat.service.ts
│   │   │   │   │   ├── chat.gateway.ts      # SSE handling
│   │   │   │   │   └── dto/
│   │   │   │   ├── analytics/
│   │   │   │   │   ├── analytics.module.ts
│   │   │   │   │   ├── analytics.controller.ts
│   │   │   │   │   ├── analytics.service.ts
│   │   │   │   │   ├── processors/          # BullMQ job processors
│   │   │   │   │   └── dto/
│   │   │   │   ├── voice/
│   │   │   │   │   ├── voice.module.ts
│   │   │   │   │   ├── voice.controller.ts
│   │   │   │   │   ├── voice.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── ai/
│   │   │   │   │   ├── ai.module.ts
│   │   │   │   │   ├── ai.service.ts
│   │   │   │   │   ├── providers/
│   │   │   │   │   │   ├── ai-provider.interface.ts
│   │   │   │   │   │   ├── n8n.provider.ts
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── widget/
│   │   │   │   │   ├── widget.module.ts
│   │   │   │   │   ├── widget.controller.ts
│   │   │   │   │   └── widget.service.ts
│   │   │   │   └── health/
│   │   │   │       ├── health.module.ts
│   │   │   │       └── health.controller.ts
│   │   │   ├── common/
│   │   │   │   ├── filters/
│   │   │   │   │   └── global-exception.filter.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   ├── logging.interceptor.ts
│   │   │   │   │   └── transform.interceptor.ts
│   │   │   │   ├── middleware/
│   │   │   │   │   ├── tenant.middleware.ts
│   │   │   │   │   └── rate-limit.middleware.ts
│   │   │   │   ├── decorators/
│   │   │   │   └── pipes/
│   │   │   │       └── zod-validation.pipe.ts
│   │   │   ├── config/
│   │   │   │   ├── configuration.ts
│   │   │   │   ├── auth0.config.ts
│   │   │   │   ├── database.config.ts
│   │   │   │   └── sentry.config.ts
│   │   │   ├── prisma/
│   │   │   │   ├── prisma.module.ts
│   │   │   │   └── prisma.service.ts
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── test/
│   │   │   ├── unit/
│   │   │   └── jest.config.ts
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── widget/                   # Preact Widget Application
│       ├── src/
│       │   ├── components/       # Widget-specific wrappers
│       │   │   ├── Widget.tsx
│       │   │   ├── ChatWindow.tsx
│       │   │   └── IconButton.tsx
│       │   ├── hooks/
│       │   │   ├── useChat.ts
│       │   │   ├── useTheme.ts
│       │   │   ├── useVoice.ts
│       │   │   └── useDevice.ts
│       │   ├── services/
│       │   │   ├── api.ts
│       │   │   ├── sse.ts
│       │   │   └── storage.ts
│       │   ├── utils/
│       │   │   ├── device-id.ts
│       │   │   └── sanitize.ts
│       │   ├── shadow-dom.ts     # Shadow DOM initialization
│       │   ├── index.ts          # Entry point
│       │   └── styles/
│       │       └── widget.css    # Compiled Tailwind for widget
│       ├── vite.config.ts
│       ├── tailwind.config.ts    # Widget-specific Tailwind config
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── validation/               # Shared Zod Schemas
│   │   ├── src/
│   │   │   ├── schemas/
│   │   │   │   ├── user.schema.ts
│   │   │   │   ├── organization.schema.ts
│   │   │   │   ├── agent.schema.ts
│   │   │   │   ├── theme.schema.ts
│   │   │   │   ├── chat.schema.ts
│   │   │   │   ├── analytics.schema.ts
│   │   │   │   └── index.ts
│   │   │   ├── types/            # Generated TypeScript types
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── theme/                    # Theme Utilities
│   │   ├── src/
│   │   │   ├── types.ts          # Theme type definitions
│   │   │   ├── defaults.ts       # Default theme values
│   │   │   ├── transformer.ts    # Theme to CSS Variables
│   │   │   ├── validator.ts      # Theme validation
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── widget-ui/                # Shared Widget Components
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ChatHeader.tsx
│   │   │   │   ├── ChatBody.tsx
│   │   │   │   ├── ChatInput.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── TypingIndicator.tsx
│   │   │   │   ├── VoiceButton.tsx
│   │   │   │   ├── StarterButtons.tsx
│   │   │   │   └── index.ts
│   │   │   ├── styles/
│   │   │   │   └── components.css
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── ui/                       # Shadcn UI Components (Dashboard)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── button.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── card.tsx
│   │   │   │   └── ...
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── typescript-config/        # Shared TypeScript Configs
│   │   ├── base.json
│   │   ├── nextjs.json
│   │   ├── nestjs.json
│   │   └── package.json
│   │
│   └── eslint-config/            # Shared ESLint Configs
│       ├── base.js
│       ├── next.js
│       ├── nest.js
│       └── package.json
│
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint + Test on PR
│       ├── deploy-api.yml        # Deploy NestJS
│       └── deploy-web.yml        # Deploy Next.js
│
├── docker/
│   └── api.Dockerfile            # NestJS production Dockerfile
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
├── .env.example
└── README.md
```

---

## 5. Backend Architecture (NestJS)

### 5.1 Module Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         AppModule                                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ConfigModule │ │PrismaModule │ │HealthModule │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Feature Modules                          ││
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐││
│  │ │AuthModule │ │UserModule │ │ OrgModule │ │ AgentModule   │││
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────────┘││
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐││
│  │ │ThemeModule│ │ChatModule │ │VoiceModule│ │AnalyticsModule│││
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────────┘││
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐││
│  │ │ AIModule  │ │WidgetMod. │ │EmailModule│ │InvitationsMod.│││
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Common/Infrastructure                    ││
│  │ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐││
│  │ │GlobalExceptionF.│ │LoggingIntercept.│ │ZodValidationPipe│││
│  │ └─────────────────┘ └─────────────────┘ └─────────────────┘││
│  │ ┌─────────────────┐ ┌─────────────────┐                    ││
│  │ │TenantMiddleware │ │RateLimitMiddle. │                    ││
│  │ └─────────────────┘ └─────────────────┘                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Request Flow

```
HTTP Request
     │
     ▼
┌─────────────────┐
│   Middleware    │  ← Rate Limiting, Tenant Context
└────────┬────────┘
         ▼
┌─────────────────┐
│     Guards      │  ← JWT Validation, RBAC Check
└────────┬────────┘
         ▼
┌─────────────────┐
│  Interceptors   │  ← Logging, Response Transform
└────────┬────────┘
         ▼
┌─────────────────┐
│     Pipes       │  ← Zod Validation
└────────┬────────┘
         ▼
┌─────────────────┐
│   Controller    │  ← Route Handler
└────────┬────────┘
         ▼
┌─────────────────┐
│    Service      │  ← Business Logic
└────────┬────────┘
         ▼
┌─────────────────┐
│     Prisma      │  ← Database Access
└─────────────────┘
```

### 5.3 Global Exception Filter

```typescript
// apps/api/src/common/filters/global-exception.filter.ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly sentryService: SentryService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Report to Sentry
    this.sentryService.captureException(exception, {
      extra: {
        url: request.url,
        method: request.method,
        userId: request.user?.id,
        orgId: request.user?.organizationId,
      },
    });

    // Return RFC 7807 Problem Details response
    const problemDetails = this.buildProblemDetails(exception, request);
    response.status(problemDetails.status).json(problemDetails);
  }
}
```

### 5.4 Zod Validation Pipe

```typescript
// apps/api/src/common/pipes/zod-validation.pipe.ts
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
```

### 5.5 Swagger Configuration

```typescript
// apps/api/src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('CodeWeaves API')
    .setDescription('AI Chat Widget Platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentication endpoints')
    .addTag('agents', 'Agent management')
    .addTag('themes', 'Theme customization')
    .addTag('chat', 'Chat messaging')
    .addTag('analytics', 'Analytics and metrics')
    .addTag('widget', 'Widget configuration')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3001);
}
```

### 5.6 DTO Pattern with Swagger Decorators

```typescript
// apps/api/src/modules/agents/dto/create-agent.dto.ts
import { createAgentSchema } from '@codeweaves/validation';
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// Use Zod schema as source of truth
export class CreateAgentDto {
  @ApiProperty({
    description: 'Agent display name',
    example: 'ShopAssist',
    minLength: 2,
    maxLength: 100,
  })
  name: string;

  @ApiProperty({
    description: 'Agent status',
    enum: ['active', 'inactive'],
    default: 'active',
  })
  status: 'active' | 'inactive';

  @ApiProperty({
    description: 'Allowed domains for widget embedding',
    example: ['*.example.com', 'shop.example.com'],
    isArray: true,
  })
  allowedDomains: string[];
}

// Type inference from Zod
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
```

---

## 6. Frontend Architecture (Next.js)

### 6.1 App Router Structure

```
apps/web/app/
├── layout.tsx                    # Root layout (providers, fonts)
├── page.tsx                      # Landing page (redirect to dashboard)
├── globals.css                   # Global styles
│
├── (auth)/                       # Authenticated routes group
│   ├── layout.tsx                # Auth check, sidebar, header
│   ├── dashboard/
│   │   └── page.tsx              # Main dashboard
│   ├── agents/
│   │   ├── page.tsx              # Agent list
│   │   ├── new/
│   │   │   └── page.tsx          # Create agent wizard
│   │   └── [agentId]/
│   │       ├── page.tsx          # Agent details
│   │       ├── theme/
│   │       │   └── page.tsx      # Theme editor
│   │       ├── settings/
│   │       │   └── page.tsx      # Agent settings
│   │       └── analytics/
│   │           └── page.tsx      # Agent-specific analytics
│   ├── analytics/
│   │   └── page.tsx              # Organization-wide analytics
│   ├── settings/
│   │   ├── page.tsx              # Account settings
│   │   ├── organization/
│   │   │   └── page.tsx          # Org settings
│   │   └── team/
│   │       └── page.tsx          # Team management
│   └── admin/                    # Super Admin only
│       ├── layout.tsx            # Admin role check
│       ├── organizations/
│       │   └── page.tsx
│       └── users/
│           └── page.tsx
│
├── (public)/                     # Public routes group
│   ├── layout.tsx                # Minimal layout
│   ├── login/
│   │   └── page.tsx
│   └── invite/
│       └── [token]/
│           └── page.tsx          # Accept invitation
│
└── api/                          # Next.js API routes (BFF only)
    └── auth/
        └── [...auth0]/
            └── route.ts          # Auth0 callback handler
```

### 6.2 State Management (Zustand + TanStack Query)

**Server State: TanStack Query**
```typescript
// apps/web/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// apps/web/hooks/queries/use-agents.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Agent, CreateAgentInput } from '@codeweaves/validation';

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => apiClient.get<Agent[]>('/agents'),
  });
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: () => apiClient.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAgentInput) => apiClient.post('/agents', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
```

**Client State: Zustand**
```typescript
// apps/web/store/ui.store.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  activeModal: string | null;
  toggleSidebar: () => void;
  openModal: (modal: string) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        activeModal: null,
        toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
        openModal: (modal) => set({ activeModal: modal }),
        closeModal: () => set({ activeModal: null }),
      }),
      { name: 'ui-storage' }
    ),
    { name: 'UIStore' }
  )
);

// apps/web/store/theme-editor.store.ts
import { create } from 'zustand';
import { WidgetTheme } from '@codeweaves/theme';

interface ThemeEditorState {
  draft: Partial<WidgetTheme> | null;
  isDirty: boolean;
  setDraft: (theme: Partial<WidgetTheme>) => void;
  updateDraft: (changes: Partial<WidgetTheme>) => void;
  resetDraft: () => void;
}

export const useThemeEditorStore = create<ThemeEditorState>((set) => ({
  draft: null,
  isDirty: false,
  setDraft: (theme) => set({ draft: theme, isDirty: false }),
  updateDraft: (changes) => set((s) => ({
    draft: { ...s.draft, ...changes },
    isDirty: true,
  })),
  resetDraft: () => set({ draft: null, isDirty: false }),
}));
```

**Provider Setup**
```typescript
// apps/web/app/providers.tsx
'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
// Note: Zustand stores need no provider!
```

### 6.3 Data Fetching Pattern

```typescript
// apps/web/lib/api-client.ts
import { z } from 'zod';

class APIClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL!;
  }

  setToken(token: string) {
    this.token = token;
  }

  async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: z.ZodType<T>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new APIError(response.status, await response.json());
    }

    const data = await response.json();
    return schema ? schema.parse(data) : data;
  }
}

export const apiClient = new APIClient();
```

### 6.4 Avoiding Waterfall Requests

```typescript
// apps/web/app/(auth)/agents/[agentId]/page.tsx
import { Suspense } from 'react';
import { AgentDetails } from '@/components/agents/AgentDetails';
import { AgentAnalyticsSummary } from '@/components/agents/AgentAnalyticsSummary';
import { AgentMessages } from '@/components/agents/AgentMessages';

// Parallel data fetching - NO waterfall
export default async function AgentPage({ params }: { params: { agentId: string } }) {
  return (
    <div className="grid grid-cols-12 gap-6">
      {/* All these load in parallel */}
      <Suspense fallback={<AgentDetailsSkeleton />}>
        <AgentDetails agentId={params.agentId} />
      </Suspense>

      <Suspense fallback={<AnalyticsSkeleton />}>
        <AgentAnalyticsSummary agentId={params.agentId} />
      </Suspense>

      <Suspense fallback={<MessagesSkeleton />}>
        <AgentMessages agentId={params.agentId} />
      </Suspense>
    </div>
  );
}

// Component fetches its own data
async function AgentDetails({ agentId }: { agentId: string }) {
  const agent = await getAgent(agentId);
  return <AgentCard agent={agent} />;
}
```

### 6.5 Sentry Integration

```typescript
// apps/web/app/layout.tsx
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  integrations: [
    new Sentry.BrowserTracing(),
    new Sentry.Replay(),
  ],
});

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
          {children}
        </Sentry.ErrorBoundary>
      </body>
    </html>
  );
}
```

---

## 7. Widget Architecture (Preact + Shadow DOM)

### 7.1 Widget Initialization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Host Website loads: <script src="widget.js?id=abc123">         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. widget.js self-executes                                     │
│     - Extract publicId from script URL                          │
│     - Create <codeweaves-widget> custom element                 │
│     - Append to document.body                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Custom Element connectedCallback()                          │
│     - Create closed Shadow DOM                                  │
│     - Fetch config from API: GET /widget/config?id=abc123       │
│     - Generate device ID                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Apply Theme                                                 │
│     - Convert theme config to CSS Variables                     │
│     - Inject <style> into Shadow DOM                            │
│     - Inject compiled Tailwind CSS                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Render Preact App                                           │
│     - Mount Widget component into Shadow DOM                    │
│     - Display minimized icon                                    │
│     - Set up event listeners                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Widget Ready                                                │
│     - Show bubble notification (if configured)                  │
│     - Listen for user interactions                              │
│     - Track widget_opened event on first expand                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Shadow DOM Structure

```typescript
// apps/widget/src/shadow-dom.ts
export function initializeWidget(publicId: string) {
  // Create custom element
  class CodeWeavesWidget extends HTMLElement {
    private shadowRoot: ShadowRoot;

    constructor() {
      super();
      // Closed shadow DOM - no external access
      this.shadowRoot = this.attachShadow({ mode: 'closed' });
    }

    async connectedCallback() {
      // Fetch configuration
      const config = await fetchWidgetConfig(publicId);

      // Generate CSS from theme
      const themeCSS = themeToCSS(config.theme);

      // Inject all styles into shadow DOM
      this.shadowRoot.innerHTML = `
        <style>
          ${themeCSS}
          ${COMPILED_TAILWIND_CSS}
          ${WIDGET_COMPONENT_CSS}
        </style>
        <div id="widget-root"></div>
      `;

      // Mount Preact app
      const root = this.shadowRoot.getElementById('widget-root')!;
      render(<Widget config={config} />, root);
    }
  }

  // Register custom element
  customElements.define('codeweaves-widget', CodeWeavesWidget);

  // Auto-append to body
  document.body.appendChild(document.createElement('codeweaves-widget'));
}
```

### 7.3 Theme to CSS Variables

```typescript
// packages/theme/src/transformer.ts
import { WidgetTheme } from './types';

export function themeToCSS(theme: WidgetTheme): string {
  return `
    :host {
      /* Icon Customization */
      --cw-icon-position: ${theme.icon.position};
      --cw-icon-bg: ${theme.icon.backgroundColor};
      --cw-icon-hover-bg: ${theme.icon.hoverBackgroundColor};
      --cw-icon-size: ${theme.icon.size}px;
      --cw-icon-radius: ${theme.icon.borderRadius}%;
      --cw-icon-shadow: ${theme.icon.shadow};

      /* Header Customization */
      --cw-header-bg: ${theme.header.backgroundColor};
      --cw-header-text: ${theme.header.textColor};
      --cw-header-subtitle-text: ${theme.header.subtitleColor};

      /* Message Bubbles */
      --cw-msg-user-bg: ${theme.userMessage.backgroundColor};
      --cw-msg-user-text: ${theme.userMessage.textColor};
      --cw-msg-user-radius: ${theme.userMessage.borderRadius}px;
      --cw-msg-bot-bg: ${theme.botMessage.backgroundColor};
      --cw-msg-bot-text: ${theme.botMessage.textColor};
      --cw-msg-bot-radius: ${theme.botMessage.borderRadius}px;

      /* Input Field */
      --cw-input-bg: ${theme.input.backgroundColor};
      --cw-input-text: ${theme.input.textColor};
      --cw-input-placeholder: ${theme.input.placeholderColor};
      --cw-input-border: ${theme.input.borderColor};
      --cw-input-radius: ${theme.input.borderRadius}px;

      /* Send Button */
      --cw-send-bg: ${theme.sendButton.backgroundColor};
      --cw-send-hover-bg: ${theme.sendButton.hoverBackgroundColor};
      --cw-send-icon: ${theme.sendButton.iconColor};

      /* Chat Body */
      --cw-body-bg: ${theme.body.backgroundColor};

      /* Typography */
      --cw-font-family: ${theme.typography.fontFamily};
      --cw-font-size-base: ${theme.typography.baseFontSize}px;

      /* Animations */
      --cw-transition-duration: ${theme.animations.transitionDuration}ms;
    }
  `;
}

// For dashboard preview (inline styles)
export function themeToInlineStyles(theme: WidgetTheme): React.CSSProperties {
  return {
    '--cw-icon-bg': theme.icon.backgroundColor,
    '--cw-header-bg': theme.header.backgroundColor,
    // ... all variables as inline style object
  } as React.CSSProperties;
}
```

### 7.4 Shared Widget UI Components

```typescript
// packages/widget-ui/src/components/MessageBubble.tsx
import { ComponentChildren } from 'preact';

interface MessageBubbleProps {
  variant: 'user' | 'bot';
  children: ComponentChildren;
  timestamp?: Date;
  showTimestamp?: boolean;
}

export function MessageBubble({
  variant,
  children,
  timestamp,
  showTimestamp
}: MessageBubbleProps) {
  const baseClasses = 'px-3 py-2 max-w-[80%] break-words';
  const variantClasses = variant === 'user'
    ? 'ml-auto bg-[var(--cw-msg-user-bg)] text-[var(--cw-msg-user-text)] rounded-[var(--cw-msg-user-radius)]'
    : 'mr-auto bg-[var(--cw-msg-bot-bg)] text-[var(--cw-msg-bot-text)] rounded-[var(--cw-msg-bot-radius)]';

  return (
    <div className={`${baseClasses} ${variantClasses}`}>
      {children}
      {showTimestamp && timestamp && (
        <span className="text-xs opacity-60 mt-1 block">
          {formatTime(timestamp)}
        </span>
      )}
    </div>
  );
}
```

### 7.5 Widget Build Configuration

```typescript
// apps/widget/vite.config.ts
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'CodeWeavesWidget',
      fileName: () => 'widget.js',
      formats: ['iife'], // Single self-executing file
    },
    rollupOptions: {
      output: {
        // Inline all CSS into JS
        assetFileNames: '[name][extname]',
        // No code splitting - single file
        manualChunks: undefined,
      },
    },
    // Target modern browsers for smaller bundle
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
  },
});
```

---

## 8. Shared Packages

### 8.1 packages/validation - Zod Schemas

```typescript
// packages/validation/src/schemas/agent.schema.ts
import { z } from 'zod';

export const agentStatusSchema = z.enum(['active', 'inactive']);

export const createAgentSchema = z.object({
  name: z.string().min(2).max(100),
  status: agentStatusSchema.default('active'),
  allowedDomains: z.array(z.string()).min(1),
  systemPrompt: z.string().optional(),
  welcomeMessage: z.string().optional(),
  languageSupport: z.array(z.enum(['en', 'hi', 'mr', 'hinglish'])).default(['en']),
  voiceEnabled: z.boolean().default(false),
});

export const updateAgentSchema = createAgentSchema.partial();

export const agentSchema = createAgentSchema.extend({
  id: z.string().uuid(),
  publicId: z.string().length(8),
  organizationId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Type exports
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type Agent = z.infer<typeof agentSchema>;
```

### 8.2 packages/theme - Theme Definitions

```typescript
// packages/theme/src/types.ts
import { z } from 'zod';

export const iconConfigSchema = z.object({
  position: z.enum(['left', 'right']),
  backgroundColor: z.string(),
  hoverBackgroundColor: z.string(),
  size: z.number().min(40).max(80),
  borderRadius: z.number().min(0).max(50),
  customImageUrl: z.string().url().optional(),
  shadow: z.string(),
});

export const headerConfigSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  backgroundColor: z.string(),
  textColor: z.string(),
  subtitleColor: z.string(),
  showLogo: z.boolean(),
  logoUrl: z.string().url().optional(),
});

export const messageConfigSchema = z.object({
  backgroundColor: z.string(),
  textColor: z.string(),
  borderRadius: z.number().min(0).max(24),
});

export const inputConfigSchema = z.object({
  backgroundColor: z.string(),
  textColor: z.string(),
  placeholderText: z.string(),
  placeholderColor: z.string(),
  borderColor: z.string(),
  borderRadius: z.number().min(0).max(24),
});

export const widgetThemeSchema = z.object({
  icon: iconConfigSchema,
  header: headerConfigSchema,
  userMessage: messageConfigSchema,
  botMessage: messageConfigSchema,
  input: inputConfigSchema,
  sendButton: z.object({
    backgroundColor: z.string(),
    hoverBackgroundColor: z.string(),
    iconColor: z.string(),
  }),
  body: z.object({
    backgroundColor: z.string(),
  }),
  bubble: z.object({
    enabled: z.boolean(),
    text: z.string(),
    backgroundColor: z.string(),
    textColor: z.string(),
    delayMs: z.number(),
  }),
  typography: z.object({
    fontFamily: z.string(),
    baseFontSize: z.number(),
  }),
  animations: z.object({
    transitionDuration: z.number(),
    showTypingIndicator: z.boolean(),
  }),
  timestamps: z.object({
    show: z.boolean(),
    format: z.enum(['12h', '24h']),
  }),
  starters: z.array(z.object({
    text: z.string(),
    message: z.string(),
  })).max(4),
});

export type WidgetTheme = z.infer<typeof widgetThemeSchema>;
export type IconConfig = z.infer<typeof iconConfigSchema>;
export type HeaderConfig = z.infer<typeof headerConfigSchema>;
```

### 8.3 packages/widget-ui - Shared Components

```
packages/widget-ui/
├── src/
│   ├── components/
│   │   ├── ChatHeader.tsx       # Widget header with title/logo
│   │   ├── ChatBody.tsx         # Message list container
│   │   ├── ChatInput.tsx        # Text input with send button
│   │   ├── MessageBubble.tsx    # User/bot message bubble
│   │   ├── TypingIndicator.tsx  # Animated typing dots
│   │   ├── VoiceButton.tsx      # Voice input toggle
│   │   ├── StarterButtons.tsx   # Quick reply buttons
│   │   ├── IconButton.tsx       # Minimized widget icon
│   │   ├── BubbleNotification.tsx # Pop-up notification
│   │   └── index.ts
│   ├── hooks/
│   │   ├── useScrollToBottom.ts
│   │   └── useAutoResize.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

---

## 9. Authentication & Authorization

### 9.1 Auth0 Configuration

```typescript
// apps/api/src/config/auth0.config.ts
export const auth0Config = {
  domain: process.env.AUTH0_DOMAIN,           // e.g., 'codeweaves.auth0.com'
  audience: process.env.AUTH0_AUDIENCE,       // e.g., 'https://api.codeweaves.io'
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  algorithms: ['RS256'],
};
```

### 9.2 JWT Strategy (NestJS)

```typescript
// apps/api/src/modules/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { auth0Config } from '@/config/auth0.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${auth0Config.issuerBaseURL}/.well-known/jwks.json`,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: auth0Config.audience,
      issuer: auth0Config.issuerBaseURL,
      algorithms: auth0Config.algorithms,
    });
  }

  async validate(payload: Auth0Payload): Promise<RequestUser> {
    // Map Auth0 claims to internal user
    return {
      auth0Id: payload.sub,
      email: payload.email,
      roles: payload['https://codeweaves.io/roles'] || [],
      organizationId: payload['https://codeweaves.io/org_id'],
    };
  }
}
```

### 9.3 Role-Based Access Control

```typescript
// apps/api/src/modules/auth/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@codeweaves/validation';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles.includes(role));
  }
}

// Usage in controller
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminUsersController {
  @Get()
  @ApiOperation({ summary: 'List all users (Super Admin only)' })
  async listUsers() {
    // ...
  }
}
```

### 9.4 Frontend Auth Flow (Next.js)

```typescript
// apps/web/lib/auth.ts
import { Auth0Client } from '@auth0/auth0-spa-js';

const auth0 = new Auth0Client({
  domain: process.env.NEXT_PUBLIC_AUTH0_DOMAIN!,
  clientId: process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID!,
  authorizationParams: {
    redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
    audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE!,
  },
});

export async function login() {
  await auth0.loginWithRedirect();
}

export async function logout() {
  await auth0.logout({
    logoutParams: {
      returnTo: window.location.origin,
    },
  });
}

export async function getAccessToken(): Promise<string> {
  return auth0.getTokenSilently();
}

export async function getUser() {
  return auth0.getUser();
}
```

### 9.5 Permission Matrix

| Role | Agents (Own Org) | Agents (All Orgs) | Analytics | Users | Billing |
|------|------------------|-------------------|-----------|-------|---------|
| Super Admin | Full | Full | Full | Full | Full |
| Admin User | Full | Full | Full (limited) | Read | None |
| Client User | Full | None | Own Org | None | None |

---

## 10. Database Architecture

### 10.1 Prisma Schema

```prisma
// apps/api/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// ORGANIZATION & USER MANAGEMENT
// ============================================

model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users     User[]
  agents    Agent[]

  @@index([slug])
}

model User {
  id             String       @id @default(uuid())
  auth0Id        String       @unique
  email          String       @unique
  displayName    String?
  role           Role         @default(CLIENT)
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id])
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  invitationsSent UserInvitation[] @relation("InvitedBy")
  auditLogs       AuditLog[]

  @@index([auth0Id])
  @@index([organizationId])
}

enum Role {
  SUPER_ADMIN
  ADMIN
  CLIENT
}

model UserInvitation {
  id            String           @id @default(uuid())
  email         String
  role          Role
  status        InvitationStatus @default(PENDING)
  token         String           @unique
  reissueToken  String           @unique
  reissueCount  Int              @default(0)
  expiresAt     DateTime
  invitedById   String
  invitedBy     User             @relation("InvitedBy", fields: [invitedById], references: [id])
  organizationId String?
  createdAt     DateTime         @default(now())

  @@index([token])
  @@index([email])
}

enum InvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
}

// ============================================
// AGENT & THEME CONFIGURATION
// ============================================

model Agent {
  id             String       @id @default(uuid())
  publicId       String       @unique @db.VarChar(8)
  name           String
  status         AgentStatus  @default(ACTIVE)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  allowedDomains String[]
  systemPrompt   String?      @db.Text
  welcomeMessage String?
  languageSupport String[]    @default(["en"])
  voiceEnabled   Boolean      @default(false)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?

  theme          AgentTheme?
  secrets        AgentSecret?
  sessions       ChatSession[]
  events         UsageEvent[]

  @@index([publicId])
  @@index([organizationId])
  @@index([status])
}

enum AgentStatus {
  ACTIVE
  INACTIVE
}

model AgentTheme {
  id        String   @id @default(uuid())
  agentId   String   @unique
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  config    Json     // Stores full WidgetTheme object
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AgentSecret {
  id              String   @id @default(uuid())
  agentId         String   @unique
  agent           Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  webhookUrl      String?  // Encrypted
  webhookHeaders  String?  // Encrypted JSON
  apiKey          String?  // Encrypted
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// ============================================
// CHAT & SESSIONS
// ============================================

model ChatSession {
  id              String    @id @default(uuid())
  agentId         String
  agent           Agent     @relation(fields: [agentId], references: [id])
  deviceId        String
  deviceFingerprint String?
  ipAddress       String?
  userAgent       String?
  country         String?
  language        String?   @default("en")
  isReturning     Boolean   @default(false)
  startedAt       DateTime  @default(now())
  lastSeenAt      DateTime  @default(now())
  messageCount    Int       @default(0)

  messages        ChatMessage[]

  @@index([agentId])
  @@index([deviceId])
  @@index([startedAt])
  @@index([agentId, startedAt])
}

model ChatMessage {
  id           String      @id @default(uuid())
  sessionId    String
  session      ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role         MessageRole
  content      String      @db.Text
  metadata     Json?       // { model, tokens, latency, etc. }
  pageUrl      String?
  createdAt    DateTime    @default(now())

  @@index([sessionId])
  @@index([createdAt])
}

enum MessageRole {
  USER
  BOT
  SYSTEM
}

// ============================================
// ANALYTICS & EVENTS
// ============================================

model UsageEvent {
  id        String    @id @default(uuid())
  agentId   String
  agent     Agent     @relation(fields: [agentId], references: [id])
  eventType EventType
  deviceId  String?
  sessionId String?
  metadata  Json?
  pageUrl   String?
  userAgent String?
  country   String?
  createdAt DateTime  @default(now())

  @@index([agentId])
  @@index([eventType])
  @@index([createdAt])
  @@index([agentId, eventType, createdAt])
}

enum EventType {
  WIDGET_OPENED
  WIDGET_CLOSED
  MESSAGE_SENT
  MESSAGE_RECEIVED
  RATING_SUBMITTED
  VOICE_INPUT_USED
  VOICE_OUTPUT_USED
  ERROR_OCCURRED
  FALLBACK_TRIGGERED
}

model AnalyticsAggregation {
  id             String   @id @default(uuid())
  agentId        String
  organizationId String
  period         String   // 'daily', 'weekly', 'monthly'
  periodStart    DateTime
  periodEnd      DateTime
  metrics        Json     // Pre-computed KPIs
  createdAt      DateTime @default(now())

  @@unique([agentId, period, periodStart])
  @@index([organizationId, periodStart])
}

// ============================================
// AUDIT LOGGING
// ============================================

model AuditLog {
  id             String   @id @default(uuid())
  userId         String?
  user           User?    @relation(fields: [userId], references: [id])
  organizationId String?
  action         String   // CREATE, UPDATE, DELETE, etc.
  resource       String   // agents, themes, users, etc.
  resourceId     String?
  details        Json?
  ipAddress      String?
  userAgent      String?
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@index([userId])
  @@index([resource, resourceId])
  @@index([createdAt])
}
```

### 10.2 Multi-Tenancy Data Access Pattern

```typescript
// apps/api/src/modules/agents/agents.service.ts
@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService) {}

  // ALL queries MUST include organization filtering
  async findAll(user: RequestUser): Promise<Agent[]> {
    const where: Prisma.AgentWhereInput = {
      deletedAt: null,
    };

    // Apply tenant filtering based on role
    if (user.role === Role.CLIENT) {
      // Client can only see their own org's agents
      where.organizationId = user.organizationId;
    } else if (user.role === Role.ADMIN) {
      // Admin can see all (or filter by org if requested)
      // No additional filter needed
    }
    // SUPER_ADMIN sees all - no filter

    return this.prisma.agent.findMany({
      where,
      include: { theme: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: RequestUser): Promise<Agent> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
        // Always verify org access for non-super-admins
        ...(user.role !== Role.SUPER_ADMIN && {
          organizationId: user.organizationId,
        }),
      },
      include: { theme: true },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }
}
```

---

## 11. API Design

### 11.1 RESTful Endpoints

```
BASE URL: https://api.codeweaves.io/v1

┌─────────────────────────────────────────────────────────────────────────────┐
│ AUTHENTICATION                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ POST   /auth/callback          Auth0 callback (internal)                    │
│ POST   /auth/refresh           Refresh access token                         │
│ GET    /auth/me                Get current user profile                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ USERS (Super Admin only for most)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /users                  List all users                               │
│ GET    /users/:id              Get user details                             │
│ PATCH  /users/:id              Update user                                  │
│ POST   /users/invite           Send invitation email                        │
│ POST   /users/invite/reissue   Reissue expired invitation                   │
│ GET    /users/invitations      List pending invitations                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ORGANIZATIONS                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /organizations          List organizations                           │
│ POST   /organizations          Create organization                          │
│ GET    /organizations/:id      Get organization details                     │
│ PATCH  /organizations/:id      Update organization                          │
│ DELETE /organizations/:id      Delete organization (soft)                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ AGENTS                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /agents                 List agents (filtered by role)               │
│ POST   /agents                 Create agent                                 │
│ GET    /agents/:id             Get agent details                            │
│ PATCH  /agents/:id             Update agent                                 │
│ DELETE /agents/:id             Delete agent (soft)                          │
│ GET    /agents/:id/embed-code  Get embed code snippet                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ THEMES                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /agents/:id/theme       Get agent theme                              │
│ PUT    /agents/:id/theme       Update agent theme (full replace)            │
│ PATCH  /agents/:id/theme       Partial theme update                         │
│ POST   /agents/:id/theme/reset Reset to defaults                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ CHAT (Widget endpoints - different auth)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ POST   /chat/message           Send message, get AI response                │
│ GET    /chat/stream            SSE endpoint for streaming                   │
│ POST   /chat/messages/bulk     Bulk message ingestion                       │
│ POST   /chat/session           Create/resolve session                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ VOICE                                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ POST   /voice/transcribe       Speech-to-text                               │
│ POST   /voice/synthesize       Text-to-speech                               │
│ POST   /voice/detect-language  Detect language from audio                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ANALYTICS                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /analytics/overview     Dashboard overview (14 KPIs)                 │
│ GET    /analytics/users        User metrics (new, returning, growth)        │
│ GET    /analytics/conversations Conversation metrics                        │
│ GET    /analytics/messages     Message volume and trends                    │
│ GET    /analytics/performance  Response times, fallback rates               │
│ GET    /analytics/languages    Language distribution                        │
│ GET    /analytics/topics       Topic analysis                               │
│ GET    /analytics/agents/:id   Per-agent analytics                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ WIDGET (Public endpoints - no auth, CORS validated)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /widget/config          Get widget configuration by publicId         │
│ POST   /widget/events          Track widget events                          │
│ GET    /widget/health          Widget health check                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ AUDIT (Admin+ only)                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /audit/logs             Query audit logs                             │
│ GET    /audit/logs/:id         Get audit log details                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ HEALTH                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ GET    /health                 Basic health check                           │
│ GET    /health/ready           Readiness probe (DB, Redis, etc.)            │
│ GET    /health/live            Liveness probe                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Error Response Format (RFC 7807)

```typescript
// Standard error response
interface ProblemDetails {
  type: string;      // URI reference for error type
  title: string;     // Human-readable summary
  status: number;    // HTTP status code
  detail?: string;   // Human-readable explanation
  instance?: string; // URI reference for specific occurrence
  errors?: Record<string, string[]>; // Validation errors
}

// Example response
{
  "type": "https://api.codeweaves.io/errors/validation",
  "title": "Validation Failed",
  "status": 400,
  "detail": "The request body contains invalid data",
  "instance": "/v1/agents",
  "errors": {
    "name": ["Name must be at least 2 characters"],
    "allowedDomains": ["At least one domain is required"]
  }
}
```

### 11.3 Pagination Response

```typescript
// Cursor-based pagination
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    cursor: string | null;  // For next page
    hasMore: boolean;
    total?: number;         // Optional total count
  };
}

// Usage: GET /agents?cursor=abc123&limit=20
```

---

## 12. Real-Time Communication (SSE)

### 12.1 Streaming Architecture Overview

The platform uses real token-by-token streaming from n8n's Chat Trigger node. The agent's `webhookUrl` (in `AgentSecret`) points to the n8n Chat Trigger URL, which returns chunked HTTP responses with newline-delimited JSON.

```
Frontend ←──SSE──← NestJS Backend ←──chunked HTTP──← n8n Chat Trigger (webhookUrl)
                                      (real token-by-token streaming)
```

**n8n Chat Trigger streaming format** (verified via testing):
```json
{"type":"begin","metadata":{"nodeId":"...","nodeName":"AI Agent1","timestamp":1774234478437}}
{"type":"item","content":"Hello","metadata":{"nodeId":"...","timestamp":1774234478500}}
{"type":"item","content":"!","metadata":{"nodeId":"...","timestamp":1774234478510}}
{"type":"item","content":" I","metadata":{"nodeId":"...","timestamp":1774234478520}}
...
{"type":"end","metadata":{"nodeId":"...","timestamp":1774234480792}}
```

Each chunk is a newline-delimited JSON object. The `begin` and `end` chunks carry timestamps used for metadata extraction (see Section 12.3).

### 12.1.1 SSE Controller (Streaming)

```typescript
// apps/api/src/controllers/public/public-chat.controller.ts
@Post('stream')
@Header('Content-Type', 'text/event-stream')
@Header('Cache-Control', 'no-cache')
@Header('Connection', 'keep-alive')
async streamMessage(
  @Body() dto: SendMessageDto,
  @Res() res: Response,
) {
  const agent = await this.chatService.getAgentByPublicId(dto.agentId);
  const session = await this.chatService.resolveSession(agent.id, dto.deviceId, dto.sessionId);
  const backendReceivedAt = new Date();

  // Save user message before streaming
  const userMessage = await this.chatService.saveMessage({
    sessionId: session.id,
    role: 'USER',
    content: dto.message,
  });

  // Get webhook URL (points to n8n Chat Trigger)
  const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(dto.agentId);

  await this.streamFromN8n(res, webhookUrl, dto, session, backendReceivedAt);
}

private async streamFromN8n(
  res: Response,
  webhookUrl: string,
  dto: SendMessageDto,
  session: ChatSession,
  backendReceivedAt: Date,
) {
  const n8nResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatInput: dto.message,
      sessionId: session.sessionId,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const reader = n8nResponse.body!.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';
  let n8nBeginTimestamp: number | null = null;
  let n8nEndTimestamp: number | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        if (chunk.type === 'begin') {
          n8nBeginTimestamp = chunk.metadata?.timestamp;
        } else if (chunk.type === 'item' && chunk.content) {
          fullResponse += chunk.content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content })}\n\n`);
        } else if (chunk.type === 'end') {
          n8nEndTimestamp = chunk.metadata?.timestamp;
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }

  // Build metadata from stream timestamps
  const backendRespondedAt = new Date();
  const metadata = {
    backendReceivedAt: backendReceivedAt.toISOString(),
    n8nReceivedAt: n8nBeginTimestamp ? new Date(n8nBeginTimestamp).toISOString() : null,
    agentRepliedAt: n8nEndTimestamp ? new Date(n8nEndTimestamp).toISOString() : null,
    backendRespondedAt: backendRespondedAt.toISOString(),
    responseLatencyMs: backendRespondedAt.getTime() - backendReceivedAt.getTime(),
    streamingMode: 'real',
  };

  // Save assistant message after stream completes
  await this.chatService.saveMessage({
    sessionId: session.id,
    role: 'ASSISTANT',
    content: fullResponse,
    metadata,
  });

  res.write(`data: ${JSON.stringify({ type: 'done', sessionId: session.sessionId, metadata })}\n\n`);
  res.end();
}
```

### 12.2 Widget SSE Client

```typescript
// apps/widget/src/services/sse.ts (unchanged — same consumer interface)
export function streamChat(
  baseUrl: string,
  payload: ChatPayload,
  onChunk: (chunk: string) => void,
  onDone: (sessionId: string) => void,
  onError: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${baseUrl}/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': payload.deviceId,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (response) => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'chunk') {
              onChunk(data.content);
            } else if (data.type === 'done') {
              onDone(data.sessionId);
            } else if (data.type === 'error') {
              onError(new Error(data.message));
            }
          }
        }
      }
    })
    .catch(onError);

  return controller;
}
```

> **Note:** The frontend SSE consumer requires no changes — it consumes the same `{type: 'chunk', content}` events.

### 12.3 Metadata Extraction from Streaming Chunks

With real streaming, metadata timestamps are extracted from the n8n Chat Trigger chunk timestamps:

| Field | Source |
|-------|--------|
| `n8nReceivedAt` | `begin` chunk `metadata.timestamp` |
| `agentRepliedAt` | `end` chunk `metadata.timestamp` |
| `backendReceivedAt` | Recorded on request entry |
| `backendRespondedAt` | Recorded after stream ends |
| `responseLatencyMs` | `backendRespondedAt - backendReceivedAt` |
| `timeToFirstToken` | First `item` chunk arrival - request sent time (ms) |
| `totalTokens` | Count of `item` chunks |
| `streamDurationMs` | `end` timestamp - `begin` timestamp (ms) |

### 12.2 Widget SSE Client

```typescript
// apps/widget/src/services/sse.ts
export function streamChat(
  baseUrl: string,
  payload: ChatPayload,
  onChunk: (chunk: string) => void,
  onDone: (sessionId: string) => void,
  onError: (error: Error) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${baseUrl}/chat/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': payload.deviceId,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (response) => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'chunk') {
              onChunk(data.content);
            } else if (data.type === 'done') {
              onDone(data.sessionId);
            } else if (data.type === 'error') {
              onError(new Error(data.message));
            }
          }
        }
      }
    })
    .catch(onError);

  return controller;
}
```

---

## 13. AI Service Abstraction Layer

### 13.1 Provider Interface

```typescript
// apps/api/src/modules/ai/providers/ai-provider.interface.ts
export interface AIProviderConfig {
  webhookUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface AIRequest {
  message: string;
  conversationHistory: ConversationMessage[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AIResponse {
  content: string;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    latencyMs?: number;
    provider?: string;
  };
}

export interface AIStreamChunk {
  content: string;
  isLast: boolean;
}

export interface AIProvider {
  readonly name: string;

  sendMessage(request: AIRequest): Promise<AIResponse>;

  streamMessage(request: AIRequest): AsyncGenerator<AIStreamChunk>;

  validateConfig(config: AIProviderConfig): boolean;
}
```

### 13.2 n8n Provider Implementation

The n8n provider streams tokens from the agent's `webhookUrl`, which points to an n8n Chat Trigger node.

```typescript
// apps/api/src/services/n8n-streaming.service.ts

/**
 * Streams tokens from n8n Chat Trigger URL (the agent's webhookUrl).
 * Consumes chunked HTTP response with newline-delimited JSON.
 * Returns an AsyncGenerator that yields N8nStreamChunk objects.
 */
async *streamFromWebhookUrl(
  webhookUrl: string,
  chatInput: string,
  sessionId: string,
  abortSignal?: AbortSignal,
): AsyncGenerator<N8nStreamChunk> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatInput, action: 'sendMessage', sessionId }),
    signal: abortSignal ?? AbortSignal.timeout(30_000),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Last element may be incomplete

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        yield chunk; // { type: 'begin'|'item'|'end', content?, metadata }
      } catch {
        // Skip malformed chunks (partial JSON across chunk boundaries)
      }
    }
  }

  // Emit begin
  yield { type: 'begin', metadata: { timestamp: Date.now() } };

  // Simulate streaming by splitting on words
  const words = content.split(' ');
  for (let i = 0; i < words.length; i++) {
    yield {
      type: 'item',
      content: words[i] + (i < words.length - 1 ? ' ' : ''),
      metadata: { timestamp: Date.now() },
    };
  }

  // Emit end
  yield { type: 'end', metadata: { timestamp: Date.now() } };
}

interface N8nStreamChunk {
  type: 'begin' | 'item' | 'end';
  content?: string;
  metadata?: { timestamp?: number; nodeId?: string; nodeName?: string };
}
```

**Key design decision:** Both modes emit the same `N8nStreamChunk` format. Consumers don't need to know whether tokens are real or simulated. The `streamingMode` field in saved metadata tracks which path was used for observability.

### 13.3 AI Service (Factory Pattern)

```typescript
// apps/api/src/modules/ai/ai.service.ts
@Injectable()
export class AIService {
  private readonly providers: Map<string, AIProvider>;

  constructor(
    private n8nProvider: N8nProvider,
    private configService: ConfigService,
  ) {
    this.providers = new Map([
      ['n8n', n8nProvider],
      // Future: ['openai', openaiProvider],
    ]);
  }

  async streamResponse(options: {
    agent: Agent;
    message: string;
    history: ConversationMessage[];
  }): Promise<AsyncGenerator<AIStreamChunk>> {
    const providerName = this.getProviderForAgent(options.agent);
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unknown AI provider: ${providerName}`);
    }

    return provider.streamMessage({
      message: options.message,
      conversationHistory: options.history,
      systemPrompt: options.agent.systemPrompt,
    });
  }

  private getProviderForAgent(agent: Agent): string {
    // Default to n8n, but allow per-agent override
    return agent.aiProvider || 'n8n';
  }
}
```

---

## 14. Analytics Architecture

### 14.1 KPI Definitions (14 Core Metrics)

```typescript
// packages/validation/src/schemas/analytics.schema.ts
export const analyticsOverviewSchema = z.object({
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),

  // User Metrics
  totalUsers: z.number(),
  newUsers: z.number(),
  returningUsers: z.number(),
  userRetentionRate: z.number(), // % returning within 60 days
  userGrowthRate: z.number(),    // % change in new users

  // Conversation Metrics
  totalConversations: z.number(),
  averageMessagesPerConversation: z.number(),

  // Message Metrics
  totalMessagesSent: z.number(),     // User messages
  totalMessagesReceived: z.number(), // Bot messages
  messageVolumeTrends: z.array(z.object({
    date: z.date(),
    count: z.number(),
  })),

  // Quality Metrics
  averageResponseTimeMs: z.number(),
  p95ResponseTimeMs: z.number(),
  fallbackRate: z.number(),          // % fallback responses
  unresolvedQueryRate: z.number(),   // % unhandled queries

  // Language Metrics
  languageDistribution: z.record(z.number()), // { en: 67, hi: 28, ... }

  // Topic Metrics
  topTopics: z.array(z.object({
    topic: z.string(),
    count: z.number(),
    percentage: z.number(),
  })),
});
```

### 14.2 Hybrid Processing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Analytics Data Flow                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Raw Events                                                     │
│  - ChatMessage, UsageEvent tables                               │
│  - Real-time writes from chat/widget services                   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   │                   ▼
┌──────────────────┐          │          ┌──────────────────┐
│ REAL-TIME PATH   │          │          │ BATCH PATH       │
│ (last 7 days)    │          │          │ (7+ days old)    │
│                  │          │          │                  │
│ - Direct queries │          │          │ - BullMQ jobs    │
│ - Count/Sum agg. │          │          │ - Nightly runs   │
│ - ~100ms latency │          │          │ - Materialized   │
└──────────────────┘          │          └──────────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  AnalyticsAggregation Table                                     │
│  - Daily, Weekly, Monthly pre-computed metrics                  │
│  - Fast dashboard queries                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Analytics API                                                  │
│  - Merges real-time + aggregated data                           │
│  - Returns unified response                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 14.3 BullMQ Job Processors

```typescript
// apps/api/src/modules/analytics/processors/daily-aggregation.processor.ts
@Processor('analytics')
export class DailyAggregationProcessor {
  constructor(
    private prisma: PrismaService,
    private analyticsService: AnalyticsService,
  ) {}

  @Process('aggregate-daily')
  async handleDailyAggregation(job: Job<{ date: string; orgId: string }>) {
    const { date, orgId } = job.data;
    const startOfDay = new Date(date);
    const endOfDay = addDays(startOfDay, 1);

    // Calculate all metrics for this day
    const metrics = await this.analyticsService.calculateMetrics({
      organizationId: orgId,
      startDate: startOfDay,
      endDate: endOfDay,
    });

    // Store aggregation
    await this.prisma.analyticsAggregation.upsert({
      where: {
        agentId_period_periodStart: {
          agentId: 'ALL', // org-level
          period: 'daily',
          periodStart: startOfDay,
        },
      },
      update: { metrics },
      create: {
        organizationId: orgId,
        agentId: 'ALL',
        period: 'daily',
        periodStart: startOfDay,
        periodEnd: endOfDay,
        metrics,
      },
    });
  }
}
```

---

## 15. Infrastructure & DevOps

### 15.1 Docker Configuration

```dockerfile
# docker/api.Dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/validation/package.json ./packages/validation/
COPY packages/theme/package.json ./packages/theme/
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm && pnpm run build --filter=@codeweaves/api

# Production image
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./

USER nestjs

EXPOSE 3001
ENV PORT=3001

CMD ["node", "dist/main.js"]
```

### 15.2 GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm check-types

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: codeweaves_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test --filter=@codeweaves/api
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/codeweaves_test

  build:
    runs-on: ubuntu-latest
    needs: [lint, type-check, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
```

### 15.3 Environment Variables

```bash
# .env.example

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/codeweaves"

# Auth0
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_AUDIENCE="https://api.codeweaves.io"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"

# Supabase
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_KEY="your-service-key"
SUPABASE_ANON_KEY="your-anon-key"

# Redis
REDIS_URL="redis://localhost:6379"

# Sentry
SENTRY_DSN="https://xxx@sentry.io/xxx"

# n8n (Default AI Provider)
N8N_WEBHOOK_URL="https://your-n8n.com/webhook/xxx"

# App
NODE_ENV="development"
API_PORT=3001
CORS_ORIGINS="http://localhost:3000"
```

---

## 16. Security Architecture

### 16.1 Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Architecture                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Network Security                                       │
│ - HTTPS/TLS 1.3 for all traffic                                │
│ - CDN with DDoS protection                                     │
│ - WAF rules for common attacks                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: Authentication                                         │
│ - Auth0 JWT verification                                       │
│ - Token expiration (7 days access, refresh tokens)             │
│ - MFA support via Auth0                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: Authorization                                          │
│ - RBAC at API layer                                            │
│ - Tenant isolation (organization-based filtering)              │
│ - Resource-level permissions                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4: Input Validation                                       │
│ - Zod schema validation                                        │
│ - SQL injection prevention (Prisma parameterized queries)      │
│ - XSS prevention (HTML sanitization)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 5: Rate Limiting                                          │
│ - Per-organization limits                                      │
│ - Per-IP limits for public endpoints                           │
│ - Sliding window algorithm                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 6: Data Protection                                        │
│ - Encryption at rest (Supabase)                                │
│ - Secret encryption for webhooks/API keys                      │
│ - Audit logging for all mutations                              │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 CORS Configuration

```typescript
// apps/api/src/main.ts
app.enableCors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = configService.get('CORS_ORIGINS').split(',');

    if (allowedOrigins.includes(origin) || origin.endsWith('.codeweaves.io')) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Request-ID'],
});
```

### 16.3 Widget Domain Validation

```typescript
// apps/api/src/modules/widget/widget.service.ts
validateOrigin(origin: string, allowedDomains: string[]): boolean {
  const originHost = new URL(origin).hostname;

  return allowedDomains.some(pattern => {
    if (pattern.startsWith('*.')) {
      // Wildcard match: *.example.com matches sub.example.com
      const baseDomain = pattern.slice(2);
      return originHost === baseDomain || originHost.endsWith('.' + baseDomain);
    }
    return originHost === pattern;
  });
}
```

---

## 17. Observability & Monitoring

### 17.1 Sentry Integration

```typescript
// apps/api/src/config/sentry.config.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.npm_package_version,

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Error filtering
  beforeSend(event) {
    // Don't send expected errors
    if (event.exception?.values?.[0]?.type === 'NotFoundException') {
      return null;
    }
    return event;
  },

  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Prisma({ client: prisma }),
  ],
});
```

### 17.2 Logging Strategy

```typescript
// apps/api/src/common/interceptors/logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user } = request;
    const requestId = request.headers['x-request-id'] || uuid();

    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          this.logger.log({
            requestId,
            method,
            url,
            statusCode: response.statusCode,
            duration: Date.now() - now,
            userId: user?.id,
            orgId: user?.organizationId,
          });
        },
        error: (error) => {
          this.logger.error({
            requestId,
            method,
            url,
            error: error.message,
            stack: error.stack,
            duration: Date.now() - now,
            userId: user?.id,
            orgId: user?.organizationId,
          });
        },
      }),
    );
  }
}
```

### 17.3 Health Checks

```typescript
// apps/api/src/modules/health/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: PrismaHealthIndicator,
    private redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.checkHealth('redis'),
    ]);
  }

  @Get('live')
  liveness() {
    return { status: 'ok' };
  }
}
```

---

## 18. Performance Requirements

### 18.1 Performance Budgets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Dashboard FCP | < 1s | > 1.5s |
| Dashboard TTI | < 1.5s | > 2s |
| Widget Load | < 200ms | > 300ms |
| API P95 | < 100ms | > 150ms |
| AI Response P95 | < 1.5s | > 2s |
| DB Query P95 | < 50ms | > 100ms |
| Voice STT | < 2s | > 3s |
| Voice TTS (per sentence) | < 500ms | > 750ms |
| Voice TTFA (time to first audio) | < 4s | > 6s |
| Text TTFT (time to first token) | < 800ms | > 1.5s |

### 18.2 Caching Strategy

```typescript
// Caching layers
const CACHE_CONFIG = {
  // Widget config (rarely changes)
  widgetConfig: {
    ttl: 300, // 5 minutes
    staleWhileRevalidate: 60,
  },

  // User session
  session: {
    ttl: 3600, // 1 hour
  },

  // Analytics aggregations
  analyticsDaily: {
    ttl: 86400, // 24 hours (immutable after creation)
  },

  // Real-time analytics
  analyticsRealtime: {
    ttl: 60, // 1 minute
  },

  // Theme
  theme: {
    ttl: 300, // 5 minutes
    version: true, // Cache bust on version change
  },
};
```

### 18.3 Database Indexing Strategy

```prisma
// Critical indexes for performance
@@index([publicId])                    // Widget config lookup
@@index([organizationId])              // Tenant filtering
@@index([agentId, startedAt])          // Session queries
@@index([agentId, eventType, createdAt]) // Analytics queries
@@index([createdAt])                   // Time-series queries
```

---

## 19. Testing Strategy

### 19.1 Test Types

| Type | Tool | Coverage Target | Scope |
|------|------|-----------------|-------|
| Unit | Jest | > 80% | Services, utilities |
| Integration | Jest + Supertest | Critical paths | API endpoints |
| E2E | (Future) Playwright | Happy paths | Full user flows |

### 19.2 Unit Test Example

```typescript
// apps/api/src/modules/agents/agents.service.spec.ts
describe('AgentsService', () => {
  let service: AgentsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
      ],
    }).compile();

    service = module.get(AgentsService);
    prisma = module.get(PrismaService);
  });

  describe('findAll', () => {
    it('should filter by organization for CLIENT role', async () => {
      const user = { role: Role.CLIENT, organizationId: 'org-1' };

      prisma.agent.findMany.mockResolvedValue([]);

      await service.findAll(user);

      expect(prisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
          }),
        }),
      );
    });

    it('should not filter by organization for SUPER_ADMIN role', async () => {
      const user = { role: Role.SUPER_ADMIN };

      prisma.agent.findMany.mockResolvedValue([]);

      await service.findAll(user);

      expect(prisma.agent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            organizationId: expect.anything(),
          }),
        }),
      );
    });
  });
});
```

### 19.3 Test Configuration

```typescript
// apps/api/jest.config.ts
export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.service.ts',
    '**/*.controller.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: '../coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@codeweaves/validation$': '<rootDir>/../../packages/validation/src',
  },
};
```

---

## 20. Voice Architecture

### 20.1 Voice Flow Overview

Voice is a **transport-layer concern**, not an AI concern. It wraps the existing text chat flow with STT (pre-processing) and TTS (post-processing). The AI/orchestration layer (n8n or future replacement) always receives text and returns text — it never knows voice is involved.

#### 20.1.1 Current Voice Flow (HTTP — Sequential)

The current voice flow (implemented in Epic 10) is sequential — full AI response must be received before TTS begins:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VOICE FLOW (Current - Sequential HTTP)                                     │
│                                                                             │
│  Widget                    NestJS Backend                   External        │
│  ┌──────────┐    audio    ┌──────────────┐                                  │
│  │ Mic      │───────────→│ Voice        │    audio    ┌─────────────────┐  │
│  │ Capture  │            │ Controller   │───────────→│ STT Provider    │  │
│  └──────────┘            │              │←───────────│ (Sarvam/DG/etc) │  │
│                          │              │    text     └─────────────────┘  │
│                          │              │                                   │
│                          │              │    text     ┌─────────────────┐  │
│                          │              │───────────→│ n8n Chat Trigger│  │
│                          │              │←───────────│ (full response) │  │
│                          │              │    text     └─────────────────┘  │
│                          │              │                                   │
│  ┌──────────┐    audio   │              │    text     ┌─────────────────┐  │
│  │ Audio    │←───────────│              │───────────→│ TTS Provider    │  │
│  │ Playback │            │              │←───────────│ (Sarvam/11L/etc)│  │
│  └──────────┘            └──────────────┘    audio    └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Latency (measured):** ~9-12 seconds total (STT ~2s + AI ~4s + TTS ~3s). Full AI response must be received before TTS begins.

#### 20.1.2 Streaming Voice Flow (Progressive TTS — Epic 13)

The streaming pipeline uses the same `webhookUrl` (n8n Chat Trigger) but reads the response as a chunked stream, enabling progressive TTS — audio starts playing while the AI is still generating tokens:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  VOICE FLOW (Streaming - Progressive TTS)                                        │
│                                                                                  │
│  Widget              NestJS Backend                    External                  │
│  ┌──────────┐ audio ┌───────────────┐                                            │
│  │ Mic      │──────→│ Voice         │  audio    ┌──────────────────┐             │
│  │ Capture  │       │ Controller    │─────────→│ STT Provider     │             │
│  └──────────┘       │               │←─────────│ (HTTP — batched) │             │
│                     │               │  text     └──────────────────┘             │
│                     │               │                                            │
│                     │               │  POST     ┌──────────────────┐             │
│                     │               │─────────→│ n8n Chat Trigger │             │
│                     │               │           │                  │             │
│                     │               │  ←─ ─ ─ ─│ token stream     │             │
│                     │               │  chunk 1  │ (chunked HTTP)   │             │
│                     │               │  ←─ ─ ─ ─│                  │             │
│                     │               │  chunk 2  └──────────────────┘             │
│                     │               │  ←─ ─ ─ ─                                  │
│                     │               │  ... (tokens accumulate in sentence buffer) │
│                     │               │                                            │
│                     │  ┌────────────────────────────┐                            │
│                     │  │ Sentence Buffer             │                            │
│                     │  │ "Hello, how can I help you?" │ ← sentence boundary hit  │
│                     │  └─────────────┬──────────────┘                            │
│                     │                │ text                                       │
│                     │                ▼            ┌──────────────────┐            │
│                     │  TTS Request (sentence 1) →│ TTS Provider     │            │
│  ┌──────────┐ audio │               ←────────────│ (HTTP)           │            │
│  │ Audio    │←──────│                             └──────────────────┘            │
│  │ Playback │       │  ... meanwhile tokens keep streaming from n8n ...          │
│  │ (sent 1) │       │                                                            │
│  │          │       │  Sentence 2 ready → TTS → audio → playback queued          │
│  │ (sent 2) │←──────│                                                            │
│  └──────────┘       └───────────────┘                                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Target latency:** ~4-5 seconds to first audio (STT ~2s + AI first sentence ~1-2s + TTS first sentence ~0.5s). Remaining sentences play progressively as they arrive.

**Key constraint:** n8n **input** does not support streaming (request body is buffered). The full STT transcription must complete before the n8n request is sent. However, the n8n Chat Trigger **output** streams tokens in real-time (verified: 47 chunks, 701ms TTFB, ~54ms between tokens).

### 20.2 Voice Provider Adapter Pattern

```typescript
// apps/api/src/modules/voice/providers/voice-provider.interface.ts

export interface STTRequest {
  audio: Buffer;                    // Raw audio data
  format: 'webm' | 'wav' | 'mp3';  // Audio format from browser
  language?: string;                // Hint language (optional, auto-detect if omitted)
  agentId: string;                  // For per-agent config lookup
}

export interface STTResponse {
  text: string;                     // Transcribed text
  detectedLanguage: string;         // e.g., 'hi', 'en', 'hinglish'
  confidence: number;               // 0-1 confidence score
  latencyMs: number;                // Processing time
  provider: string;                 // Which provider was used
}

export interface TTSRequest {
  text: string;                     // Text to synthesize
  language: string;                 // Target language
  voiceId?: string;                 // Specific voice (provider-dependent)
  speed?: number;                   // Playback speed multiplier (0.5-2.0)
  agentId: string;                  // For per-agent config lookup
}

export interface TTSResponse {
  audio: Buffer;                    // Synthesized audio
  format: 'mp3' | 'wav' | 'opus';  // Output audio format
  durationMs: number;               // Audio duration
  latencyMs: number;                // Processing time
  provider: string;                 // Which provider was used
}

export interface VoiceProvider {
  readonly name: string;
  readonly supportedLanguages: string[];

  transcribe(request: STTRequest): Promise<STTResponse>;
  synthesize(request: TTSRequest): Promise<TTSResponse>;
  detectLanguage(audio: Buffer): Promise<{ language: string; confidence: number }>;
}
```

### 20.3 Provider Implementations

```typescript
// apps/api/src/modules/voice/providers/sarvam.provider.ts
@Injectable()
export class SarvamProvider implements VoiceProvider {
  readonly name = 'sarvam';
  readonly supportedLanguages = [
    'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml',
    'pa', 'or', 'en', 'hinglish',
  ];

  async transcribe(request: STTRequest): Promise<STTResponse> {
    // Sarvam Saarika v2 API - native Hinglish/code-switching support
    // POST https://api.sarvam.ai/speech-to-text
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    // Sarvam Bulbul v3 API - 35+ Indian voices
    // POST https://api.sarvam.ai/text-to-speech
  }
}

// apps/api/src/modules/voice/providers/deepgram.provider.ts
@Injectable()
export class DeepgramProvider implements VoiceProvider {
  readonly name = 'deepgram';
  readonly supportedLanguages = ['en', 'hi', 'mr', 'ta', 'te', 'bn', 'gu', 'kn'];

  async transcribe(request: STTRequest): Promise<STTResponse> {
    // Deepgram Nova-3 API - low latency, strong English
    // POST https://api.deepgram.com/v1/listen
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    // Deepgram Aura - English only TTS
    // Note: Falls back to another provider for non-English TTS
  }
}

// apps/api/src/modules/voice/providers/elevenlabs.provider.ts
@Injectable()
export class ElevenLabsProvider implements VoiceProvider {
  readonly name = 'elevenlabs';
  // Verified via real API testing (2026-03-23): eleven_multilingual_v2
  // supports Hindi and Tamil for Indian languages, NOT Marathi/Bengali/etc.
  readonly supportedLanguages = ['en', 'hi', 'ta'];

  async transcribe(request: STTRequest): Promise<STTResponse> {
    // ElevenLabs Scribe v2 - 90+ languages
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    // ElevenLabs Multilingual v2 - premium voice quality
    // Higher latency (~0.9s) but most natural sounding
  }
}
```

### 20.4 Voice Service (Router + Orchestrator)

```typescript
// apps/api/src/modules/voice/voice.service.ts
@Injectable()
export class VoiceService {
  private readonly sttProviders: Map<string, VoiceProvider>;
  private readonly ttsProviders: Map<string, VoiceProvider>;

  constructor(
    private sarvamProvider: SarvamProvider,
    private deepgramProvider: DeepgramProvider,
    private elevenLabsProvider: ElevenLabsProvider,
    private agentService: AgentsService,
  ) {
    this.sttProviders = new Map([
      ['sarvam', sarvamProvider],
      ['deepgram', deepgramProvider],
      ['elevenlabs', elevenLabsProvider],
    ]);
    this.ttsProviders = new Map([
      ['sarvam', sarvamProvider],
      ['elevenlabs', elevenLabsProvider],
    ]);
  }

  async transcribe(request: STTRequest): Promise<STTResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    const provider = this.resolveSTTProvider(config, request.language);
    return provider.transcribe(request);
  }

  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const config = await this.getVoiceConfig(request.agentId);
    const provider = this.resolveTTSProvider(config, request.language);
    return provider.synthesize(request);
  }

  /**
   * Language-based routing logic:
   * - Indian languages / Hinglish → Sarvam AI (best code-switching)
   * - English-dominant → agent's configured default (Deepgram/ElevenLabs)
   * - Override: agent config can force a specific provider
   */
  private resolveSTTProvider(config: VoiceConfig, language?: string): VoiceProvider {
    // If agent has a forced provider, use it
    if (config.sttProvider) {
      return this.sttProviders.get(config.sttProvider)!;
    }

    // Auto-route based on detected/hinted language
    const indianLanguages = ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish'];
    if (language && indianLanguages.includes(language)) {
      return this.sttProviders.get('sarvam')!;
    }

    // Default to deepgram for English
    return this.sttProviders.get('deepgram')!;
  }

  private resolveTTSProvider(config: VoiceConfig, language: string): VoiceProvider {
    if (config.ttsProvider) {
      return this.ttsProviders.get(config.ttsProvider)!;
    }

    const indianLanguages = ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'hinglish'];
    if (indianLanguages.includes(language)) {
      return this.ttsProviders.get('sarvam')!;
    }

    return this.ttsProviders.get('elevenlabs')!;
  }
}
```

### 20.5 Voice Controller

```typescript
// apps/api/src/modules/voice/voice.controller.ts
@Controller('voice')
export class VoiceController {
  constructor(
    private voiceService: VoiceService,
    private chatService: ChatService,
    private aiService: AIService,
  ) {}

  /**
   * Full voice conversation endpoint:
   * 1. Receive audio from widget
   * 2. STT → transcribe to text
   * 3. Send text through existing chat flow (n8n)
   * 4. TTS → synthesize response to audio
   * 5. Return audio to widget
   */
  @Post('conversation')
  @UseInterceptors(FileInterceptor('audio'))
  async voiceConversation(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body() dto: VoiceConversationDto,
  ) {
    const { agentId, deviceId, sessionId, languageHint } = dto;

    // Step 1: STT - Transcribe audio to text
    const sttResult = await this.voiceService.transcribe({
      audio: audioFile.buffer,
      format: audioFile.mimetype.split('/')[1] as 'webm' | 'wav' | 'mp3',
      language: languageHint,
      agentId,
    });

    // Step 2: Send transcribed text through existing chat flow
    const aiResponse = await this.chatService.processMessage({
      agentId,
      deviceId,
      sessionId,
      message: sttResult.text,
    });

    // Step 3: TTS - Synthesize AI response to audio
    const ttsResult = await this.voiceService.synthesize({
      text: aiResponse.content,
      language: sttResult.detectedLanguage,
      agentId,
    });

    // Step 4: Return both text and audio
    return {
      transcription: {
        text: sttResult.text,
        language: sttResult.detectedLanguage,
        confidence: sttResult.confidence,
      },
      response: {
        text: aiResponse.content,
        audio: ttsResult.audio.toString('base64'),
        audioFormat: ttsResult.format,
        audioDurationMs: ttsResult.durationMs,
      },
      metrics: {
        sttLatencyMs: sttResult.latencyMs,
        aiLatencyMs: aiResponse.metadata?.latencyMs,
        ttsLatencyMs: ttsResult.latencyMs,
        totalLatencyMs: sttResult.latencyMs + (aiResponse.metadata?.latencyMs || 0) + ttsResult.latencyMs,
      },
    };
  }

  @Post('transcribe')
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(
    @UploadedFile() audioFile: Express.Multer.File,
    @Body() dto: TranscribeDto,
  ) {
    return this.voiceService.transcribe({
      audio: audioFile.buffer,
      format: audioFile.mimetype.split('/')[1] as 'webm' | 'wav' | 'mp3',
      language: dto.languageHint,
      agentId: dto.agentId,
    });
  }

  @Post('synthesize')
  async synthesize(@Body() dto: SynthesizeDto) {
    return this.voiceService.synthesize({
      text: dto.text,
      language: dto.language,
      voiceId: dto.voiceId,
      agentId: dto.agentId,
    });
  }
}
```

### 20.6 Voice Configuration Schema

```typescript
// packages/validation/src/schemas/voice.schema.ts
import { z } from 'zod';

export const voiceProviderEnum = z.enum(['sarvam', 'deepgram', 'elevenlabs']);

export const voiceConfigSchema = z.object({
  enabled: z.boolean().default(false),
  sttEnabled: z.boolean().default(true),         // Allow voice input
  ttsEnabled: z.boolean().default(true),          // Allow voice output
  sttProvider: voiceProviderEnum.optional(),       // Override auto-routing
  ttsProvider: voiceProviderEnum.optional(),       // Override auto-routing
  defaultLanguage: z.string().default('en'),       // Default language hint
  supportedLanguages: z.array(z.string()).default(['en']),
  ttsVoiceId: z.string().optional(),              // Specific voice for TTS
  ttsSpeed: z.number().min(0.5).max(2.0).default(1.0),
  autoDetectLanguage: z.boolean().default(true),  // Auto-detect from audio
});

export type VoiceConfig = z.infer<typeof voiceConfigSchema>;
```

### 20.7 Database Schema Additions

```prisma
// Addition to Agent model in schema.prisma

model Agent {
  // ... existing fields ...
  voiceEnabled       Boolean      @default(false)

  // Voice configuration (JSON column)
  voiceConfig        Json?        @db.JsonB
  // Stores VoiceConfig schema:
  // {
  //   sttEnabled: true,
  //   ttsEnabled: true,
  //   sttProvider: "sarvam",        // optional override
  //   ttsProvider: null,            // auto-route
  //   defaultLanguage: "hi",
  //   supportedLanguages: ["en", "hi", "mr", "hinglish"],
  //   ttsVoiceId: null,
  //   ttsSpeed: 1.0,
  //   autoDetectLanguage: true,
  // }
}
```

### 20.8 Widget Voice UI Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Widget Voice States                                         │
│                                                              │
│  ┌──────────┐     click mic    ┌──────────────┐             │
│  │  TEXT     │───────────────→│  LISTENING    │             │
│  │  MODE     │                │  (recording)  │             │
│  │          │     click mic    │               │             │
│  │  [input] │←───────────────│  🎙️ waveform  │             │
│  │  [🎤]    │                │  [⏹️ stop]     │             │
│  └──────────┘                └───────┬────────┘             │
│                                       │ stop / silence       │
│                                       ▼                      │
│                              ┌──────────────┐               │
│                              │  PROCESSING  │               │
│                              │  (STT+AI+TTS)│               │
│                              │  ⏳ spinner   │               │
│                              └───────┬───────┘               │
│                                       │ response ready       │
│                                       ▼                      │
│                              ┌──────────────┐               │
│                              │  PLAYING     │               │
│                              │  (TTS audio) │               │
│                              │  🔊 waveform │               │
│                              │  [⏹️ stop]   │               │
│                              └───────┬───────┘               │
│                                       │ audio ends           │
│                                       ▼                      │
│                              ┌──────────────┐               │
│                              │  TEXT MODE   │               │
│                              │  (ready)     │               │
│                              └──────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

**Key Widget Voice Behaviors:**
- When mic is active (LISTENING state): text input is **disabled**, send button is hidden
- When audio is playing (PLAYING state): text input is **disabled**, user can stop playback
- Transcribed text appears in chat as a user message (same as typed text)
- AI response appears as both text message and audio playback
- Voice button only visible when `voiceConfig.sttEnabled` is true in widget config
- Audio playback only occurs when `voiceConfig.ttsEnabled` is true

```typescript
// apps/widget/src/hooks/useVoice.ts
import { useState, useRef } from 'preact/hooks';

type VoiceState = 'idle' | 'listening' | 'processing' | 'playing';

export function useVoice(config: WidgetConfig) {
  const [state, setState] = useState<VoiceState>('idle');
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioPlayer = useRef<HTMLAudioElement | null>(null);

  const startListening = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      setState('processing');
      stream.getTracks().forEach(t => t.stop());

      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob);
      formData.append('agentId', config.publicId);
      formData.append('deviceId', config.deviceId);
      formData.append('sessionId', config.sessionId);

      // Call voice conversation endpoint
      const response = await fetch(`${config.apiUrl}/voice/conversation`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      // Play TTS audio if enabled
      if (config.voiceConfig.ttsEnabled && result.response.audio) {
        setState('playing');
        const audioBlob = base64ToBlob(result.response.audio, result.response.audioFormat);
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioPlayer.current = audio;
        audio.onended = () => {
          setState('idle');
          URL.revokeObjectURL(audioUrl);
        };
        audio.play();
      } else {
        setState('idle');
      }

      return result;
    };

    mediaRecorder.current = recorder;
    recorder.start();
    setState('listening');
  };

  const stopListening = () => {
    mediaRecorder.current?.stop();
  };

  const stopPlaying = () => {
    audioPlayer.current?.pause();
    setState('idle');
  };

  return { state, startListening, stopListening, stopPlaying };
}
```

### 20.9 Voice Provider Comparison & Routing (Verified 2026-03-23)

| Provider | STT Languages | TTS Languages | Hinglish | Latency | Cost | Best For |
|----------|--------------|---------------|----------|---------|------|----------|
| **Sarvam AI** | 22 Indian + English (Saarika v2.5) | 11 Indian + English (Bulbul v3, speaker: `priya`) | Excellent (native) | Fast (~0.4s TTS) | ~₹30/hr STT, ₹15/10K chars TTS | Indian languages, Hinglish, auto-detect |
| **Deepgram** | Hindi, Marathi + 45 (Nova-3) | **STT only — no TTS** | Good STT only | Very fast (<300ms) | ~₹38/hr STT | English-dominant STT |
| **ElevenLabs** | 90+ languages (Scribe v2) | en, hi, ta only (eleven_multilingual_v2) — **NOT** mr/bn/gu/ml/te | Good | Moderate (~0.9s) | ~₹250/10K chars TTS | Premium English/Hindi voice quality |

> **Note:** ElevenLabs TTS language support was verified via real API testing. The `eleven_multilingual_v2` model does NOT support Marathi (`mr`), Bengali (`bn`), Gujarati (`gu`), Malayalam (`ml`), or Telugu (`te`) despite documentation claims. Only English, Hindi, and Tamil are confirmed working for Indian languages.

> **Note:** Sarvam TTS Bulbul v3 requires specific speakers. Speaker `priya` is confirmed compatible. Speaker `anushka` exists in older models but is NOT compatible with Bulbul v3.

**Deferred provider:**
| Provider | Details |
|----------|---------|
| **Bhashini** | Free govt API, all 22 scheduled Indian languages. Complex integration (pipeline discovery step). Add when free-tier fallback needed. |

**Default routing logic:**
```
Audio in → detect language hint from agent config
  ├── Indian language / Hinglish → Sarvam AI (STT + TTS)
  ├── English-dominant → Deepgram (STT) + ElevenLabs (TTS)
  └── Agent override → forced provider from voiceConfig
```

### 20.10 Voice API Endpoints (Updated)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ VOICE                                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ POST   /voice/conversation     Full voice flow (STT → AI → TTS)            │
│ POST   /voice/transcribe       Speech-to-text only                          │
│ POST   /voice/synthesize       Text-to-speech only                          │
│ POST   /voice/detect-language  Detect language from audio                   │
│ GET    /voice/providers        List available providers + supported langs    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 20.11 Dashboard Voice Configuration UI

The dashboard agent settings page includes a Voice Configuration section:

- **Enable/Disable Voice** — master toggle (`voiceEnabled`)
- **Voice Input (STT)** — toggle independently
- **Voice Output (TTS)** — toggle independently
- **Default Language** — dropdown (en, hi, mr, hinglish, etc.)
- **Supported Languages** — multi-select
- **Auto-detect Language** — toggle
- **STT Provider** — dropdown (Auto / Sarvam / Deepgram / ElevenLabs)
- **TTS Provider** — dropdown (Auto / Sarvam / ElevenLabs)
- **TTS Voice** — dropdown (provider-dependent voice options)
- **TTS Speed** — slider (0.5x - 2.0x)

### 20.12 Phase 2: OpenAI Realtime API (Future)

> **Status:** Designed, not yet implemented. Deferred until AI orchestration layer replacement.

The Realtime API is a speech-to-speech model — audio in, audio out, with OpenAI's model doing the thinking. It **bypasses** the modular STT → n8n → TTS pipeline entirely.

**Why it's deferred:**
- Requires context injection (RAG, KB, conversation history) that currently lives in n8n
- n8n cannot participate in a Realtime API session
- When the AI orchestration layer is replaced with a custom/OSS solution, that layer can manage Realtime API sessions

**Future architecture:**
```
Widget → audio → NestJS backend → proxy → AI Orchestration Service
                                            ├── Gathers context (RAG, KB, history)
                                            ├── Opens OpenAI Realtime API session
                                            ├── Stuffs context into system prompt
                                            ├── Proxies audio ↔ Realtime API
                                            └── Handles function calls from Realtime API
```

**Interface placeholder:**
```typescript
// Future: apps/api/src/modules/voice/providers/realtime-proxy.interface.ts
export interface RealtimeSessionConfig {
  agentId: string;
  systemPrompt: string;
  conversationContext: string[];  // Injected from RAG/KB
  model: 'gpt-4o-realtime';
}

export interface RealtimeProxy {
  openSession(config: RealtimeSessionConfig): Promise<WebSocket>;
  injectContext(sessionId: string, context: string[]): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
}
```

**Key constraints for Phase 2:**
- Locked to OpenAI models only
- Context is "best effort" via system prompt + function calling
- Cannot use custom agent logic mid-conversation
- Premium feature — higher cost, lower latency, more natural voice

### 20.13 Future: AI Orchestration Layer Replacement

> **Status:** Designed, not yet implemented. Evaluating options.

Currently, n8n handles all AI orchestration (LLM routing, conversation memory, agent logic) via webhooks. ~~n8n does not support streaming responses~~ **Update (2026-03-23):** n8n Chat Trigger **does** support real token-by-token streaming (see ADR-013). The streaming pipeline is now documented in Section 12.1 and Section 20.1.2. The remaining limitations of n8n are: (1) no streaming **input** (request body buffered), (2) no RAG/knowledge base, (3) no multi-LLM routing.

**Planned replacement:** A dedicated AI orchestration codebase that handles:
- RAG pipeline (document ingestion, chunking, embedding, retrieval)
- Knowledge base management per client/agent
- Multi-LLM routing (OpenAI, Claude, Gemini, etc.)
- Agent/tool-use capabilities
- Conversation history and memory management
- Streaming responses (enables TTS to start as tokens arrive)
- OpenAI Realtime API session management (Phase 2 voice)

**Options evaluated (as of 2026-03-14):**

| Option | License | Fit | Trade-off |
|--------|---------|-----|-----------|
| **Dify** (111k+ GitHub stars) | Apache 2.0 + commercial for multi-tenant SaaS | Best out-of-box: RAG, KB, agents, memory, voice plugins, API-first | Requires commercial license for multi-tenant SaaS. Heavy infra (~18GB RAM). |
| **Langflow** (140k+ stars) | MIT (fully permissive) | Good: RAG, API endpoints, TypeScript client | No built-in multi-tenant, conversation memory is manual. More DIY. |
| **Flowise** (42k stars) | Apache 2.0 | TypeScript/Node.js — natural fit for NestJS stack | Acquired by Workday (2025), uncertain OSS future. |
| **Custom build** (LangChain/LlamaIndex) | MIT | Full control, minimal hosting cost (~₹2.5-4K/month) | Most development effort. Build everything yourself. |

**Decision:** Deferred. n8n works for current scale (streaming now enabled via Chat Trigger). Evaluate when:
1. ~~Streaming responses become a hard requirement~~ **Resolved** — n8n Chat Trigger streams tokens (ADR-013)
2. RAG/knowledge base features are needed
3. n8n hits a specific scalability or feature wall
4. Multi-LLM routing or custom agent logic beyond n8n's capabilities is needed

**Architecture impact:** When this codebase is built/adopted:
- This platform (codeweaves-platform) remains dashboard-only: widget config, billing, analytics
- AI orchestration service handles: RAG, agents, LLM routing, conversation memory
- Voice Gateway (future): WebRTC transport, STT/TTS if moved out of this platform
- The integration point stays the same: webhook URL per agent, text in → text out

```
Current:   Widget → NestJS backend → n8n webhook → AI response
Streaming: Widget → NestJS backend → n8n Chat Trigger → AI response (streamed, token-by-token)
Future:    Widget → NestJS backend → AI Orchestration Service → AI response (streamed)
           Widget → NestJS backend → AI Orchestration Service → OpenAI Realtime (Phase 2)
```

### 20.14 Streaming Voice Pipeline Architecture

> **Status:** Designed, pending implementation. See ADR-013 for decision record.

The streaming voice pipeline overlaps the AI response generation with TTS synthesis, eliminating the sequential bottleneck. This section documents the voice-specific streaming flow — for text chat streaming, see Section 12.1.

#### 20.14.1 Pipeline Stages

```
Stage 1: STT (batched — not streaming)
  ┌──────────────────────────────────────────────────────┐
  │ User finishes speaking → full audio blob sent to     │
  │ backend → STT provider transcribes → text returned   │
  │ Latency: ~1.5-2s (Sarvam) / ~0.3s (Deepgram)       │
  └──────────────────────────────────────────────────────┘
                              │ text
                              ▼
Stage 2: AI Generation (streaming from n8n Chat Trigger)
  ┌──────────────────────────────────────────────────────┐
  │ POST to n8n Chat Trigger with chatInput=text         │
  │ Response: chunked HTTP with token-by-token streaming │
  │ Format per chunk:                                    │
  │   {"type":"begin"}                                   │
  │   {"type":"item","content":"Hello"}                  │
  │   {"type":"item","content":" how"}                   │
  │   {"type":"item","content":" can"}                   │
  │   ...                                                │
  │   {"type":"end"}                                     │
  │ Latency to first token: ~700ms                       │
  └──────────────────────────────────────────────────────┘
                              │ tokens stream into sentence buffer
                              ▼
Stage 3: Sentence Buffering (overlapped with Stage 2)
  ┌──────────────────────────────────────────────────────┐
  │ Tokens accumulate until sentence boundary detected   │
  │ Boundaries: . ! ? newline (see 20.15 for rules)     │
  │ Each complete sentence triggers a TTS request        │
  └──────────────────────────────────────────────────────┘
                              │ sentence text
                              ▼
Stage 4: TTS (progressive — overlapped with Stages 2+3)
  ┌──────────────────────────────────────────────────────┐
  │ TTS called per sentence (HTTP, not WebSocket v1)     │
  │ Audio returned and queued for playback               │
  │ Sentence 1 audio plays while sentences 2+ synthesize │
  │ Latency per sentence: ~0.3-0.5s (Sarvam)            │
  └──────────────────────────────────────────────────────┘
                              │ audio chunks
                              ▼
Stage 5: Audio Playback (progressive)
  ┌──────────────────────────────────────────────────────┐
  │ Audio queue on frontend: plays sentence-by-sentence  │
  │ Seamless playback — next audio queued before current │
  │ ends. Frontend receives base64 audio chunks via the  │
  │ voice response or SSE events.                        │
  └──────────────────────────────────────────────────────┘
```

#### 20.14.2 Latency Comparison

| Stage | Legacy (HTTP) | Streaming Pipeline | Improvement |
|-------|--------------|-------------------|-------------|
| STT | ~2s | ~2s (unchanged — batched) | — |
| AI (full response) | ~4s | ~0.7s (first token) | -3.3s |
| TTS (full response) | ~3s | ~0.5s (first sentence) | -2.5s |
| **Total to first audio** | **~9s** | **~3-4s** | **~5-6s saved** |
| Total conversation | ~9s | ~5-6s (all sentences played) | ~3-4s saved |

#### 20.14.3 Streaming Voice Controller Flow

```typescript
// apps/api/src/modules/voice/voice.controller.ts (streaming mode)
@Post('conversation')
@UseInterceptors(FileInterceptor('audio'))
async voiceConversation(
  @UploadedFile() audioFile: Express.Multer.File,
  @Body() dto: VoiceConversationDto,
  @Res() res: Response,
) {
  const agent = await this.agentsService.findByPublicId(dto.agentId);
  const webhookUrl = await this.agentsService.getEffectiveWebhookUrl(agent.id);

  // Step 1: STT (batched)
  const sttResult = await this.voiceService.transcribe({ ... });

  // Step 2: Stream AI response from n8n Chat Trigger (webhookUrl)
  const tokenStream = this.n8nStreamingService.streamFromWebhookUrl(
    webhookUrl, sttResult.text, dto.sessionId,
  );

  // Step 3+4: Buffer sentences → progressive TTS → stream audio chunks
  const audioChunks = this.voiceService.streamingTTS(
    tokenStream, sttResult.detectedLanguage, dto.agentId,
  );

  // Return progressive audio response
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');

  for await (const chunk of audioChunks) {
    res.write(JSON.stringify(chunk) + '\n');
  }
  res.end();
}
```

#### 20.14.4 Metadata Extraction from Stream

Timestamps for analytics are extracted from the n8n Chat Trigger stream chunks (same source for both text and voice streaming):

| Metric | Source |
|--------|--------|
| `n8nReceivedAt` | `begin` chunk `metadata.timestamp` |
| `agentRepliedAt` | `end` chunk `metadata.timestamp` |
| `timeToFirstToken` | First `item` chunk arrival - request sent time (ms) |
| `totalTokens` | Count of `item` chunks |
| `streamDurationMs` | `end` timestamp - `begin` timestamp (ms) |

See also Section 12.3 for the unified metadata extraction interface.

### 20.15 Sentence Buffering for Progressive TTS

Progressive TTS requires detecting sentence boundaries in the token stream so TTS can be triggered per-sentence rather than waiting for the full response.

#### 20.15.1 Sentence Boundary Rules

```typescript
// apps/api/src/modules/voice/utils/sentence-buffer.ts

export class SentenceBuffer {
  private buffer = '';
  private readonly SENTENCE_TERMINATORS = /[.!?]\s|[.!?]$/;
  private readonly MIN_SENTENCE_LENGTH = 10; // Avoid TTS calls for tiny fragments
  private readonly MAX_BUFFER_LENGTH = 500;  // Force flush for very long sentences

  /**
   * Feed tokens into the buffer. Returns complete sentences ready for TTS.
   * Returns empty array if no sentence boundary detected yet.
   */
  addToken(token: string): string[] {
    this.buffer += token;
    const sentences: string[] = [];

    // Check for sentence boundaries
    while (this.SENTENCE_TERMINATORS.test(this.buffer)) {
      const match = this.buffer.match(this.SENTENCE_TERMINATORS);
      if (!match || match.index === undefined) break;

      const sentenceEnd = match.index + match[0].length;
      const sentence = this.buffer.slice(0, sentenceEnd).trim();

      if (sentence.length >= this.MIN_SENTENCE_LENGTH) {
        sentences.push(sentence);
      }
      this.buffer = this.buffer.slice(sentenceEnd);
    }

    // Force flush if buffer is too long (e.g., no punctuation in long response)
    if (this.buffer.length >= this.MAX_BUFFER_LENGTH) {
      sentences.push(this.buffer.trim());
      this.buffer = '';
    }

    return sentences;
  }

  /** Flush remaining buffer content (called when stream ends) */
  flush(): string | null {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? remaining : null;
  }
}
```

#### 20.15.2 Streaming TTS Orchestrator

```typescript
// apps/api/src/modules/voice/voice.service.ts (new method)

/**
 * Progressive TTS: reads tokens from AI stream, buffers into sentences,
 * synthesizes each sentence as it completes. Returns async generator of
 * audio chunks for progressive playback.
 */
async *streamingTTS(
  tokenStream: AsyncGenerator<N8nStreamChunk>,
  language: string,
  agentId: string,
): AsyncGenerator<VoiceStreamChunk> {
  const sentenceBuffer = new SentenceBuffer();
  const config = await this.getVoiceConfig(agentId);
  const provider = this.resolveTTSProvider(config, language);
  let sentenceIndex = 0;
  let fullText = '';

  for await (const chunk of tokenStream) {
    if (chunk.type === 'item' && chunk.content) {
      fullText += chunk.content;
      const sentences = sentenceBuffer.addToken(chunk.content);

      for (const sentence of sentences) {
        const ttsResult = await provider.synthesize({
          text: sentence,
          language,
          agentId,
          voiceId: config.ttsVoiceId,
          speed: config.ttsSpeed,
        });

        yield {
          type: 'audio',
          sentenceIndex: sentenceIndex++,
          text: sentence,
          audio: ttsResult.audio.toString('base64'),
          audioFormat: ttsResult.format,
          audioDurationMs: ttsResult.durationMs,
          ttsLatencyMs: ttsResult.latencyMs,
        };
      }
    }
  }

  // Flush remaining buffer
  const remaining = sentenceBuffer.flush();
  if (remaining) {
    const ttsResult = await provider.synthesize({
      text: remaining,
      language,
      agentId,
      voiceId: config.ttsVoiceId,
      speed: config.ttsSpeed,
    });

    yield {
      type: 'audio',
      sentenceIndex: sentenceIndex++,
      text: remaining,
      audio: ttsResult.audio.toString('base64'),
      audioFormat: ttsResult.format,
      audioDurationMs: ttsResult.durationMs,
      ttsLatencyMs: ttsResult.latencyMs,
    };
  }

  // Final chunk with full text for storage
  yield {
    type: 'end',
    fullText,
    totalSentences: sentenceIndex,
  };
}
```

#### 20.15.3 Voice Stream Chunk Interface

```typescript
// apps/api/src/modules/voice/interfaces/voice-stream.interface.ts

export interface VoiceAudioChunk {
  type: 'audio';
  sentenceIndex: number;
  text: string;                // Sentence text
  audio: string;               // Base64-encoded audio
  audioFormat: 'mp3' | 'wav' | 'opus';
  audioDurationMs: number;
  ttsLatencyMs: number;
}

export interface VoiceEndChunk {
  type: 'end';
  fullText: string;            // Complete AI response text
  totalSentences: number;
}

export type VoiceStreamChunk = VoiceAudioChunk | VoiceEndChunk;
```

---

## 21. Appendix: File Structure Reference

### Quick Reference: Where Things Live

| Component | Location | Description |
|-----------|----------|-------------|
| API Entry | `apps/api/src/main.ts` | NestJS bootstrap |
| API Modules | `apps/api/src/modules/` | Feature modules |
| Prisma Schema | `apps/api/prisma/schema.prisma` | Database schema |
| Dashboard Pages | `apps/web/app/` | Next.js App Router |
| Dashboard Components | `apps/web/components/` | React components |
| Zustand Stores | `apps/web/store/` | Client state (UI, drafts) |
| Query Hooks | `apps/web/hooks/queries/` | Server state (TanStack Query) |
| Voice Module | `apps/api/src/modules/voice/` | STT/TTS orchestration |
| Voice Providers | `apps/api/src/modules/voice/providers/` | Sarvam, Deepgram, ElevenLabs adapters |
| Voice Utils | `apps/api/src/modules/voice/utils/` | Sentence buffer, stream helpers |
| Voice Interfaces | `apps/api/src/modules/voice/interfaces/` | VoiceStreamChunk, provider types |
| Voice Config Schema | `packages/validation/src/schemas/voice.schema.ts` | Voice configuration validation |
| Widget Entry | `apps/widget/src/index.ts` | Widget bootstrap |
| Widget Components | `apps/widget/src/components/` | Preact components |
| Widget Voice Hook | `apps/widget/src/hooks/useVoice.ts` | Voice capture/playback state |
| Zod Schemas | `packages/validation/src/schemas/` | Shared validation |
| Theme Utils | `packages/theme/src/` | Theme transformer |
| Shared UI | `packages/widget-ui/src/` | Widget components |
| Dashboard UI | `packages/ui/src/` | Shadcn components |
| TS Configs | `packages/typescript-config/` | Shared TS configs |
| ESLint Configs | `packages/eslint-config/` | Shared lint rules |
| CI/CD | `.github/workflows/` | GitHub Actions |
| Docker | `docker/` | Dockerfiles |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-02-02 | Winston (Architect) | Initial architecture document |
| 1.1.0 | 2026-03-14 | Winston (Architect) | Added Voice Architecture (Section 20): provider adapter pattern, multilingual routing (Sarvam AI, Deepgram, ElevenLabs), widget voice UI states, voice config schema, Phase 2 Realtime API design. Added ADR-011 for voice provider strategy. |
| 1.2.0 | 2026-03-23 | Winston (Architect) | **Streaming Pipeline.** Added ADR-013: n8n Chat Trigger real streaming + progressive TTS. Updated Section 12 (SSE) with dual-mode streaming architecture (real vs simulated). Updated Section 13.2 (n8n provider) with `streamFromChatTrigger()` and `streamFromWebhook()` AsyncGenerators. Updated Section 20 with: streaming voice flow diagram (20.1.2), verified provider comparison (20.9 — ElevenLabs TTS confirmed en/hi/ta only, Sarvam speaker `priya` for Bulbul v3), streaming voice controller (20.14), sentence buffering for progressive TTS (20.15), latency comparison (9s → 3-4s TTFA), metadata extraction from stream chunks (20.14.4). Struck "n8n does not support streaming" constraint in 20.13. |

---

**End of Architecture Document**
