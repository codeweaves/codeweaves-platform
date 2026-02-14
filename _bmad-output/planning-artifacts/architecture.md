# Architecture Document - CodeWeaves Platform

**Version:** 1.0.0
**Author:** Winston (Architect Agent)
**Date:** 2026-02-02
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
20. [Appendix: File Structure Reference](#20-appendix-file-structure-reference)

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

### ADR-011: Resend for Transactional Email

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

### 12.1 SSE Controller

```typescript
// apps/api/src/modules/chat/chat.controller.ts
@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private aiService: AIService,
  ) {}

  @Post('message')
  @ApiOperation({ summary: 'Send message and get streamed AI response' })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async sendMessage(
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const { agentId, deviceId, message, sessionId, conversationHistory } = dto;

    // Validate agent and get config
    const agent = await this.chatService.getAgentByPublicId(agentId);

    // Create or resolve session
    const session = await this.chatService.resolveSession(
      agent.id,
      deviceId,
      sessionId,
    );

    // Save user message
    await this.chatService.saveMessage({
      sessionId: session.id,
      role: 'USER',
      content: message,
    });

    // Stream AI response
    try {
      const stream = await this.aiService.streamResponse({
        agent,
        message,
        history: conversationHistory,
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      }

      // Save bot response
      await this.chatService.saveMessage({
        sessionId: session.id,
        role: 'BOT',
        content: fullResponse,
        metadata: stream.metadata, // tokens, latency, etc.
      });

      res.write(`data: ${JSON.stringify({ type: 'done', sessionId: session.id })}\n\n`);
      res.end();

    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI service error' })}\n\n`);
      res.end();
      throw error;
    }
  }
}
```

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

```typescript
// apps/api/src/modules/ai/providers/n8n.provider.ts
@Injectable()
export class N8nProvider implements AIProvider {
  readonly name = 'n8n';

  async *streamMessage(request: AIRequest): AsyncGenerator<AIStreamChunk> {
    const config = this.getConfig();

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        message: request.message,
        history: request.conversationHistory,
        systemPrompt: request.systemPrompt,
      }),
    });

    // n8n returns full response, simulate streaming
    const data = await response.json();
    const content = this.extractContent(data);

    // Chunk the response for streaming effect
    const words = content.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield {
        content: words[i] + (i < words.length - 1 ? ' ' : ''),
        isLast: i === words.length - 1,
      };
      await this.delay(20); // Simulate streaming
    }
  }

  private extractContent(data: unknown): string {
    // Support multiple n8n response formats
    if (typeof data === 'string') return data;
    if (data?.agentReply) return data.agentReply;
    if (data?.output) return data.output;
    if (data?.ai_message?.content) return data.ai_message.content;
    throw new Error('Unknown n8n response format');
  }
}
```

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
| Voice STT | < 500ms | > 750ms |
| Voice TTS | < 300ms | > 500ms |

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

## 20. Appendix: File Structure Reference

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
| Widget Entry | `apps/widget/src/index.ts` | Widget bootstrap |
| Widget Components | `apps/widget/src/components/` | Preact components |
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

---

**End of Architecture Document**
