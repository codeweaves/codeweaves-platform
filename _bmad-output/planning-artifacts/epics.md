---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
workflowStatus: complete
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/test-design-architecture.md'
  - '_bmad-output/planning-artifacts/test-design-qa.md'
---

# CodeWeaves Platform - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for CodeWeaves Platform, decomposing the requirements from the PRD, Architecture, and Test Design documents into implementable stories.

**Timeline:** 1 month
**Development Model:** AI agents execute, human commands
**Parallel Tracks:** Backend + Frontend + Widget simultaneously

## Requirements Inventory

### Functional Requirements

**User Management & Authentication (FR1-FR10)**
- FR1: Super Admin can invite new users to the platform via email invitation with role assignment (Super Admin, Admin User, or Client User)
- FR2: Users can sign up using email and password after receiving an invitation link
- FR3: Users can sign in using email and password credentials
- FR4: Users can request password reset via email and set a new password
- FR5: Invited users can reissue expired invitation links (up to 5 attempts) using reissue token
- FR6: Users can update their display name after account creation
- FR7: System can validate password strength against security policy (minimum 10 characters, uppercase, lowercase, digit, special character, no email part)
- FR8: Super Admin can view list of all user invitations with status (pending, accepted, expired)
- FR9: Super Admin can resend invitation emails to specific users
- FR10: System can authenticate users via JSON Web Tokens (JWT) with automatic session refresh

**Organization & Multi-Tenancy Management (FR11-FR16)**
- FR11: Super Admin can create new organization records for B2B clients
- FR12: Admin User can view and manage agents across all organizations
- FR13: Client User can view and manage only their own organization's agents
- FR14: Super Admin can view list of all organizations with metadata (name, created date, agent count)
- FR15: System can enforce organization-based data isolation using application-level filtering (no RLS)
- FR16: Each organization can have multiple agents managed independently

**Agent Configuration & Management (FR17-FR27)**
- FR17: Super Admin and Admin User can create new AI chat agents with name and initial configuration
- FR18: Agent owners can configure agent settings (name, status, allowed domains, system prompts)
- FR19: Agent owners can update agent metadata (name, status, leads document URL)
- FR20: Agent owners can soft-delete agents (mark as deleted without permanent removal)
- FR21: System can generate unique public identifiers for agents (URL-safe, 8-character)
- FR22: Agent owners can configure AI provider webhooks (n8n or custom URLs)
- FR23: Agent owners can update AI provider authentication headers and credentials
- FR24: System can store agent secrets securely in isolated private schema
- FR25: Admin User can list all agents across all organizations with org names
- FR26: Client User can list only their own organization's agents
- FR27: Agent owners can set agent status (active/inactive) to control widget availability

**Theme & Visual Customization (FR28-FR44)**
- FR28: Agent owners can customize widget appearance using visual theme editor with 50+ configuration options
- FR29: Agent owners can customize icon appearance (position, background, border radius, colors, custom image)
- FR30: Agent owners can customize header (title, subtitle, logo, background, text colors)
- FR31: Agent owners can customize bubble notification (text, background, delay timing, sound)
- FR32: Agent owners can customize user and bot avatars (shape, type, colors, custom images)
- FR33: Agent owners can customize message styling (background colors, text colors, border radius)
- FR34: Agent owners can customize chat body background and overall appearance
- FR35: Agent owners can customize input field (colors, placeholder text, border radius)
- FR36: Agent owners can customize send button (colors, border radius)
- FR37: Agent owners can add branding (logo, link, text, colors) in widget footer
- FR38: Agent owners can configure conversational starters (quick reply buttons)
- FR39: Agent owners can configure greeting message displayed on widget open
- FR40: Agent owners can enable/disable timestamps on messages
- FR41: Agent owners can enable/disable typing indicator animation
- FR42: Agent owners can upload custom logos and favicons (base64 or URL)
- FR43: System can version theme configurations for cache busting
- FR44: Agent owners can preview theme changes in real-time before saving

**Widget Embedding & Deployment (FR45-FR55)**
- FR45: Agent owners can generate embed code (single script tag) for widget deployment
- FR46: System can serve widget JavaScript file with long-term caching (1 year)
- FR47: Widget can auto-detect and extract agent publicId from script tag URL parameters
- FR48: Widget can isolate styles from parent page using Shadow DOM
- FR49: Widget can load configuration from server on initialization
- FR50: Widget can render as minimized icon by default
- FR51: Widget can expand to full chat interface on icon click
- FR52: Widget can display bubble notification after configured delay
- FR53: Agent owners can configure allowed domains for CORS validation
- FR54: System can validate origin against allowed domain list (including wildcard patterns)
- FR55: Widget can load and apply custom CSS within Shadow DOM

**Chat & Conversation Management (FR56-FR69)**
- FR56: End users can send text messages through chat widget
- FR57: End users can receive AI-generated responses to their messages
- FR58: Widget can display typing indicator while AI processes response
- FR59: Widget can auto-scroll to latest message in conversation
- FR60: System can maintain conversation history within session (up to 40 messages)
- FR61: System can persist message history to database with metadata (timestamp, URL, user agent)
- FR62: System can create and manage chat sessions with 6-hour inactivity window
- FR63: System can track returning users across sessions using device ID
- FR64: System can render AI responses as sanitized HTML (allowed tags: b, strong, i, em, u, ul, ol, li, p, br, span, a)
- FR65: System can strip dangerous HTML attributes and scripts to prevent XSS attacks
- FR66: Widget can display conversational starter buttons for quick replies
- FR67: Widget can send pre-configured messages when starter buttons clicked
- FR68: End users can rate conversations (feedback mechanism)
- FR69: Widget can display greeting message on first interaction

**Real-Time Streaming & AI Integration (FR70-FR82)**
- FR70: System can stream AI responses in real-time using Server-Sent Events (SSE)
- FR71: Widget can receive streaming chunks and update message progressively
- FR72: System can fallback to Fetch API streaming if EventSource unavailable
- FR73: Widget can fallback to simulated chunking for direct n8n responses
- FR74: System can integrate with n8n AI workflow automation via webhooks
- FR75: System can route messages to custom AI provider webhooks per agent
- FR76: System can fallback to global n8n webhook if agent-specific webhook unavailable
- FR77: System can build system prompts dynamically from theme configuration
- FR78: System can send conversation history with current message to AI provider
- FR79: System can parse multiple AI response formats (agentReply, output, ai_message.content)
- FR80: Widget can support dual-path messaging (direct n8n OR server-proxied)
- FR81: System can timeout AI requests after configurable duration (10 seconds default)
- FR82: System can abort AI requests if client disconnects

**Analytics & Metrics (FR83-FR100)**
- FR83: Agent owners can view analytics dashboard with comprehensive metrics
- FR84: System can track and display Total Users (new vs returning, 60-day window)
- FR85: System can track and display Total Conversations Initiated (session count with 6h inactivity)
- FR86: System can track and display Total Messages (sent by user and received from bot)
- FR87: System can analyze and display Message Volume Trends (peak hours/days)
- FR88: System can track and display Languages Used (distribution across configured languages)
- FR89: System can analyze and display Most Popular Topics (categorized conversation themes)
- FR90: System can calculate and display User Retention Rate (% returning within 60 days)
- FR91: System can calculate and display User Growth Rate (new user growth period-over-period)
- FR92: System can calculate and display % Change in New Users (daily/weekly/monthly deltas)
- FR93: System can track and display Unresolved Queries (failed/unhandled queries percentage)
- FR94: System can track and display Fallback Rate (% of fallback responses triggered)
- FR95: System can calculate and display Average Bot Response Time (P95, P99 percentiles)
- FR96: System can track and display Number of Queries Raised (total user prompts)
- FR97: System can track and display Total Messages Exchanged (sum of user + bot messages)
- FR98: Agent owners can filter analytics by date range (7, 14, 30 days)
- FR99: System can visualize analytics data using charts (line, bar, pie, area)
- FR100: System can display per-agent performance tables with key metrics

**Event Tracking & Usage Monitoring (FR101-FR108)**
- FR101: Widget can track widget_opened event once per device
- FR102: Widget can track rating_submitted events with rating value and comment
- FR103: Widget can track error events with error message and stack trace
- FR104: System can store usage events with metadata (timestamp, URL, user agent, country)
- FR105: System can accept bulk message ingestion from widget
- FR106: System can extract and store telemetry from AI responses (model, tokens, latency)
- FR107: System can track widget lifecycle events (opened, minimized, closed)
- FR108: System can correlate events with sessions and agents for analytics

**Security & Compliance (FR109-FR123)**
- FR109: System can enforce rate limiting using sliding window algorithm
- FR110: System can block clients exceeding rate limits for configured duration
- FR111: System can verify HMAC signatures for authenticated widget requests (optional)
- FR112: System can prevent replay attacks using nonce cache with timestamp validation
- FR113: System can validate domain origins for CORS protection
- FR114: System can encrypt sensitive agent secrets before storage
- FR115: System can validate user input against password policy
- FR116: System can reject common weak passwords
- FR117: Admin operations must bypass Row Level Security using service role key
- FR118: Client operations must respect organization-based data filtering
- FR119: System can store JWT tokens securely with auto-refresh
- FR120: System can handle session expiration and re-authentication
- FR121: System can validate all API requests with authentication tokens
- FR122: Client User can view limited logs for their organization (audit, widget activity, API usage, performance metrics)
- FR123: Client User cannot access internal system logs (database queries, stack traces, infrastructure)

**Audit Logging & Traceability (FR124-FR134)**
- FR124: System can log all state-changing operations to audit log
- FR125: System can capture audit events with user ID, org ID, action type, target resource, and details
- FR126: Super Admin can view audit logs for all organizations
- FR127: Admin User can view audit logs for all organizations
- FR128: Client User can view audit logs for their own organization only
- FR129: System can store audit log entries with timestamp and persistence
- FR130: System can handle audit log failures gracefully without blocking operations
- FR131: System can log agent creation, updates, and deletion events
- FR132: System can log theme updates with version tracking
- FR133: System can log user invitation and password change events
- FR134: System can log authentication events (login, logout, role changes)

**Voice & Multi-Language Support (FR135-FR149)**
- FR135: End users can send voice input messages via speech-to-text
- FR136: System can transcribe voice input to text with >95% accuracy
- FR137: System can detect language from voice input automatically
- FR138: End users can receive voice output responses via text-to-speech
- FR139: System can synthesize speech from AI responses with <300ms latency
- FR140: Agent owners can enable/disable voice input for their agents
- FR141: Agent owners can enable/disable voice output for their agents
- FR142: Agent owners can configure supported languages (English, Hindi, Marathi, Hinglish)
- FR143: System can detect conversation language automatically
- FR144: System can persist user language preference across session
- FR145: System can route messages to appropriate language-specific AI model
- FR146: System can track language distribution in analytics
- FR147: Widget can display voice input button when enabled
- FR148: Widget can display voice output toggle when enabled
- FR149: System can process voice with <500ms transcription latency

**Device & Session Tracking (FR150-FR159)**
- FR150: Widget can generate and persist unique device identifier in localStorage and cookie (30-day expiration)
- FR151: Widget can fallback to session-only identifier if localStorage/cookies blocked
- FR152: Widget can generate unique request identifier per page load
- FR153: Widget can send device ID and request ID headers on all API calls
- FR154: System can resolve or create sessions based on device ID and fingerprint
- FR155: System can track session metadata (IP, user agent, device fingerprint, started_at, last_seen_at)
- FR156: System can update session last_seen_at on message ingestion
- FR157: System can track message count per session
- FR158: System can create new session after 6-hour inactivity window
- FR159: Widget can send page-load flag on first message for session creation

**System Health & Monitoring (FR160-FR168)**
- FR160: System can expose health check endpoint for monitoring
- FR161: System can serve widget configuration with ETag support for caching
- FR162: System can set cache headers for widget config (5-minute max-age)
- FR163: System can log errors to console in development mode
- FR164: System can integrate with Sentry for error tracking and monitoring
- FR165: System can integrate with Sentry for performance monitoring (APM)
- FR166: System can integrate with Sentry for log aggregation
- FR167: System can track API response times and latency
- FR168: System can alert on performance degradation (P95 > 1.5s)

### Non-Functional Requirements

**Performance (NFR1-NFR11)**
- NFR1: AI chat responses must complete in <1.5 seconds (P95) and <2 seconds (P99)
- NFR2: Dashboard page load must achieve First Contentful Paint <1 second
- NFR3: Dashboard interactions must respond in <100ms
- NFR4: Widget JavaScript must load in <200ms without impacting parent page performance
- NFR5: API endpoints must respond in <100ms (P95) excluding AI processing
- NFR6: Database queries must execute in <50ms (P95)
- NFR7: Voice transcription must complete in <500ms
- NFR8: Text-to-speech synthesis must complete in <300ms
- NFR9: React components must be reusable with zero unnecessary re-renders (monitored via React DevTools)
- NFR10: Widget bundle size must remain <150KB (minified)
- NFR11: Dashboard must use code splitting and lazy loading for optimal performance

**Security (NFR12-NFR29)**
- NFR12: All user authentication must be handled via Auth0 (no password storage in application)
- NFR13: API requests must be authenticated with JWT tokens
- NFR14: JWT tokens must expire after 7 days with refresh token support
- NFR15: Role-based access control must be enforced at application level for all data access
- NFR16: All data in transit must be encrypted using HTTPS/TLS 1.3
- NFR17: All data at rest must be encrypted (Supabase encryption)
- NFR18: Agent secrets (webhooks, API keys) must be stored in isolated private schema with encryption
- NFR19: Sensitive data must never be logged or exposed in error messages
- NFR20: System must enforce rate limiting per organization to prevent abuse
- NFR21: System must validate all CORS requests against allowed domain list
- NFR22: System must validate and sanitize all user input to prevent XSS attacks
- NFR23: System must prevent SQL injection via parameterized queries (Prisma ORM)
- NFR24: System must support HMAC signature verification for widget requests
- NFR25: System must prevent replay attacks using nonce cache with timestamp validation
- NFR26: System must support GDPR data export (user data portability)
- NFR27: System must support GDPR data deletion (right to erasure within 30 days)
- NFR28: System must track user consent for cookies and data processing
- NFR29: System must maintain audit log for all state-changing operations

**Scalability (NFR30-NFR39)**
- NFR30: Backend services must support horizontal scaling via Docker + Kubernetes
- NFR31: System must handle 100+ organizations in 3 months
- NFR32: System must scale to 500+ organizations in 12 months
- NFR33: System must support 1,000+ concurrent widget instances
- NFR34: System must scale to 10,000+ active widgets in 12 months
- NFR35: System must maintain <10% performance degradation with 10x user growth
- NFR36: Database must use connection pooling (PgBouncer) for efficient resource management
- NFR37: Static assets (widget JS, images) must be served via CDN
- NFR38: System must use Redis caching for sessions, config, and frequently accessed data
- NFR39: System must process analytics asynchronously using job queues (BullMQ/RabbitMQ)

**Reliability (NFR40-NFR50)**
- NFR40: System must maintain 99.9% uptime SLA (less than 8.76 hours downtime per year)
- NFR41: System must support zero-downtime deployments via blue-green strategy
- NFR42: System must include automated health checks for all services
- NFR43: System must implement graceful degradation when non-critical services fail
- NFR44: System must maintain <1% error rate on AI responses
- NFR45: System must handle and log all errors without exposing sensitive information
- NFR46: System must recover gracefully from AI provider timeouts
- NFR47: System must retry failed operations with exponential backoff where appropriate
- NFR48: System must use database transactions for multi-step operations
- NFR49: System must maintain referential integrity across all database relationships
- NFR50: System must perform automated database backups with point-in-time recovery

**Observability (NFR51-NFR63)**
- NFR51: System must integrate with Sentry for real-time error tracking (client + server)
- NFR52: All errors must include context (user ID, org ID, request ID, stack trace)
- NFR53: Critical errors must trigger alerts to on-call engineers
- NFR54: System must integrate with Sentry APM for performance monitoring
- NFR55: System must track API latency, database query performance, and React rendering performance
- NFR56: System must alert when P95 response time exceeds 1.5 seconds
- NFR57: System must integrate with Sentry for centralized log aggregation
- NFR58: Logs must include request tracing IDs for correlation
- NFR59: Logs must be searchable and filterable by org ID, user ID, timestamp
- NFR60: System must retain logs for minimum 90 days for troubleshooting
- NFR61: System must expose business metrics dashboards (conversations, users, usage)
- NFR62: System must track resource utilization (CPU, memory, storage, network)
- NFR63: System must monitor 14 KPIs in real-time with historical trends

**Quality (NFR64-NFR75)**
- NFR64: Codebase must maintain >80% test coverage across all packages
- NFR65: All code must pass TypeScript type checking with strict mode enabled
- NFR66: All code must pass linting rules (ESLint) before merge
- NFR67: System must have zero critical security vulnerabilities (Snyk/Dependabot)
- NFR68: All new features must include unit tests
- NFR69: Critical user flows must have integration tests
- NFR70: API endpoints must have contract tests
- NFR71: Automated tests must run in CI/CD pipeline and block merge on failure
- NFR72: All APIs must be auto-documented using OpenAPI/Swagger
- NFR73: API documentation must include code examples and error responses
- NFR74: Shared TypeScript types must be generated from Zod schemas
- NFR75: System must generate migration scripts for database schema changes

**Integration (NFR76-NFR89)**
- NFR76: Auth0 integration must handle social logins (Google, GitHub, Microsoft)
- NFR77: Auth0 integration must support MFA (multi-factor authentication)
- NFR78: Supabase integration must use connection pooling for optimal performance
- NFR79: n8n integration must support custom webhooks per agent
- NFR80: n8n integration must be swappable without frontend changes (AI abstraction layer)
- NFR81: All REST APIs must follow RESTful principles (resources, verbs, status codes)
- NFR82: APIs must support versioning strategy (/v1/, /v2/ in URL path)
- NFR83: APIs must return consistent error response format (RFC 7807 Problem Details)
- NFR84: List endpoints must support pagination (cursor-based preferred)
- NFR85: List endpoints must support filtering, sorting, and search capabilities
- NFR86: All API requests/responses must use JSON format
- NFR87: All timestamps must use ISO 8601 format
- NFR88: All API responses must include appropriate cache headers
- NFR89: Shared validation schemas must use Zod across frontend and backend

### Additional Requirements

**From Architecture Document (ADR Decisions):**

- ADR-001: Monorepo with Turborepo - pnpm workspaces, cached builds, coordinated versioning
- ADR-002: NestJS for Backend - Dependency injection, Swagger support, Prisma ORM
- ADR-003: Next.js v16 for Dashboard - App Router, Server Components, Tailwind CSS v4, Shadcn UI
- ADR-004: Preact + Shadow DOM for Widget - 3KB runtime, closed Shadow DOM, CSS Variables theming
- ADR-005: Auth0 for Authentication - NO Supabase Auth, JWT verification in NestJS
- ADR-006: Application-Level Data Access (No RLS) - All filtering at service layer, organizationId in every query
- ADR-007: Backend-Proxied AI Responses - All AI requests through NestJS, unified logging
- ADR-008: Hybrid Analytics Processing - Real-time for 7 days, batch aggregation for historical
- ADR-009: CSS Variables for Theme Customization - 50+ theme options as CSS Custom Properties
- ADR-010: Zustand + TanStack Query for State Management - TanStack Query for server state, Zustand for client state

**Monorepo Structure Required:**
- `apps/web` - Next.js Dashboard (rename/reconfigure existing)
- `apps/api` - NestJS Backend (CREATE NEW)
- `apps/widget` - Preact Widget (CREATE NEW)
- `packages/validation` - Shared Zod Schemas (CREATE NEW)
- `packages/theme` - Theme Utilities (CREATE NEW)
- `packages/widget-ui` - Shared Widget Components (CREATE NEW)
- `packages/ui` - Shadcn UI Components (CREATE NEW)
- `packages/typescript-config` - Shared TS Configs (EXISTS)
- `packages/eslint-config` - Shared ESLint Configs (EXISTS)

**Database Schema (Prisma):**
- Organization, User, UserInvitation models
- Agent, AgentTheme, AgentSecret models
- ChatSession, ChatMessage models
- UsageEvent, AnalyticsAggregation models
- AuditLog model

**From Test Design Documents (Critical Testing Requirements):**

**P0 - Critical (Must block deployment):**
- Tenant Isolation Tests ("Evil Twin" pattern) - Every resource × every verb × wrong org
- JWT Verification Tests - Valid, expired, malformed, wrong issuer, wrong audience, tampered
- RBAC Permission Matrix Tests - All endpoints × all 3 roles
- Pre-commit hook for Prisma queries without organizationId

**P1 - High (Should block deployment):**
- AI Provider Abstraction Tests - Response format handling, error handling, streaming
- Integration Test Infrastructure - Jest + Supertest, test database, auth helpers

**Test Infrastructure Required:**
- Test database setup (PostgreSQL test container)
- Auth test helpers (JWT generation for test users)
- Seed data factories (multi-tenant test data)
- CI/CD pipeline with quality gates

**Quality Gates (PR Merge):**
- Unit tests pass: 100%
- Integration tests pass: 100%
- Code coverage: >80%
- Security coverage: 100% for guards/middleware
- Linting: 0 errors
- Type checking: 0 errors

**External Service Setup Required:**
- Auth0: Tenant, application, API configuration
- Supabase: PostgreSQL database, object storage
- Sentry: Error tracking, APM, log aggregation
- n8n: Webhook URL (already hosted)

### FR Coverage Map

| FR Range | Epic | Domain |
|----------|------|--------|
| FR1-FR10 | Epic 1 | User Authentication & Account Management |
| FR11-FR16 | Epic 2 | Multi-Tenant Organization Management |
| FR17-FR27 | Epic 3 | Agent Creation & Configuration |
| FR28-FR44 | Epic 4 | Widget Theme Editor & Customization |
| FR45-FR55 | Epic 5 | Embeddable Chat Widget |
| FR56-FR69 | Epic 6 | Chat Conversation Experience |
| FR70-FR82 | Epic 7 | AI Provider Integration & Abstraction |
| FR83-FR100 | Epic 8 | Analytics Dashboard & KPIs |
| FR101-FR108 | Epic 9 | Event Tracking & Usage Monitoring |
| FR109-FR134 | Epic 11 | Security, Audit & Compliance |
| FR135-FR149 | Epic 10 | Voice & Multi-Language Support |
| FR150-FR159 | Epic 6 | Chat Conversation Experience (Device Tracking) |
| FR160-FR168 | Epic 12 | Observability & System Reliability |

### UI/UX Context

**Dashboard Specifications:**
- Fixed width: 1440px (minimum 1280px)
- Main sidebar: #333333, Open Sans font, white text
- Main sidebar collapses (icons only) when Agent Editor is active
- Layout: Logo + name (top) → Navigation sections → User profile (bottom)

**Theme Editor Design (from legacy code):**
- 3-panel layout: Config Sidebar (256px) | Form Area (flex-3) | Live Preview (flex-2, min-450px)
- Components: FormSection, ColorPicker, TabGroup
- Sticky bottom action bar: Reset + Save buttons
- Real-time preview using ChatWidgetSurface component
- 50+ theme configuration fields

**Color System:**
- Primary accent: #3B82F6 (blue-600)
- Selected state: blue-50 bg, blue-700 text
- Backgrounds: gray-50, gray-100, white
- Borders: gray-200

## Epic List

### Epic 0: Project Foundation & Developer Environment
**Goal:** Development team has a fully configured monorepo with all tools, packages, and test infrastructure ready for parallel development.

**Scope:**
- Delete `apps/docs` from default Turborepo
- Create `apps/api` (NestJS backend)
- Create `apps/widget` (Preact widget)
- Create shared packages: `validation`, `theme`, `widget-ui`, `ui`
- Configure TypeScript (strict mode) and ESLint
- Setup test infrastructure (Jest, test DB, auth helpers)
- Docker Compose for local development
- CI/CD pipeline foundation (GitHub Actions)
- Environment configuration (.env files)

**FRs:** None directly (enables all)
**NFRs:** NFR64-75 (Quality), NFR71 (CI/CD)
**Priority:** FIRST (blocks all other epics)

---

### Epic 1: User Authentication & Account Management
**Goal:** Users can securely sign in, manage their profile, and Super Admins can invite new users to the platform.

**Scope:**
- Auth0 integration (login, signup, password reset)
- JWT verification in NestJS (JwtStrategy, AuthGuard)
- User profile management
- Invitation system (Super Admin only)
- Role assignment (Super Admin, Admin, Client)
- Password policy enforcement

**FRs:** FR1-FR10
**NFRs:** NFR12-15 (Security/Auth)
**Test Priority:** P0 (JWT verification suite - 9 test cases)
**Dependencies:** Epic 0

---

### Epic 2: Multi-Tenant Organization Management
**Goal:** Super Admins can create organizations, Admins can view all orgs, and Client Users can only see their own org's data. Data is completely isolated between tenants.

**Scope:**
- Organization CRUD operations
- Tenant isolation at application level (ADR-006)
- RBAC enforcement (RolesGuard)
- organizationId filter on ALL Prisma queries
- "Evil Twin" tests for tenant isolation
- Team management & invitation UI (Story 2.9)

**FRs:** FR11-FR16
**NFRs:** NFR15, NFR20-23 (Security)
**Test Priority:** P0 (Tenant Isolation suite - CRITICAL)
**Dependencies:** Epic 0, Epic 1

---

### Epic 3: Agent Creation & Configuration
**Goal:** Users can create AI chat agents, configure their settings, manage allowed domains, and set up webhooks for AI providers.

**Scope:**
- Agent CRUD operations
- Public ID generation (8-char URL-safe nanoid)
- Domain allowlist configuration
- Webhook URL configuration (n8n)
- Agent status management (active/inactive)
- Agent secrets storage (encrypted)

**FRs:** FR17-FR27
**NFRs:** NFR18 (Secret encryption)
**Dependencies:** Epic 0, Epic 1, Epic 2

---

### Epic 4: Widget Theme Editor & Customization
**Goal:** Users can fully customize their chat widget appearance using a visual editor with 50+ options and see changes in real-time preview.

**Scope:**
- Theme Editor page (3-panel layout from legacy code)
- FormSection, ColorPicker, TabGroup components
- 50+ theme configuration fields
- Live preview (ChatWidgetSurface)
- Theme versioning for cache busting
- Main sidebar collapse behavior on this page
- Categories: General, Appearance, Chat, Behavior, Prompt, Integration, Branding
- Image upload via Supabase Storage (header logo, icon, avatars, branding logo)
- Agent table actions column (Edit, Embed, Demo, Delete)
- Public demo page for shareable agent testing
- Conversation starters simplification (single message field, 80-char limit)

**FRs:** FR28-FR44
**NFRs:** NFR9 (Zero re-renders)
**Dependencies:** Epic 0, Epic 3

**Stories:** 4.1-4.18 (4.1-4.13 original, 4.14-4.18 added during implementation)

---

### Epic 5: Embeddable Chat Widget
**Goal:** Website visitors can see and interact with a beautiful, branded chat widget that loads fast and doesn't affect the host page.

**Scope:**
- Preact + Vite widget application
- Shadow DOM initialization (closed mode)
- Widget initialization from script tag
- Theme CSS variables injection
- Widget config loading (with ETag caching)
- Icon, bubble notification, chat window states
- CORS validation against allowed domains

**FRs:** FR45-FR55
**NFRs:** NFR4 (<200ms load), NFR10 (<150KB bundle)
**Dependencies:** Epic 0, Epic 3

---

### Epic 6: Chat Conversation Experience
**Goal:** End users can send messages, receive AI responses with streaming, and have natural conversations with the chat agent.

**Scope:**
- Message sending/receiving UI
- Real-time SSE streaming display
- Typing indicator animation
- Conversation history (40 messages limit)
- Session management (6h inactivity window)
- Greeting message, conversational starters
- HTML sanitization (XSS prevention)
- Device ID generation and tracking
- Auto-scroll behavior

**FRs:** FR56-FR69, FR150-FR159
**NFRs:** NFR1 (<1.5s P95 response)
**Dependencies:** Epic 0, Epic 5, Epic 7

---

### Epic 7: AI Provider Integration & Abstraction
**Goal:** Chat agents connect to AI providers (n8n) and can be switched between providers without any frontend changes.

**Scope:**
- AI Service abstraction layer (ADR-007)
- n8n webhook integration
- Multiple response format parsing (agentReply, output, ai_message.content)
- SSE streaming from backend
- Timeout handling (10s default)
- Error handling and fallback messages
- Per-agent custom webhooks
- System prompt building from theme config

**FRs:** FR70-FR82
**NFRs:** NFR79-80 (n8n integration)
**Test Priority:** P1 (AI Service abstraction suite)
**Dependencies:** Epic 0, Epic 1, Epic 3

---

### Epic 8: Analytics Dashboard & KPIs (REFINED)
**Goal:** Users can view analytics dashboard with buildable KPIs, understand chat performance, and make data-driven decisions. Seeded with realistic dummy data for client demos.

**Scope (Refined 2026-03-03):**
- Seed data script (realistic dummy data across multiple orgs/bots with WIDGET source)
- Analytics API endpoints with role-based access (Super Admin/Admin: all orgs | Client: own org)
- Analytics dashboard page layout with date range filtering (7/14/30 days + custom)
- 10 buildable KPIs (see below)
- Charts visualization (line, bar, heatmap)
- Per-agent analytics table
- Empty state for new users
- Real-time polling updates

**Buildable KPIs (10):**
1. Total Users (new vs returning, 60-day window)
2. Total Conversations (session count)
3. Total Messages (user sent + bot received)
4. Message Volume Trends (peak hours/days)
5. User Retention Rate (% returning within 60 days)
6. User Growth Rate (new users period-over-period)
7. % Change in New Users (daily/weekly/monthly deltas)
8. Avg Bot Response Time (P50, P95, P99)
9. Number of Queries Raised (total user prompts)
10. Total Messages Exchanged (sum user + bot)

**Deferred KPIs:** Languages Used, Most Popular Topics (AI categorization), Unresolved Queries, Fallback Rate, User Satisfaction Score, Conversation Completion Rate
**Deferred details:** See `_bmad-output/implementation-artifacts/epic-8-deferred-kpis.md`

**FRs:** FR83-FR87, FR90-FR92, FR95-FR100 (FR88, FR89, FR93, FR94 deferred)
**NFRs:** NFR39 (Async processing), NFR61 (Business metrics)
**Dependencies:** Epic 0, Epic 1, Epic 2 (Epic 9 dependency removed — building with existing chat data + seed data)

---

### Epic 9: Event Tracking & Usage Monitoring
**Goal:** All user interactions are tracked, enabling accurate analytics and troubleshooting capabilities.

**Scope:**
- Widget event tracking (opened, closed, minimized, rating)
- Bulk message ingestion API
- Telemetry extraction from AI responses
- Event correlation with sessions
- Usage event storage with metadata

**FRs:** FR101-FR108
**NFRs:** NFR51-52 (Error tracking with context)
**Dependencies:** Epic 0, Epic 5, Epic 6

---

### Epic 10: Voice & Multi-Language Support
**Goal:** End users can speak to the chat agent and receive voice responses in their preferred language (English, Hindi, Marathi, Hinglish).

**Scope:**
- Speech-to-text (STT) integration
- Text-to-speech (TTS) integration
- Language detection (automatic)
- Voice button UI in widget
- Language preference persistence
- Language distribution analytics
- Agent-level voice enable/disable

**FRs:** FR135-FR149
**NFRs:** NFR7 (<500ms STT), NFR8 (<300ms TTS)
**Dependencies:** Epic 0, Epic 5, Epic 6
**Note:** Can be deprioritized if timeline is tight

---

### Epic 11: Security, Audit & Compliance
**Goal:** Platform maintains enterprise-grade security with full audit trail, rate limiting, and compliance with security standards.

**Scope:**
- Rate limiting (sliding window algorithm, Redis)
- HMAC signature verification (optional)
- Replay attack prevention (nonce cache)
- Audit logging for all mutations
- GDPR data export/deletion
- Password policy enforcement
- RBAC permission matrix

**FRs:** FR109-FR134
**NFRs:** NFR20-29 (Security), NFR29 (Audit log)
**Test Priority:** P0 (RBAC suite - 30 test cases)
**Dependencies:** Epic 0, Epic 1, Epic 2

---

### Epic 12: Observability & System Reliability
**Goal:** Platform is reliable, issues are detected and alerted quickly, and the system maintains 99.9% uptime.

**Scope:**
- Sentry integration (errors, APM, logs)
- Health check endpoints (/health, /health/ready)
- Performance monitoring
- Alerting on degradation (P95 > 1.5s)
- Request tracing (correlation IDs)
- Graceful degradation patterns

**FRs:** FR160-FR168
**NFRs:** NFR40-50 (Reliability), NFR51-63 (Observability)
**Dependencies:** Epic 0 (can run in parallel with other epics)

---

## Development Tracks (Parallel Execution)

```
WEEK 1:
┌─────────────────────────────────────────────────────────────────┐
│ Epic 0: Project Foundation (ALL tracks blocked until complete)  │
└─────────────────────────────────────────────────────────────────┘

WEEK 2-4:
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  BACKEND TRACK  │  │ DASHBOARD TRACK │  │  WIDGET TRACK   │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ Epic 1: Auth    │  │ Epic 4: Theme   │  │ Epic 5: Widget  │
│ Epic 2: Orgs    │  │   Editor        │  │   Shell         │
│ Epic 3: Agents  │  │                 │  │                 │
│ Epic 7: AI      │  │ Epic 3: Agent   │  │ Epic 6: Chat    │
│ Epic 11: Sec    │  │   Pages (UI)    │  │   Experience    │
│ Epic 9: Events  │  │                 │  │                 │
│ Epic 8: Analyt  │  │ Epic 8: Analyt  │  │ Epic 10: Voice  │
│   (Backend)     │  │   (Dashboard)   │  │   (if time)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │ Epic 12: Observe  │
                    │ (Throughout)      │
                    └───────────────────┘
```

## Priority Summary

| Priority | Epics | Reason |
|----------|-------|--------|
| P0 | 0, 1, 2, 11 | Foundation + Security (blocks everything) |
| P1 | 3, 4, 5, 6, 7 | Core product functionality |
| P2 | 8, 9, 12 | Analytics + Observability |
| P3 | 10 | Voice (nice-to-have for MVP) |

---

## User Stories

### Epic 0: Project Foundation & Developer Environment

#### Story 0.1: Initialize Turborepo Monorepo Structure

As a **developer**,
I want a properly configured Turborepo monorepo,
So that I can work on multiple packages with shared tooling and cached builds.

**Acceptance Criteria:**

**Given** a fresh codebase
**When** I set up the monorepo structure
**Then** Turborepo is configured with pnpm workspaces
**And** `apps/` directory contains `web` (Next.js dashboard)
**And** `packages/` directory contains shared configurations
**And** `turbo.json` defines build pipelines with caching
**And** `pnpm-workspace.yaml` lists all workspace packages
**And** Running `pnpm install` installs all dependencies

---

#### Story 0.2: Remove Default Docs App

As a **developer**,
I want the default `apps/docs` removed from the Turborepo template,
So that the codebase only contains our actual applications.

**Acceptance Criteria:**

**Given** the default Turborepo setup
**When** I clean up unnecessary packages
**Then** `apps/docs` directory is deleted
**And** References to docs are removed from `turbo.json`
**And** No build errors occur after removal

---

#### Story 0.3: Scaffold NestJS Backend Application

As a **developer**,
I want a NestJS v11+ backend application in `apps/api`,
So that I can build the REST API with proper structure.

**Acceptance Criteria:**

**Given** the monorepo structure exists
**When** I create the backend application
**Then** `apps/api` contains a NestJS application
**And** TypeScript strict mode is enabled
**And** Swagger/OpenAPI documentation is configured
**And** ESLint configuration extends shared config
**And** `pnpm dev --filter=api` starts the development server

---

#### Story 0.4: Create Shared Contracts & Validation Package

As a **developer**,
I want a shared Zod schemas package in `packages/validation`,
So that frontend and backend share the same validation logic and API contracts.

**Acceptance Criteria:**

**Given** the monorepo structure exists
**When** I create the validation package
**Then** `packages/validation` contains Zod schema definitions
**And** Schemas can be imported by both `apps/web` and `apps/api`
**And** TypeScript types are inferred from Zod schemas
**And** Package includes request/response types for all API endpoints
**And** Package exports are properly configured in `package.json`

---

#### Story 0.5: Configure Prisma ORM with PostgreSQL

As a **developer**,
I want Prisma ORM configured for database access,
So that I can interact with PostgreSQL using type-safe queries.

**Acceptance Criteria:**

**Given** the NestJS backend exists
**When** I configure Prisma
**Then** `prisma/schema.prisma` defines the initial database schema
**And** Prisma Client is generated with TypeScript types
**And** Database connection uses environment variables
**And** Migration workflow is documented
**And** `pnpm db:migrate` runs migrations successfully

---

#### Story 0.6: Set Up TypeScript Strict Configuration

As a **developer**,
I want TypeScript strict mode enabled across all packages,
So that code quality is enforced at compile time.

**Acceptance Criteria:**

**Given** multiple packages in the monorepo
**When** I configure TypeScript
**Then** `packages/typescript-config` contains shared tsconfig files
**And** All packages extend from shared configuration
**And** `strict: true` is enabled in base config
**And** `pnpm typecheck` runs type checking across all packages
**And** Zero type errors on initial setup

---

#### Story 0.7: Configure ESLint with Shared Rules

As a **developer**,
I want consistent linting rules across all packages,
So that code style is uniform throughout the codebase.

**Acceptance Criteria:**

**Given** multiple packages in the monorepo
**When** I configure ESLint
**Then** `packages/eslint-config` contains shared ESLint configurations
**And** All packages extend from appropriate shared config
**And** Rules include TypeScript-specific checks
**And** `pnpm lint` runs linting across all packages
**And** Zero lint errors on initial setup

---

#### Story 0.8: Create Docker Compose for Local Development

As a **developer**,
I want Docker Compose for local services,
So that I can run PostgreSQL and Redis locally without manual setup.

**Acceptance Criteria:**

**Given** the need for local development services
**When** I create Docker Compose configuration
**Then** `docker-compose.yml` defines PostgreSQL service
**And** Redis service is configured for caching and job queues
**And** Volumes persist data between restarts
**And** `docker-compose up -d` starts all services
**And** Services are accessible on standard ports

---

#### Story 0.9: Set Up Environment Configuration

As a **developer**,
I want environment variable management,
So that configuration is externalized and secure.

**Acceptance Criteria:**

**Given** multiple applications needing configuration
**When** I set up environment management
**Then** `.env.example` files document required variables
**And** `.env` files are gitignored
**And** Each app has its own `.env` with app-specific variables
**And** Shared variables are documented
**And** Environment validation fails fast on missing required variables

---

#### Story 0.10: Configure Jest Test Infrastructure

As a **developer**,
I want Jest configured for unit and integration testing,
So that I can write and run tests across all packages.

**Acceptance Criteria:**

**Given** the need for testing infrastructure
**When** I configure Jest
**Then** Jest is configured in each testable package
**And** TypeScript is supported via `ts-jest`
**And** Coverage reports are generated
**And** `pnpm test` runs all tests across packages
**And** Test database setup is documented

---

#### Story 0.11: Set Up GitHub Actions CI Pipeline

As a **developer**,
I want continuous integration via GitHub Actions,
So that code quality is verified on every pull request.

**Acceptance Criteria:**

**Given** the need for automated quality checks
**When** I configure GitHub Actions
**Then** `.github/workflows/ci.yml` defines the CI pipeline
**And** Pipeline runs: lint, typecheck, test, build
**And** Turborepo caching is utilized for faster builds
**And** PR checks block merge on failure
**And** Pipeline completes in under 10 minutes

---

#### Story 0.12: Scaffold Preact Widget Application

As a **developer**,
I want a Preact + Vite application in `apps/widget`,
So that I can build the embeddable chat widget with minimal bundle size.

**Acceptance Criteria:**

**Given** the monorepo structure exists
**When** I create the widget application
**Then** `apps/widget` contains a Preact + Vite application
**And** TypeScript strict mode is enabled
**And** Build output is optimized for production (<150KB)
**And** Shadow DOM setup is scaffolded
**And** `pnpm dev --filter=widget` starts the development server

---

### Epic 1: User Authentication & Account Management

#### Story 1.1: Configure Auth0 Application and API

As a **developer**,
I want Auth0 properly configured for the platform,
So that users can authenticate securely.

**Acceptance Criteria:**

**Given** an Auth0 tenant exists
**When** Auth0 is configured
**Then** Auth0 Application (SPA) is created for dashboard
**And** Auth0 API is created for backend authorization
**And** Callback URLs are configured for local and production
**And** Allowed origins include all deployment environments
**And** Configuration values are documented in `.env.example`

---

#### Story 1.2: Implement JWT Verification Strategy in NestJS

As a **backend developer**,
I want JWT tokens verified on every API request,
So that only authenticated users can access protected endpoints.

**Acceptance Criteria:**

**Given** Auth0 issues JWT tokens
**When** implementing JWT verification
**Then** `JwtStrategy` validates tokens against Auth0 JWKS
**And** Invalid tokens return 401 Unauthorized
**And** Expired tokens return 401 with clear message
**And** Malformed tokens are rejected
**And** Token audience and issuer are validated
**And** 9 test cases pass per Test Design specification

---

#### Story 1.3: Create AuthGuard for Protected Routes

As a **backend developer**,
I want an authentication guard for protected endpoints,
So that unauthenticated requests are blocked.

**Acceptance Criteria:**

**Given** JWT strategy is implemented
**When** creating the AuthGuard
**Then** `@UseGuards(AuthGuard)` decorator protects endpoints
**And** Guard extracts user info from validated token
**And** User context is available in request object
**And** Public endpoints can bypass guard with `@Public()` decorator
**And** Guard integrates with NestJS dependency injection

---

#### Story 1.4: Implement User Model and Database Schema

As a **backend developer**,
I want a User database model,
So that user information can be persisted and queried.

**Acceptance Criteria:**

**Given** Prisma is configured
**When** creating the User model
**Then** User table stores: id, email, name, role, organizationId, auth0Id
**And** Role enum includes: SUPER_ADMIN, ADMIN, CLIENT
**And** Foreign key to Organization is defined
**And** Unique constraint on email and auth0Id
**And** Migration creates the table successfully

---

#### Story 1.5: Create User Sync on First Login

As a **system**,
I want user records created automatically on first login,
So that Auth0 users are synced to our database.

**Acceptance Criteria:**

**Given** a user logs in via Auth0 for the first time
**When** their JWT is verified
**Then** User record is created if not exists
**And** Auth0 user ID is stored for future lookups
**And** Default role is assigned based on invitation
**And** Organization association is set from invitation
**And** Subsequent logins find existing user

---

#### Story 1.6: Implement User Invitation System

As a **Super Admin**,
I want to invite new users to the platform,
So that I can onboard new team members and clients.

**Acceptance Criteria:**

**Given** I am logged in as Super Admin
**When** I create an invitation via POST `/api/invitations`
**Then** invitation record is created with email, role, organizationId
**And** unique invitation token is generated
**And** invitation email is sent with signup link
**And** invitation expires after 7 days
**And** invitation status is tracked (pending, accepted, expired)

---

#### Story 1.7: Implement Invitation Acceptance Flow

As an **invited user**,
I want to accept my invitation and create an account,
So that I can access the platform.

**Acceptance Criteria:**

**Given** I received an invitation email
**When** I click the invitation link
**Then** I'm directed to Auth0 signup with pre-filled email
**And** after Auth0 signup, invitation is marked as accepted
**And** my user record is created with assigned role
**And** I'm redirected to the dashboard
**And** expired invitations show appropriate error

---

#### Story 1.8: Implement User Profile API

As a **user**,
I want to view and update my profile,
So that I can manage my account information.

**Acceptance Criteria:**

**Given** I am authenticated
**When** I call GET `/api/users/me`
**Then** my profile information is returned
**And** when I call PATCH `/api/users/me`
**Then** my display name is updated
**And** email cannot be changed (managed by Auth0)
**And** role cannot be self-modified

---

#### Story 1.9: Implement Dashboard Auth0 Integration

As a **dashboard developer**,
I want Auth0 React SDK integrated,
So that users can log in and out from the dashboard.

**Acceptance Criteria:**

**Given** the Next.js dashboard exists
**When** integrating Auth0
**Then** `@auth0/auth0-react` is configured
**And** Login button redirects to Auth0
**And** Logout clears session and redirects
**And** Access token is available for API calls
**And** Token refresh happens automatically

---

#### Story 1.10: Create Protected Dashboard Routes

As a **dashboard developer**,
I want routes protected based on authentication,
So that only logged-in users can access the dashboard.

**Acceptance Criteria:**

**Given** Auth0 React SDK is integrated
**When** user accesses protected route
**Then** unauthenticated users are redirected to login
**And** authenticated users see the page content
**And** loading state is shown during auth check
**And** `/login` and `/callback` are public routes

---

### Epic 2: Multi-Tenant Organization Management

#### Story 2.1: Implement Organization Model and Schema

As a **backend developer**,
I want an Organization database model,
So that tenant data can be stored and managed.

**Acceptance Criteria:**

**Given** Prisma is configured
**When** creating the Organization model
**Then** Organization table stores: id, name, createdAt, updatedAt
**And** One-to-many relationship with Users is defined
**And** One-to-many relationship with Agents is defined
**And** Migration creates the table successfully

---

#### Story 2.2: Create Organization CRUD API

As a **Super Admin**,
I want to manage organizations,
So that I can onboard and manage B2B clients.

**Acceptance Criteria:**

**Given** I am logged in as Super Admin
**When** I call POST `/api/organizations`
**Then** new organization is created
**And** GET `/api/organizations` returns all organizations
**And** GET `/api/organizations/:id` returns specific organization
**And** PATCH `/api/organizations/:id` updates organization
**And** Only Super Admin can perform these operations

---

#### Story 2.3: Implement Tenant Isolation Filter

As a **system**,
I want all queries filtered by organizationId,
So that tenants cannot access each other's data.

**Acceptance Criteria:**

**Given** ADR-006 specifies application-level filtering
**When** any Prisma query is executed
**Then** organizationId filter is applied automatically
**And** filter uses user's organizationId from JWT
**And** Super Admin can query across organizations
**And** pre-commit hook warns on queries missing organizationId

---

#### Story 2.4: Create RolesGuard for Authorization

As a **backend developer**,
I want role-based access control on endpoints,
So that users can only perform permitted actions.

**Acceptance Criteria:**

**Given** users have assigned roles
**When** accessing protected endpoints
**Then** `@Roles()` decorator specifies required roles
**And** RolesGuard checks user's role against requirements
**And** Insufficient permissions return 403 Forbidden
**And** Guard works with AuthGuard in correct order

---

#### Story 2.5: Implement "Evil Twin" Test Infrastructure

As a **developer**,
I want tenant isolation tests,
So that I can verify no cross-tenant data leakage.

**Acceptance Criteria:**

**Given** test infrastructure exists
**When** running tenant isolation tests
**Then** two test organizations are created (Org A, Org B)
**And** data is seeded for both organizations
**And** User from Org A cannot access Org B data
**And** Every resource type is tested
**And** Tests fail if any cross-tenant access succeeds

---

#### Story 2.6: Create Organization Membership Validation

As a **system**,
I want user-organization membership validated,
So that users can only access their assigned organization.

**Acceptance Criteria:**

**Given** a user belongs to an organization
**When** they make API requests
**Then** their organizationId is extracted from JWT
**And** requests for other organizations are blocked
**And** Admin users can see all organizations (read-only)
**And** Client users see only their organization

---

#### Story 2.7: Implement Organization Dashboard View

As an **Admin**,
I want to see all organizations in the dashboard,
So that I can monitor the platform.

**Acceptance Criteria:**

**Given** I am logged in as Admin or Super Admin
**When** I navigate to Organizations page
**Then** list of organizations is displayed
**And** each row shows: name, created date, agent count
**And** Client users do not see this page
**And** clicking an org navigates to its detail view

---

#### Story 2.8: Create Organization Context Provider

As a **dashboard developer**,
I want organization context available throughout the app,
So that components can access current organization info.

**Acceptance Criteria:**

**Given** user is authenticated
**When** dashboard loads
**Then** OrganizationProvider fetches user's organization
**And** `useOrganization()` hook returns org details
**And** Context updates if user switches organization (Admin)
**And** Loading and error states are handled

---

#### Story 2.9: Implement Team Management & Invitation UI

As an **Admin or Super Admin**,
I want a Team page in the dashboard to manage members and send invitations,
So that I can invite new users, view team members, and manage pending invitations.

**Acceptance Criteria:**

**Given** I am logged in as Admin or Super Admin
**When** I navigate to the Team page
**Then** I see a list of current team members with name, email, role, and joined date
**And** I see a list of pending invitations with email, status, sent date, and expiration
**And** I can invite a new member by entering their email and selecting a role
**And** invitation triggers the existing backend invitation API (POST `/api/invitations`)
**And** I can resend a pending invitation
**And** I can cancel a pending invitation
**And** I see success/error toast notifications for all actions
**And** the member list refreshes automatically after invitation acceptance
**And** Super Admin can invite Admin-level users (without organization context)
**And** Admin can invite Client Users to their organization
**And** the page uses TanStack Query for data fetching and cache invalidation
**And** the UI uses shadcn components (Table, Dialog, Button, Select, Toast)

**Dependencies:** Stories 1.6, 1.7, 1.11 (backend APIs), Story 2.8 (org context for org-scoped invites)

---

### Epic 3: Agent Creation & Configuration

#### Story 3.1: Implement Agent Model and Schema

As a **backend developer**,
I want an Agent database model,
So that chat agent configurations can be stored.

**Acceptance Criteria:**

**Given** Prisma is configured
**When** creating the Agent model
**Then** Agent table stores: id, publicId, name, status, organizationId
**And** publicId is unique 8-character URL-safe string
**And** Status enum includes: ACTIVE, INACTIVE
**And** Foreign key to Organization is defined
**And** Migration creates the table successfully

---

#### Story 3.2: Create Agent CRUD API

As an **agent owner**,
I want to manage my chat agents,
So that I can create and configure AI assistants.

**Acceptance Criteria:**

**Given** I am authenticated with appropriate role
**When** I call POST `/api/agents`
**Then** new agent is created with generated publicId
**And** GET `/api/agents` returns my organization's agents
**And** GET `/api/agents/:id` returns specific agent
**And** PATCH `/api/agents/:id` updates agent settings
**And** DELETE `/api/agents/:id` soft-deletes the agent

---

#### Story 3.3: Generate URL-Safe Public IDs

As a **system**,
I want unique public IDs for agents,
So that they can be referenced in embed codes without exposing internal IDs.

**Acceptance Criteria:**

**Given** an agent is being created
**When** generating the publicId
**Then** ID is 8 characters long
**And** ID uses URL-safe characters (nanoid)
**And** ID is unique across all agents
**And** Collision is retried automatically
**And** publicId cannot be changed after creation

---

#### Story 3.4: Implement Domain Allowlist Configuration

As an **agent owner**,
I want to configure allowed domains for my agent,
So that the widget only works on my authorized websites.

**Acceptance Criteria:**

**Given** I am editing an agent
**When** I configure allowed domains
**Then** domains are stored as array in agent config
**And** wildcard patterns are supported (*.example.com)
**And** localhost is always allowed in development
**And** empty list means widget works on any domain
**And** domains are validated for correct format

---

#### Story 3.5: Create AgentSecret Model for Sensitive Data

As a **backend developer**,
I want secure storage for agent secrets,
So that webhook URLs and API keys are protected.

**Acceptance Criteria:**

**Given** agents need webhook configuration
**When** creating the AgentSecret model
**Then** secrets are stored encrypted (AES-256)
**And** secrets table is separate from main agent table
**And** decryption happens only when needed
**And** encryption key is stored in environment variable
**And** migration creates the table successfully

---

#### Story 3.6: Implement Webhook URL Configuration

As an **agent owner**,
I want to configure a custom webhook URL for my agent,
So that chat messages are processed by my n8n workflow.

**Acceptance Criteria:**

**Given** I am editing an agent
**When** I set the webhook URL
**Then** URL is validated (HTTPS required in production)
**And** URL is encrypted before storage
**And** test button verifies webhook responds
**And** fallback to global webhook if not set
**And** URL change invalidates any cached config

---

#### Story 3.7: Create Agent Status Management

As an **agent owner**,
I want to activate/deactivate my agents,
So that I can control when they're available to users.

**Acceptance Criteria:**

**Given** I have an agent
**When** I change its status
**Then** PATCH `/api/agents/:id` accepts status change
**And** inactive agents return 503 from widget API
**And** status change is logged in audit trail
**And** dashboard shows clear status indicator
**And** bulk status change is not supported (one at a time)

---

#### Story 3.8: Implement Agent List Dashboard Page

As an **agent owner**,
I want to see all my agents in a list,
So that I can manage them from one place.

**Acceptance Criteria:**

**Given** I am logged in
**When** I navigate to Agents page
**Then** list shows all my organization's agents
**And** each row shows: name, status, created date
**And** clicking an agent opens its editor
**And** "Create Agent" button is visible
**And** empty state shows helpful message
**And** Admin users see agent count per organization
**And** Client users only see their organization's agents
**And** Client users do NOT see Integration or Prompt configuration sections

---

#### Story 3.9: Create Agent Detail/Edit Page

As an **agent owner**,
I want to view and edit agent details,
So that I can configure my agent's settings.

**Acceptance Criteria:**

**Given** I click on an agent
**When** the detail page loads
**Then** agent name and status are displayed
**And** allowed domains are editable
**And** webhook URL is editable (masked)
**And** save button persists changes
**And** cancel button discards changes
**And** Client users do NOT see Integration or Prompt configuration sections

---

### Epic 4: Widget Theme Editor & Customization

#### Story 4.1: Create AgentTheme Model and Schema

As a **backend developer**,
I want a theme configuration model,
So that widget appearance settings can be stored.

**Acceptance Criteria:**

**Given** Prisma is configured
**When** creating the AgentTheme model
**Then** theme table stores all 50+ configuration fields as JSONB
**And** one-to-one relationship with Agent is defined
**And** version field enables cache busting
**And** default values are defined for all fields
**And** migration creates the table successfully

---

#### Story 4.2: Create Theme API Endpoints

As an **agent owner**,
I want API endpoints for theme management,
So that I can save and retrieve theme configurations.

**Acceptance Criteria:**

**Given** an agent exists
**When** calling theme endpoints
**Then** GET `/api/agents/:id/theme` returns current theme
**And** PUT `/api/agents/:id/theme` saves entire theme
**And** PATCH `/api/agents/:id/theme` updates partial fields
**And** version is incremented on save
**And** ETag header is set for caching

---

#### Story 4.3: Implement Theme Editor Page Layout

As an **agent owner**,
I want a visual theme editor page,
So that I can customize my widget's appearance.

**Acceptance Criteria:**

**Given** I navigate to an agent's theme editor
**When** the page loads
**Then** 3-panel layout is displayed per legacy design
**And** left sidebar (256px) shows configuration categories
**And** center panel (flex-3) shows form inputs
**And** right panel (flex-2, min 450px) shows live preview
**And** main dashboard sidebar collapses to icons only

---

#### Story 4.4: Create FormSection Component

As a **dashboard developer**,
I want a reusable form section component,
So that theme settings are organized consistently.

**Acceptance Criteria:**

**Given** the theme editor needs organized forms
**When** using FormSection component
**Then** it accepts title and description props
**And** children are rendered in consistent layout
**And** sections are collapsible
**And** styling matches legacy FormSection.tsx pattern

---

#### Story 4.5: Create ColorPicker Component

As a **dashboard developer**,
I want a color picker component,
So that users can select colors for theme settings.

**Acceptance Criteria:**

**Given** many theme fields are colors
**When** using ColorPicker component
**Then** it displays color swatch with current value
**And** clicking opens color picker popover
**And** hex input allows manual entry
**And** 3-column grid layout per legacy pattern
**And** onChange callback returns hex color value

---

#### Story 4.6: Create TabGroup Component

As a **dashboard developer**,
I want a tab navigation component,
So that related settings can be grouped.

**Acceptance Criteria:**

**Given** theme categories need navigation
**When** using TabGroup component
**Then** it displays tabs as pill buttons
**And** active tab uses blue highlight (blue-600)
**And** tabs support icons
**And** onChange callback returns selected tab id
**And** styling matches legacy TabGroup.tsx pattern

---

#### Story 4.7: Implement General Settings Form

As an **agent owner**,
I want to configure general widget settings,
So that basic appearance is customized.

**Acceptance Criteria:**

**Given** I'm in the theme editor
**When** I select General tab
**Then** I can set widget position (left/right)
**And** I can set font family
**And** I can set default font size
**And** I can configure icon appearance
**And** changes reflect in live preview immediately

---

#### Story 4.8: Implement Header Settings Form

As an **agent owner**,
I want to customize the widget header,
So that it matches my brand.

**Acceptance Criteria:**

**Given** I'm in the theme editor
**When** I select Header settings
**Then** I can set header title and subtitle
**And** I can upload company logo
**And** I can set header background color
**And** I can set header text color
**And** I can set header border radius

---

#### Story 4.9: Implement Chat Appearance Settings Form

As an **agent owner**,
I want to customize chat message appearance,
So that conversations look branded.

**Acceptance Criteria:**

**Given** I'm in the theme editor
**When** I select Chat Appearance settings
**Then** I can set user message colors (bg, text, radius)
**And** I can set bot message colors (bg, text, radius)
**And** I can configure avatar styles (shape, color, image)
**And** I can toggle timestamp display
**And** I can set chat body background color

---

#### Story 4.10: Implement Behavior Settings Form

As an **agent owner**,
I want to configure widget behavior,
So that interactions work as expected.

**Acceptance Criteria:**

**Given** I'm in the theme editor
**When** I select Behavior settings
**Then** I can set greeting message
**And** I can configure conversational starters (up to 4)
**And** I can set bubble notification text and delay
**And** I can toggle typing indicator
**And** I can configure auto-open behavior

---

#### Story 4.11: Implement Live Preview Component

As an **agent owner**,
I want to see theme changes in real-time,
So that I know how my widget will look.

**Acceptance Criteria:**

**Given** I'm editing theme settings
**When** I change any value
**Then** preview updates immediately (no save required)
**And** preview shows minimized icon state
**And** preview shows expanded chat state
**And** preview shows sample messages
**And** preview is interactive (can click to expand/minimize)

---

#### Story 4.12: Implement Theme Save and Reset

As an **agent owner**,
I want to save or reset my theme changes,
So that I can commit or discard my edits.

**Acceptance Criteria:**

**Given** I've made theme changes
**When** I click Save
**Then** theme is persisted via API
**And** version is incremented
**And** success toast confirms save
**And** when I click Reset
**Then** form reverts to last saved state
**And** unsaved changes warning on page leave

---

#### Story 4.13: Implement Branding Settings Form

As an **agent owner**,
I want to configure widget branding,
So that attribution can be customized.

**Acceptance Criteria:**

**Given** I'm in the theme editor
**When** I select Branding settings
**Then** I can toggle branding visibility
**And** I can set branding text prefix
**And** I can choose logo or text link
**And** I can set link URL and text
**And** I can customize branding colors

---

#### Story 4.14: Supabase File Upload & Agent Editor Image Upload

As an **agent owner**,
I want to upload custom images (logos, icons, avatars) through the agent editor,
So that my widget can display branded imagery.

**Acceptance Criteria:**

**Given** the agent editor is open
**When** I click on an image upload area (header logo, icon image, bot avatar, user avatar, branding logo)
**Then** a file picker opens for image selection
**And** the image is uploaded to Supabase Storage
**And** the uploaded URL is stored in the theme config
**And** a generic File model tracks all uploads with metadata (filename, size, mime type, URL, entity reference)
**And** images are validated for type (JPEG, PNG, SVG, WebP, GIF) and size (max 5MB)

**Status:** Done
**Branch:** `feature/agent-editor-enhancements`
**PR:** #42

---

#### Story 4.15: Agent Editor UI Refinements

As an **agent owner**,
I want the theme editor form sections to be clean and well-styled,
So that the editing experience is intuitive and professional.

**Acceptance Criteria:**

**Given** the agent editor is open
**When** I view the Appearance or Chat Interface sections
**Then** ColorPicker displays as a 3-column grid with round swatches and hex input
**And** TabGroup uses blue active state buttons (bg-blue-600)
**And** FormSection is simplified (non-collapsible, consistent spacing)
**And** Header border radius field is available and updates the chat widget preview in real-time
**And** border radius is persisted in theme config (0-50 range, default 14)

**Status:** Done
**Branch:** `feature/agent-editor-enhancements`
**PR:** #42

---

#### Story 4.16: Agents Table Actions Column

As an **agent manager** (any role),
I want action buttons on each row of the agents table,
So that I can quickly edit, embed, demo, or delete agents.

**Acceptance Criteria:**

**Given** I'm viewing the agents list table
**When** I look at any agent row
**Then** I see inline icon buttons for Edit, Embed, Demo, and Delete
**And** Edit navigates to the agent editor page
**And** Embed opens a dialog with the embed code snippet and copy button
**And** Demo opens a public demo page in a new tab
**And** Delete opens a confirmation dialog requiring typing "DELETE" to confirm
**And** all actions are available to CLIENT, ADMIN, and SUPER_ADMIN roles
**And** successful delete shows a success toast and refreshes the table

**Status:** Done
**Branch:** `feature/agent-editor-enhancements`
**PR:** #42

---

#### Story 4.17: Public Agent Demo Page

As a **stakeholder or client**,
I want a shareable demo page to test an agent's chat interface,
So that I can preview the conversation experience without authentication.

**Acceptance Criteria:**

**Given** a valid agent ID
**When** I navigate to `/agents/demo/:agentId`
**Then** the page loads without requiring authentication (public route)
**And** the agent name, avatar initial, and online status are displayed in the header
**And** a welcome message is shown as the first bot message
**And** conversation starters from the theme config are displayed as clickable chip buttons
**And** clicking a starter sends it as a user message and triggers a simulated bot response
**And** I can type and send custom messages
**And** a typing indicator animation shows while the bot is "responding"
**And** the page shows "Agent not found" for inactive or non-existent agents
**And** the backend exposes `GET /public/agents/:id/demo` with `@Public()` decorator (no JWT)

**Status:** Done
**Branch:** `feature/agent-editor-enhancements`
**PR:** #42, #43

---

#### Story 4.18: Simplify Conversation Starters Schema

As an **agent owner**,
I want a single input field per conversation starter instead of separate "button text" and "message" fields,
So that the editing experience is simpler and more intuitive.

**Acceptance Criteria:**

**Given** I'm editing conversation starters in the Behavior tab
**When** I add a conversation starter
**Then** I see a single input field (the message is both the button label and the sent text)
**And** each starter has an 80-character maximum limit
**And** a character counter (e.g. "12/80") is displayed inside the input
**And** the schema validates `min(1).max(80)` per starter
**And** max 4 starters are allowed
**And** starters display correctly in the live preview and on the public demo page
**And** clicking a starter on the demo page sends the message successfully

**Status:** Done
**Branch:** `feature/agent-editor-enhancements`
**PR:** #43

---

### Epic 5: Embeddable Chat Widget

#### Story 5.1: Scaffold Preact + Vite Widget Application

As a **developer**,
I want a Preact + Vite application scaffold in `apps/widget`,
So that I can build the embeddable chat widget with optimal bundle size.

**Acceptance Criteria:**

**Given** the monorepo structure exists
**When** I create the widget application
**Then** `apps/widget` contains Vite + Preact configuration
**And** TypeScript strict mode is enabled
**And** Build output targets ES2020 for modern browsers
**And** `pnpm build` produces production bundle
**And** Bundle analyzer is configured for size monitoring

---

#### Story 5.2: Shadow DOM Initialization (Closed Mode)

As a **website owner**,
I want the widget to use Shadow DOM in closed mode,
So that my website styles don't affect the widget and vice versa.

**Acceptance Criteria:**

**Given** the widget script is loaded on a page
**When** the widget initializes
**Then** it creates a Shadow DOM root with `mode: 'closed'`
**And** all widget styles are scoped within the shadow root
**And** external CSS cannot penetrate the shadow boundary
**And** widget CSS cannot leak to the host page
**And** initialization completes in <50ms

---

#### Story 5.3: Widget Script Tag Initialization

As a **website owner**,
I want to embed the widget with a simple script tag,
So that I can add it to my website without complex setup.

**Acceptance Criteria:**

**Given** the embed code `<script src="https://cdn.example.com/widget.js" data-agent-id="xxx"></script>`
**When** the script loads on the page
**Then** it reads `data-agent-id` from the script tag
**And** fetches widget configuration from the API
**And** renders the widget in the specified position
**And** console logs helpful debug info in development mode
**And** fails gracefully with console warning if agent-id is missing

---

#### Story 5.4: Widget Configuration Loading with ETag Caching

As a **website visitor**,
I want the widget to load configuration efficiently,
So that repeat visits don't re-download unchanged data.

**Acceptance Criteria:**

**Given** the widget needs to fetch configuration
**When** it makes the API request
**Then** it includes `If-None-Match` header with cached ETag
**And** handles 304 Not Modified by using cached config
**And** handles 200 OK by caching new config + ETag
**And** stores config in localStorage with TTL
**And** falls back to cached config if API is unreachable
**And** total load time is <200ms on cache hit (NFR4)

---

#### Story 5.5: Theme CSS Variables Injection

As a **website visitor**,
I want the widget to display with the configured theme,
So that it matches the brand I'm interacting with.

**Acceptance Criteria:**

**Given** widget configuration is loaded
**When** the theme is applied
**Then** all 50+ theme properties are converted to CSS variables
**And** CSS variables are injected into the shadow root
**And** Components reference variables (e.g., `var(--cw-header-bg)`)
**And** Theme changes apply without reload in preview mode
**And** Invalid color values fall back to defaults

---

#### Story 5.6: Minimized Widget Icon State

As a **website visitor**,
I want to see a chat icon when the widget is closed,
So that I know chat support is available.

**Acceptance Criteria:**

**Given** the widget is in minimized state
**When** the page loads
**Then** only the floating icon is visible (64×64px default)
**And** icon uses configured background color and border radius
**And** icon position follows `iconPosition` setting (left/right)
**And** icon has hover scale animation (1.1x)
**And** clicking the icon opens the chat window

---

#### Story 5.7: Bubble Notification Display

As a **website visitor**,
I want to see a greeting bubble near the chat icon,
So that I'm encouraged to start a conversation.

**Acceptance Criteria:**

**Given** bubble notification is enabled in config
**When** the widget is in minimized state
**Then** bubble appears above/beside the icon after configured delay
**And** bubble displays configured greeting text
**And** bubble uses configured colors and border radius
**And** bubble has a close (X) button
**And** clicking the bubble opens the chat window
**And** bubble respects `showBubble` configuration

---

#### Story 5.8: Expanded Chat Window State

As a **website visitor**,
I want to open the full chat interface,
So that I can have a conversation with the AI agent.

**Acceptance Criteria:**

**Given** the widget icon is clicked
**When** the chat window opens
**Then** window animates from icon position (300ms ease-out)
**And** window displays at configured size (380×520px default)
**And** header shows agent name, subtitle, and logo
**And** minimize and close buttons are functional
**And** message area is scrollable
**And** input field is focused automatically

---

#### Story 5.9: Chat Message Display

As a **website visitor**,
I want to see my messages and AI responses clearly,
So that I can follow the conversation.

**Acceptance Criteria:**

**Given** the chat window is open
**When** messages are exchanged
**Then** user messages appear on the right with user avatar
**And** AI messages appear on the left with bot avatar
**And** messages use configured colors and border radii
**And** timestamps display if enabled in config
**And** messages auto-scroll to show latest
**And** long messages wrap properly without overflow

---

#### Story 5.10: Conversational Starters Display

As a **website visitor**,
I want to see suggested conversation starters,
So that I know what I can ask the agent.

**Acceptance Criteria:**

**Given** the chat window opens with only the welcome message
**When** conversational starters are configured
**Then** up to 4 starter buttons appear below the welcome message
**And** buttons use system message styling
**And** clicking a starter sends it as a user message
**And** starters disappear after the first user message
**And** starters handle long text with truncation

---

#### Story 5.11: Typing Indicator Animation

As a **website visitor**,
I want to see when the AI is preparing a response,
So that I know my message was received.

**Acceptance Criteria:**

**Given** a user message is sent
**When** waiting for the AI response
**Then** typing indicator appears with bot avatar
**And** three dots animate with staggered bounce
**And** indicator disappears when response arrives
**And** indicator times out after 30 seconds with error message

---

#### Story 5.12: CORS Domain Validation

As an **agent owner**,
I want the widget to only work on my allowed domains,
So that others cannot embed my agent without permission.

**Acceptance Criteria:**

**Given** widget configuration includes `allowedDomains` list
**When** the widget initializes on a page
**Then** current domain is checked against allowed list
**And** wildcard patterns are supported (e.g., `*.example.com`)
**And** widget renders normally if domain is allowed
**And** widget shows "Unauthorized domain" error if not allowed
**And** localhost is always allowed in development mode

---

#### Story 5.13: Widget Window Minimized State

As a **website visitor**,
I want to minimize the chat window without closing it,
So that I can continue browsing while keeping my conversation.

**Acceptance Criteria:**

**Given** the chat window is open
**When** I click the minimize button
**Then** window collapses to header-only view (80px height)
**And** conversation state is preserved
**And** clicking header expands back to full size
**And** close button still works from minimized state
**And** animation is smooth (300ms transition)

---

#### Story 5.14: Bundle Size Optimization

As a **website owner**,
I want the widget bundle to be under 150KB,
So that it doesn't slow down my website.

**Acceptance Criteria:**

**Given** the widget is built for production
**When** I check the bundle size
**Then** total gzipped size is under 150KB (NFR10)
**And** main chunk is under 100KB
**And** no unused code is included (tree-shaking verified)
**And** Preact is used instead of React
**And** bundle analyzer report is generated

---

### Epic 6: Chat Conversation Experience

#### Story 6.1: Chat Session Creation API

As a **widget**,
I want to create a new chat session when a user starts chatting,
So that messages are grouped and tracked properly.

**Acceptance Criteria:**

**Given** a user opens the chat widget and sends first message
**When** the widget calls POST `/api/chat/sessions`
**Then** a new ChatSession record is created with unique ID
**And** session is linked to the agent via agentId
**And** deviceId is stored for user identification
**And** session metadata includes userAgent, referrerUrl
**And** createdAt timestamp is recorded
**And** session ID is returned to the widget

---

#### Story 6.2: Device ID Generation and Persistence

As a **website visitor**,
I want a persistent device ID across sessions,
So that my conversation history can be retrieved on return visits.

**Acceptance Criteria:**

**Given** a user visits a page with the chat widget
**When** the widget initializes
**Then** it checks localStorage for existing device ID
**And** generates new UUID v4 if none exists
**And** stores device ID in localStorage (`cw_device_{agentId}`)
**And** includes device ID in all API requests
**And** device ID survives browser restarts

---

#### Story 6.3: Send Message API Endpoint

As a **widget**,
I want to send user messages to the backend,
So that they can be processed and responded to by the AI.

**Acceptance Criteria:**

**Given** a user types a message and clicks send
**When** the widget calls POST `/api/chat/messages`
**Then** message is validated (non-empty, max 4000 chars)
**And** message is stored in ChatMessage table
**And** message is associated with session and agent
**And** AI processing is triggered asynchronously
**And** message ID is returned immediately
**And** rate limiting is enforced (10 messages/minute)

---

#### Story 6.4: SSE Streaming Response Endpoint

As a **widget**,
I want to receive AI responses via Server-Sent Events,
So that users see responses as they're generated.

**Acceptance Criteria:**

**Given** a message is sent to the AI
**When** the backend receives chunks from n8n
**Then** each chunk is streamed via SSE to the widget
**And** SSE connection uses `text/event-stream` content type
**And** chunks are sent as `data: {json}\n\n` format
**And** final chunk includes `event: done`
**And** connection timeout is 30 seconds
**And** errors are sent as `event: error`

---

#### Story 6.5: Widget Message Input and Send

As a **website visitor**,
I want to type messages and send them easily,
So that I can communicate with the chat agent.

**Acceptance Criteria:**

**Given** the chat window is open
**When** I type in the input field
**Then** text appears in the input
**And** Enter key sends the message (Shift+Enter for newline)
**And** Send button is clickable and sends message
**And** Input clears after sending
**And** Input is disabled while waiting for response
**And** Empty messages cannot be sent

---

#### Story 6.6: Streaming Response Display

As a **website visitor**,
I want to see AI responses appear word by word,
So that I get immediate feedback and the experience feels natural.

**Acceptance Criteria:**

**Given** an AI response is streaming
**When** chunks arrive via SSE
**Then** text appears incrementally in the message bubble
**And** cursor/caret animation shows active streaming
**And** message bubble grows smoothly as text adds
**And** auto-scroll keeps new content visible
**And** final state removes streaming indicator

---

#### Story 6.7: Conversation History Loading

As a **returning visitor**,
I want to see my previous messages when I reopen the widget,
So that I can continue our conversation.

**Acceptance Criteria:**

**Given** a user has an existing session with messages
**When** they reopen the widget
**Then** previous messages are loaded from API
**And** maximum 40 messages are displayed (most recent)
**And** older messages show "Load more" option
**And** messages display in chronological order
**And** loading state is shown while fetching

---

#### Story 6.8: Session Inactivity Window Management

As a **system**,
I want to expire sessions after 6 hours of inactivity,
So that conversations don't span unreasonably long periods.

**Acceptance Criteria:**

**Given** a chat session exists
**When** 6 hours pass without any messages
**Then** next message creates a new session
**And** old session is marked as `expired`
**And** user sees fresh conversation start
**And** previous session history remains accessible via API

---

#### Story 6.9: Welcome Message Display

As a **website visitor**,
I want to see a greeting when I open the chat,
So that I know how to start the conversation.

**Acceptance Criteria:**

**Given** a new chat session starts
**When** the widget opens for first time
**Then** welcome message from theme config is displayed
**And** message appears as system/bot message
**And** message is NOT stored as a ChatMessage record
**And** timestamp shows current time
**And** conversational starters appear below (if configured)

---

#### Story 6.10: HTML Sanitization for Messages

As a **website owner**,
I want all message content sanitized,
So that XSS attacks are prevented.

**Acceptance Criteria:**

**Given** a message contains HTML or script content
**When** it is displayed in the widget
**Then** HTML tags are escaped or stripped
**And** `<script>` tags are completely removed
**And** event handlers (`onclick`, etc.) are stripped
**And** URLs are not auto-linked (plain text only)
**And** markdown is NOT rendered (plain text display)

---

#### Story 6.11: Auto-Scroll Behavior

As a **website visitor**,
I want the chat to auto-scroll to show new messages,
So that I don't miss any part of the conversation.

**Acceptance Criteria:**

**Given** messages are in the chat window
**When** a new message arrives
**Then** view scrolls to show the new message
**And** user's last message stays visible with AI reply below
**And** manual scroll up disables auto-scroll
**And** scrolling to bottom re-enables auto-scroll
**And** smooth scroll animation is used

---

#### Story 6.12: Message Timestamp Display

As a **website visitor**,
I want to see when messages were sent,
So that I understand the conversation timeline.

**Acceptance Criteria:**

**Given** timestamps are enabled in theme config
**When** messages are displayed
**Then** each message shows time (HH:MM format)
**And** timestamp uses configured color
**And** timestamp appears below message bubble
**And** timestamps are optional (theme setting)

---

#### Story 6.13: Error Message Handling

As a **website visitor**,
I want to see friendly error messages when something goes wrong,
So that I know what happened and what to do next.

**Acceptance Criteria:**

**Given** an error occurs (network, timeout, server error)
**When** the error is caught
**Then** a user-friendly error message is displayed
**And** message appears as system message
**And** retry option is provided for transient errors
**And** technical details are logged to console (not shown to user)
**And** widget remains usable after error

---

#### Story 6.14: Chat Message Storage

As a **system**,
I want all messages persisted to the database,
So that conversation history is available and analytics can be generated.

**Acceptance Criteria:**

**Given** a message is sent or received
**When** the message is processed
**Then** ChatMessage record is created
**And** record includes: sessionId, role, content, timestamp
**And** AI messages include response metadata (latency, tokens)
**And** messages are linked to organization via session
**And** messages are queryable for analytics

---

### Epic 7: AI Provider Integration & Abstraction

#### Story 7.1: AI Service Abstraction Interface

As a **developer**,
I want a provider-agnostic AI service interface,
So that we can switch AI providers without changing consuming code.

**Acceptance Criteria:**

**Given** the need for AI provider flexibility (ADR-007)
**When** I define the AI service abstraction
**Then** interface defines `sendMessage(context, message): AsyncGenerator<string>`
**And** interface defines `buildSystemPrompt(agent): string`
**And** interface is implemented as NestJS injectable service
**And** provider selection is configurable per-agent
**And** all providers implement the same interface

---

#### Story 7.2: n8n Webhook Provider Implementation

As a **system**,
I want to call n8n webhooks for AI processing,
So that agents can use n8n workflows for their AI logic.

**Acceptance Criteria:**

**Given** an agent has n8n webhook URL configured
**When** a message is sent to the AI
**Then** POST request is made to the webhook URL
**And** request includes: message, sessionId, agentId, systemPrompt
**And** request includes conversation history (last 10 messages)
**And** request timeout is 10 seconds (configurable)
**And** response is parsed from n8n format

---

#### Story 7.3: Multiple Response Format Parsing

As a **system**,
I want to handle various n8n response formats,
So that different n8n workflow configurations work seamlessly.

**Acceptance Criteria:**

**Given** n8n can return responses in different formats
**When** parsing the response
**Then** `response.agentReply` is checked first
**And** `response.output` is checked second
**And** `response.ai_message.content` is checked third
**And** `response.text` is checked as fallback
**And** plain string response is handled
**And** error is thrown if no valid content found

---

#### Story 7.4: System Prompt Builder

As an **agent owner**,
I want system prompts built from my agent configuration,
So that the AI behaves according to my settings.

**Acceptance Criteria:**

**Given** an agent with theme configuration
**When** building the system prompt
**Then** base prompt from `systemPromptTemplate` is used
**And** agent name is injected
**And** personality traits are included
**And** response guidelines are added
**And** language preferences are incorporated
**And** custom instructions from agent config are appended

---

#### Story 7.5: Conversation Context Building

As a **system**,
I want to include conversation history in AI requests,
So that the AI has context for coherent responses.

**Acceptance Criteria:**

**Given** a chat session with message history
**When** preparing the AI request
**Then** last 10 messages are included as context
**And** messages are formatted as role/content pairs
**And** system prompt is separate from conversation
**And** total token estimate is calculated
**And** oldest messages are trimmed if context too long

---

#### Story 7.6: SSE Response Streaming from Backend

As a **widget**,
I want to receive AI responses as they're generated,
So that users see immediate feedback.

**Acceptance Criteria:**

**Given** an AI provider returns a streaming response
**When** the backend processes it
**Then** chunks are forwarded to client via SSE
**And** each chunk is a valid SSE event
**And** connection remains open until complete
**And** `event: done` signals completion
**And** partial responses are usable if connection drops

---

#### Story 7.7: Request Timeout Handling

As a **system**,
I want AI requests to timeout gracefully,
So that users aren't left waiting indefinitely.

**Acceptance Criteria:**

**Given** an AI request is made
**When** no response is received within timeout
**Then** request is aborted after 10 seconds (default)
**And** timeout is configurable per-agent (5-30 seconds)
**And** user receives friendly timeout message
**And** timeout event is logged with request details
**And** partial response (if any) is still delivered

---

#### Story 7.8: AI Error Handling and Fallback Messages

As a **website visitor**,
I want to see helpful messages when AI fails,
So that I'm not confused by technical errors.

**Acceptance Criteria:**

**Given** an AI request fails
**When** displaying the error to user
**Then** network errors show "Connection issue, please try again"
**And** timeout errors show "Response taking too long, please retry"
**And** rate limit errors show "Too many requests, please wait"
**And** server errors show "Something went wrong, please try again"
**And** actual error is logged server-side with correlation ID

---

#### Story 7.9: Per-Agent Webhook Configuration

As an **agent owner**,
I want to configure a custom webhook URL for my agent,
So that I can use my own n8n workflow.

**Acceptance Criteria:**

**Given** I'm editing my agent configuration
**When** I set a custom webhook URL
**Then** URL is validated (HTTPS required in production)
**And** URL is stored encrypted in AgentSecret
**And** test button verifies webhook is reachable
**And** default platform webhook is used if none configured
**And** webhook URL change triggers cache invalidation

---

#### Story 7.10: AI Response Metadata Extraction

As a **system**,
I want to extract metadata from AI responses,
So that we can track usage and performance.

**Acceptance Criteria:**

**Given** an AI response is received
**When** processing the response
**Then** response latency is calculated and stored
**And** token count is extracted if provided
**And** model name is extracted if provided
**And** metadata is attached to ChatMessage record
**And** metrics are available for analytics

---

#### Story 7.11: AI Service Health Check

As a **system**,
I want to monitor AI provider health,
So that we can fail fast and alert on issues.

**Acceptance Criteria:**

**Given** the AI service is running
**When** health check is performed
**Then** default n8n endpoint is pinged
**And** response time is measured
**And** failure is logged with alert
**And** circuit breaker opens after 3 consecutive failures
**And** circuit breaker closes after 30 seconds

---

#### Story 7.12: Conversation Memory Limit

As a **system**,
I want to limit conversation context size,
So that AI requests stay within token limits.

**Acceptance Criteria:**

**Given** a long conversation session
**When** building context for AI request
**Then** maximum 10 message pairs are included
**And** system prompt + context fits within 8000 tokens
**And** oldest messages are dropped first
**And** conversation continues seamlessly despite trimming
**And** user is not notified of context trimming

---

### Epic 8: Analytics Dashboard & KPIs (REFINED 2026-03-03)

> **Refinement notes:** Scope reduced from 14 to 10 KPIs. Deferred: Languages Used, Most Popular Topics (AI categorization), Unresolved Queries, Fallback Rate, User Satisfaction Score, Conversation Completion Rate. Details in `_bmad-output/implementation-artifacts/epic-8-deferred-kpis.md`.
> **Added:** Seed data script, role-based analytics access (Super Admin/Admin: all orgs | Client: own org), agent filter.

#### Story 8.0: Analytics Schema Changes & Seed Data Script

As a **developer**,
I want the schema extended for analytics tracking and a seed script that populates realistic data,
So that analytics queries work correctly and the dashboard can be demoed to clients.

**Acceptance Criteria:**

**Schema Changes:**

**Given** the analytics epic requires user tracking and multi-channel support
**When** the migration runs
**Then** `ChatSource` enum is extended with `WHATSAPP` value
**And** `visitorId` (String, nullable) field is added to `ChatSession` — stores IP address (web/widget) or phone number (WhatsApp)
**And** index is added on `visitorId` for unique user queries
**And** existing data is unaffected (visitorId defaults to null for old sessions)

**Seed Data:**

**Given** the seed script is executed
**When** it completes
**Then** multiple organizations have seeded data
**And** each org has 2-5 agents with varied activity levels
**And** ChatSessions are created with `source: 'WIDGET'` and realistic `visitorId` values across 90 days
**And** ChatMessages have realistic patterns (varied responseLatencyMs in metadata, message lengths, hours of activity)
**And** Data varies per bot (some high-volume, some low, different peak hours)
**And** Returning visitors are seeded (same visitorId across multiple sessions for retention KPI)
**And** Script is idempotent (safe to re-run, cleans up previous seed data)
**And** Script is runnable via `bun run seed:analytics`

---

#### Story 8.1: Analytics API Endpoints

As a **dashboard**,
I want API endpoints for analytics data,
So that I can fetch and display metrics.

**Acceptance Criteria:**

**Given** authenticated user with valid organization
**When** calling GET `/api/analytics/summary`
**Then** KPI summary data is returned for the 10 buildable KPIs
**And** Super Admin/Admin see all orgs (can filter by orgId)
**And** Client users see only their org's data
**And** date range query params are respected (startDate, endDate)
**And** optional agentId filter scopes to specific bot
**And** response includes trend data (% change vs previous period)
**And** cache headers enable client caching (5 min)

**Given** authenticated user
**When** calling GET `/api/analytics/charts/conversations`
**Then** daily conversation counts are returned for the date range

**Given** authenticated user
**When** calling GET `/api/analytics/charts/response-times`
**Then** response time distribution buckets are returned

**Given** authenticated user
**When** calling GET `/api/analytics/charts/message-volume`
**Then** hourly message volume data is returned (for heatmap)

**Given** authenticated user
**When** calling GET `/api/analytics/agents`
**Then** per-agent metrics table data is returned

---

#### Story 8.2: Analytics Dashboard Page Layout

As an **agent owner**,
I want a dedicated analytics page in the dashboard,
So that I can view all my chat performance metrics.

**Acceptance Criteria:**

**Given** I navigate to the Analytics page
**When** the page loads
**Then** page displays KPI summary cards at the top
**And** date range selector is visible (7/14/30 days + custom)
**And** agent filter dropdown allows scoping to a specific bot
**And** charts section shows trend visualizations below KPIs
**And** agent breakdown table is shown at the bottom
**And** loading skeletons are shown while data fetches
**And** Super Admin/Admin see org filter dropdown
**And** Client users see only their org's data (no org filter)

---

#### Story 8.3: KPI Summary Cards Component

As an **agent owner**,
I want to see key metrics at a glance,
So that I quickly understand my overall performance.

**Acceptance Criteria:**

**Given** the analytics page loads
**When** KPI data is available
**Then** KPI cards are displayed showing:
  - Total Users (new vs returning)
  - Total Conversations
  - Total Messages (sent + received)
  - Avg Response Time
  - User Retention Rate
  - User Growth Rate
**And** each card shows: metric name, current value, trend indicator (% change vs previous period)
**And** positive trends are green, negative are red, neutral is gray
**And** cards are responsive (grid layout adapts to screen size)

---

#### Story 8.4: Date Range Filter Component

As an **agent owner**,
I want to filter analytics by date range,
So that I can analyze specific time periods.

**Acceptance Criteria:**

**Given** the date range selector is visible
**When** I select a preset (7/14/30 days)
**Then** all KPIs and charts update to reflect the selected range
**And** "Last 7 days" is the default selection
**And** custom date range picker is available
**And** selected range persists during session
**And** URL updates with date params for shareability

---

#### Story 8.5: Conversations Over Time Chart

As an **agent owner**,
I want to see conversation trends over time,
So that I can identify patterns and growth.

**Acceptance Criteria:**

**Given** the charts section loads
**When** data is available
**Then** line chart shows conversations per day
**And** X-axis shows dates, Y-axis shows count
**And** hover tooltip shows exact values
**And** chart is responsive to container width
**And** empty state shows "No data for this period"

---

#### Story 8.6: Response Time Distribution Chart

As an **agent owner**,
I want to see how fast my agents respond,
So that I can ensure good user experience.

**Acceptance Criteria:**

**Given** response time data exists
**When** the chart renders
**Then** bar chart shows response time buckets
**And** buckets: <1s, 1-2s, 2-5s, 5-10s, >10s
**And** bars are color-coded (green to red gradient)
**And** percentage of responses in each bucket is shown
**And** P50, P95, P99 values are displayed as annotations

---

#### Story 8.7: Message Volume by Hour Heatmap

As an **agent owner**,
I want to see when users are most active,
So that I can optimize agent availability.

**Acceptance Criteria:**

**Given** message data exists
**When** the heatmap renders
**Then** grid shows days (rows) vs hours (columns)
**And** cell color intensity reflects message volume
**And** hover shows exact count for each cell
**And** legend shows color scale
**And** peak hours are highlighted

---

#### Story 8.8: Per-Agent Analytics Table

As an **agent owner**,
I want to compare performance across my agents,
So that I can identify which agents need improvement.

**Acceptance Criteria:**

**Given** I have multiple agents
**When** the agent table loads
**Then** table shows one row per agent
**And** columns: Agent Name, Conversations, Messages, Avg Response Time, Queries Raised
**And** table is sortable by any column
**And** clicking agent name navigates to agent detail
**And** pagination handles >10 agents

---

#### Story 8.9: Real-Time KPI Polling

As an **agent owner**,
I want KPIs to update without page refresh,
So that I see current data while monitoring.

**Acceptance Criteria:**

**Given** the analytics page is open
**When** new data arrives
**Then** KPI values update every 60 seconds via polling
**And** update animation highlights changed values
**And** no full page reload required
**And** polling pauses when browser tab is inactive
**And** polling resumes when tab becomes active

---

#### Story 8.10: Analytics Empty State

As a **new user**,
I want helpful guidance when I have no analytics data,
So that I understand how to get started.

**Acceptance Criteria:**

**Given** no analytics data exists for the period
**When** the analytics page loads
**Then** empty state illustration is shown
**And** message explains "Start chatting to see analytics"
**And** link to create first agent is provided
**And** sample data preview is NOT shown (avoid confusion)

---

#### Story 8.11: Export Analytics Data

As an **agent owner**,
I want to export my analytics data,
So that I can analyze it in external tools.

**Acceptance Criteria:**

**Given** analytics data is displayed
**When** I click "Export" button
**Then** dropdown shows format options (CSV, JSON)
**And** export includes all visible data for selected range
**And** file downloads with descriptive filename
**And** export action is logged in audit trail

---

### Epic 9: Event Tracking & Usage Monitoring

#### Story 9.1: UsageEvent Database Model

As a **system**,
I want a flexible event storage model,
So that all types of user interactions can be tracked.

**Acceptance Criteria:**

**Given** the need to track various event types
**When** the UsageEvent table is created
**Then** it stores: eventType, agentId, sessionId, deviceId, timestamp
**And** metadata JSONB field stores event-specific data
**And** organizationId enables tenant isolation
**And** indexes exist on agentId, sessionId, timestamp
**And** retention policy is documentable (90 days default)

---

#### Story 9.2: Widget Event Tracking API

As a **widget**,
I want to send interaction events to the backend,
So that user behavior can be analyzed.

**Acceptance Criteria:**

**Given** the widget is loaded and user interacts
**When** POST `/api/events` is called
**Then** event is validated (type, agentId required)
**And** event is stored in UsageEvent table
**And** timestamp is server-generated (not client)
**And** deviceId and sessionId are associated
**And** response returns 202 Accepted (async processing)

---

#### Story 9.3: Widget Opened Event

As a **system**,
I want to track when users open the chat widget,
So that I can measure engagement.

**Acceptance Criteria:**

**Given** a user clicks the widget icon or bubble
**When** the chat window opens
**Then** `widget_opened` event is sent
**And** metadata includes: referrerUrl, userAgent, screenSize
**And** event is correlated with sessionId
**And** duplicate opens within 1 second are deduplicated
**And** first open of session is flagged

---

#### Story 9.4: Widget Closed/Minimized Events

As a **system**,
I want to track when users close or minimize the widget,
So that I can understand session patterns.

**Acceptance Criteria:**

**Given** a user interacts with window controls
**When** they click close (X) button
**Then** `widget_closed` event is sent with durationMs
**And** when they click minimize button
**Then** `widget_minimized` event is sent
**And** metadata includes messagesExchanged count
**And** final state (closed vs minimized) is recorded

---

#### Story 9.5: Message Sent/Received Events

As a **system**,
I want to track all messages exchanged,
So that I can analyze conversation patterns.

**Acceptance Criteria:**

**Given** messages are exchanged in a session
**When** a user sends a message
**Then** `message_sent` event is recorded with messageLength
**And** when AI responds
**Then** `message_received` event is recorded with responseTimeMs
**And** both events reference the messageId
**And** conversation turn number is tracked

---

#### Story 9.6: User Satisfaction Rating Event

As a **system**,
I want to track when users rate their experience,
So that I can measure satisfaction.

**Acceptance Criteria:**

**Given** a user submits a satisfaction rating
**When** `rating_submitted` event is sent
**Then** rating value (1-5) is stored in metadata
**And** event is linked to sessionId
**And** optional feedback text is included
**And** only one rating per session is accepted
**And** timestamp records when rating was given

---

#### Story 9.7: Bulk Event Ingestion API

As a **widget**,
I want to batch multiple events in one request,
So that network calls are minimized.

**Acceptance Criteria:**

**Given** multiple events occur in quick succession
**When** POST `/api/events/bulk` is called
**Then** up to 50 events are accepted in one request
**And** each event is validated individually
**And** partial success is supported (some valid, some invalid)
**And** response indicates success/failure per event
**And** total processing time is logged

---

#### Story 9.8: Error Event Tracking

As a **system**,
I want to track errors that occur in the widget,
So that issues can be diagnosed.

**Acceptance Criteria:**

**Given** an error occurs in the widget
**When** `error_occurred` event is sent
**Then** error type and message are recorded
**And** stack trace is included (truncated to 2000 chars)
**And** widget state at error time is captured
**And** correlation ID links to any API error
**And** error is also reported to Sentry

---

#### Story 9.9: Telemetry Extraction from AI Responses

As a **system**,
I want to extract telemetry from AI responses,
So that I can track AI performance metrics.

**Acceptance Criteria:**

**Given** an AI response is received
**When** processing the response
**Then** token count is extracted if present
**And** model identifier is recorded
**And** response latency is calculated
**And** finish reason is captured (complete, truncated, error)
**And** telemetry is stored as UsageEvent

---

#### Story 9.10: Event Correlation with Sessions

As a **system**,
I want all events linked to their session,
So that I can reconstruct user journeys.

**Acceptance Criteria:**

**Given** events are recorded for a session
**When** querying events by sessionId
**Then** all related events are returned chronologically
**And** session timeline can be reconstructed
**And** gaps in event sequence are identifiable
**And** cross-device sessions are linked via deviceId
**And** query is performant (<100ms for 1000 events)

---

#### Story 9.11: Event Retention and Cleanup

As a **system**,
I want old events automatically cleaned up,
So that storage doesn't grow unbounded.

**Acceptance Criteria:**

**Given** events older than retention period
**When** cleanup job runs (daily)
**Then** events older than 90 days are deleted
**And** aggregated summaries are preserved
**And** deletion is batched (1000 records at a time)
**And** job runs during low-traffic hours
**And** cleanup is logged for audit

---

#### Story 9.12: Event Debugging Dashboard (Admin)

As an **admin**,
I want to view raw events for troubleshooting,
So that I can diagnose user issues.

**Acceptance Criteria:**

**Given** I'm a Super Admin or Admin
**When** I access the event viewer
**Then** I can search events by sessionId, deviceId, agentId
**And** events are displayed chronologically
**And** I can filter by event type and date range
**And** event metadata is expandable
**And** this view is NOT accessible to Client users

---

### Epic 10: Voice & Multi-Language Support

#### Story 10.1: Voice Feature Toggle (Agent Config)

As an **agent owner**,
I want to enable/disable voice features per agent,
So that I can control which agents support voice.

**Acceptance Criteria:**

**Given** I'm editing an agent's configuration
**When** I toggle "Enable Voice Features"
**Then** voice setting is saved to agent config
**And** widget shows/hides voice button accordingly
**And** disabled agents don't load voice libraries (saves bundle size)
**And** setting persists across sessions

---

#### Story 10.2: Voice Input Button UI

As a **website visitor**,
I want a microphone button in the chat input,
So that I can speak instead of typing.

**Acceptance Criteria:**

**Given** voice is enabled for the agent
**When** the chat input area renders
**Then** microphone icon appears next to send button
**And** button indicates idle/listening/processing states
**And** button uses theme colors
**And** button is accessible (aria labels)
**And** button is hidden if voice is disabled

---

#### Story 10.3: Browser Microphone Permission Request

As a **website visitor**,
I want to grant microphone access when I use voice,
So that my speech can be captured.

**Acceptance Criteria:**

**Given** I click the voice button for the first time
**When** microphone permission is requested
**Then** browser permission prompt appears
**And** granted permission is remembered
**And** denied permission shows helpful message
**And** user can retry after changing browser settings
**And** permission state is checked before each use

---

#### Story 10.4: Speech-to-Text (STT) Integration

As a **website visitor**,
I want my speech converted to text,
So that I can send messages by speaking.

**Acceptance Criteria:**

**Given** microphone access is granted
**When** I speak into the microphone
**Then** audio is captured and sent for transcription
**And** transcription returns within 500ms (NFR7)
**And** text appears in input field
**And** I can edit text before sending
**And** continuous speech is supported (not just single phrases)

---

#### Story 10.5: Voice Recording Indicator

As a **website visitor**,
I want to see when recording is active,
So that I know the system is listening.

**Acceptance Criteria:**

**Given** recording is in progress
**When** I'm speaking
**Then** visual indicator shows recording state
**And** audio waveform or level meter is displayed
**And** recording duration is shown
**And** I can stop recording by clicking button again
**And** max recording length is 60 seconds

---

#### Story 10.6: Text-to-Speech (TTS) Integration

As a **website visitor**,
I want AI responses read aloud,
So that I can listen instead of reading.

**Acceptance Criteria:**

**Given** TTS is enabled for the agent
**When** an AI response arrives
**Then** audio is synthesized and played
**And** synthesis starts within 300ms (NFR8)
**And** audio uses selected voice/language
**And** speaker icon indicates playing state
**And** I can pause/stop playback

---

#### Story 10.7: Language Detection (Automatic)

As a **system**,
I want to detect the user's language automatically,
So that responses can be in their preferred language.

**Acceptance Criteria:**

**Given** a user sends a message
**When** the message is analyzed
**Then** language is detected (en, hi, mr, hinglish)
**And** detection confidence score is recorded
**And** low-confidence defaults to agent's primary language
**And** detected language is passed to AI provider
**And** language is stored for analytics

---

#### Story 10.8: Language Preference Persistence

As a **website visitor**,
I want my language preference remembered,
So that I don't have to set it each visit.

**Acceptance Criteria:**

**Given** I've used a specific language
**When** I return to the widget
**Then** my language preference is restored
**And** preference is stored in localStorage
**And** preference can be changed via language selector
**And** preference persists per-agent (not global)

---

#### Story 10.9: Language Selector UI

As a **website visitor**,
I want to choose my preferred language,
So that I can override automatic detection.

**Acceptance Criteria:**

**Given** voice/language features are enabled
**When** I open the language selector
**Then** I see available languages (English, Hindi, Marathi, Hinglish)
**And** current selection is highlighted
**And** selecting a language updates preference
**And** selector is in widget header or settings
**And** language icons/flags are optional (text labels primary)

---

#### Story 10.10: Multi-Language TTS Voice Selection

As an **agent owner**,
I want to configure TTS voice per language,
So that spoken responses sound natural.

**Acceptance Criteria:**

**Given** I'm configuring agent voice settings
**When** I select TTS voices
**Then** I can choose a voice for each supported language
**And** voice preview plays a sample
**And** available voices depend on browser/service
**And** fallback voice is set for unsupported languages
**And** settings are saved to agent config

---

#### Story 10.11: Voice Playback Controls

As a **website visitor**,
I want to control voice playback,
So that I can pause, stop, or replay responses.

**Acceptance Criteria:**

**Given** TTS is playing a response
**When** I interact with playback controls
**Then** pause button stops playback temporarily
**And** stop button ends playback completely
**And** replay button restarts current message
**And** volume is controllable
**And** playback state is visible

---

#### Story 10.12: Language Distribution Analytics

As an **agent owner**,
I want to see which languages my users speak,
So that I can optimize for my audience.

**Acceptance Criteria:**

**Given** language data is being collected
**When** I view analytics
**Then** pie chart shows language distribution
**And** counts are shown per language
**And** trend over time is available
**And** data is filterable by date range
**And** analytics respect tenant isolation

---

#### Story 10.13: Voice Error Handling

As a **website visitor**,
I want clear feedback when voice features fail,
So that I can take appropriate action.

**Acceptance Criteria:**

**Given** a voice operation fails
**When** the error occurs
**Then** user-friendly message is displayed
**And** microphone permission errors explain how to fix
**And** network errors suggest retrying
**And** unsupported browser shows "Voice not supported"
**And** fallback to text input is always available

---

### Epic 11: Security, Audit & Compliance

#### Story 11.1: Rate Limiting Infrastructure (Redis)

As a **system**,
I want request rate limiting using Redis,
So that the platform is protected from abuse.

**Acceptance Criteria:**

**Given** Redis is configured for rate limiting
**When** setting up the rate limiter
**Then** sliding window algorithm is implemented
**And** Redis stores rate limit counters
**And** TTL automatically cleans up old windows
**And** rate limiter is injectable NestJS service
**And** configuration is environment-based

---

#### Story 11.2: API Rate Limit Guard

As a **system**,
I want rate limits enforced on all API endpoints,
So that no single client can overwhelm the system.

**Acceptance Criteria:**

**Given** rate limiting infrastructure exists
**When** requests exceed the limit
**Then** 429 Too Many Requests is returned
**And** `Retry-After` header indicates wait time
**And** `X-RateLimit-*` headers show limit status
**And** authenticated users get higher limits
**And** rate limits are configurable per endpoint

---

#### Story 11.3: Widget Message Rate Limiting

As a **system**,
I want specific rate limits on chat messages,
So that widget abuse is prevented.

**Acceptance Criteria:**

**Given** a user is sending chat messages
**When** they exceed message rate limit
**Then** message is rejected with friendly error
**And** limit is 10 messages per minute per device
**And** limit is 100 messages per hour per device
**And** rate limit is per-agent (not global)
**And** widget shows "Please slow down" message

---

#### Story 11.4: HMAC Signature Verification (Webhook Security)

As an **agent owner**,
I want optional HMAC signature verification,
So that webhook responses can be validated.

**Acceptance Criteria:**

**Given** HMAC is enabled for an agent
**When** webhook response is received
**Then** `X-Signature` header is validated
**And** signature uses SHA-256 with agent secret
**And** invalid signatures are rejected
**And** signature verification is optional (configurable)
**And** verification failure is logged

---

#### Story 11.5: Replay Attack Prevention (Nonce Cache)

As a **system**,
I want to prevent replay attacks,
So that captured requests cannot be reused.

**Acceptance Criteria:**

**Given** replay protection is enabled
**When** a request includes a nonce
**Then** nonce is checked against Redis cache
**And** used nonces are rejected
**And** nonce cache expires after 5 minutes
**And** timestamp validation rejects old requests (>5min)
**And** replay attempts are logged as security events

---

#### Story 11.6: Audit Log Database Model

As a **system**,
I want a comprehensive audit log table,
So that all changes are traceable.

**Acceptance Criteria:**

**Given** the need for audit trail
**When** AuditLog table is created
**Then** it stores: userId, action, resource, resourceId, timestamp
**And** before/after values are stored as JSONB
**And** IP address and user agent are captured
**And** organizationId enables tenant filtering
**And** indexes support efficient querying

---

#### Story 11.7: Audit Logging Interceptor

As a **system**,
I want all mutations automatically logged,
So that no change goes unrecorded.

**Acceptance Criteria:**

**Given** a mutation request is made (POST, PUT, PATCH, DELETE)
**When** the request completes successfully
**Then** audit log entry is created automatically
**And** request body (sanitized) is logged
**And** response changes are captured
**And** logging is non-blocking (async)
**And** sensitive fields are redacted (passwords, secrets)

---

#### Story 11.8: Audit Log Query API

As an **admin**,
I want to query audit logs,
So that I can investigate changes and incidents.

**Acceptance Criteria:**

**Given** I have admin privileges
**When** I call GET `/api/audit-logs`
**Then** I can filter by userId, action, resource, dateRange
**And** results are paginated (default 50 per page)
**And** results are sorted by timestamp descending
**And** only my organization's logs are visible (tenant isolation)
**And** Super Admin can view all organizations

---

#### Story 11.9: Audit Log Dashboard View

As an **admin**,
I want to view audit logs in the dashboard,
So that I can review activity without API calls.

**Acceptance Criteria:**

**Given** I navigate to Admin > Audit Logs
**When** the page loads
**Then** recent audit entries are displayed in a table
**And** I can filter by user, action, resource
**And** I can search by resource ID
**And** clicking an entry shows full details
**And** export to CSV is available

---

#### Story 11.10: RBAC Permission Matrix

As a **system**,
I want a clear permission matrix,
So that role access is consistently enforced.

**Acceptance Criteria:**

**Given** the three roles (Super Admin, Admin, Client)
**When** permissions are checked
**Then** matrix defines: resource × action × role
**And** Super Admin has all permissions
**And** Admin has org-level management
**And** Client has own-data access only
**And** matrix is documented and testable

---

#### Story 11.11: RolesGuard Implementation

As a **system**,
I want role-based access control on all endpoints,
So that users only access what they're permitted.

**Acceptance Criteria:**

**Given** an endpoint has `@Roles()` decorator
**When** a request is made
**Then** user's role is verified against required roles
**And** insufficient permissions return 403 Forbidden
**And** error message indicates required role
**And** role check happens after authentication
**And** endpoint-level role override is supported

---

#### Story 11.12: GDPR Data Export

As a **user**,
I want to export all my personal data,
So that I can comply with data portability rights.

**Acceptance Criteria:**

**Given** I request my data export
**When** POST `/api/users/me/export` is called
**Then** export job is queued (async)
**And** email notification is sent when ready
**And** download link expires after 24 hours
**And** export includes: profile, messages, sessions, events
**And** export format is JSON (machine-readable)

---

#### Story 11.13: GDPR Data Deletion

As a **user**,
I want to delete all my personal data,
So that I can exercise my right to erasure.

**Acceptance Criteria:**

**Given** I request account deletion
**When** DELETE `/api/users/me` is called
**Then** confirmation is required (re-auth or code)
**And** deletion is scheduled (30-day grace period)
**And** user is notified and can cancel within grace period
**And** after grace period, all data is permanently deleted
**And** deletion is logged in audit trail (anonymized)

---

#### Story 11.14: Password Policy Enforcement

As a **system**,
I want strong password requirements,
So that user accounts are secure.

**Acceptance Criteria:**

**Given** a user sets or changes password
**When** password is validated
**Then** minimum 12 characters required
**And** must contain: uppercase, lowercase, number, special char
**And** common passwords are rejected (dictionary check)
**And** password history prevents last 5 reuses
**And** clear error messages guide users

---

#### Story 11.15: Security Headers Middleware

As a **system**,
I want security headers on all responses,
So that common web vulnerabilities are mitigated.

**Acceptance Criteria:**

**Given** any HTTP response is sent
**When** headers are applied
**Then** `X-Content-Type-Options: nosniff` is set
**And** `X-Frame-Options: DENY` is set
**And** `X-XSS-Protection: 1; mode=block` is set
**And** `Strict-Transport-Security` is set (HTTPS only)
**And** `Content-Security-Policy` restricts sources

---

### Epic 12: Observability & System Reliability

#### Story 12.1: Sentry SDK Integration

As a **system**,
I want Sentry integrated for error tracking,
So that errors are captured and analyzed automatically.

**Acceptance Criteria:**

**Given** Sentry credentials are configured
**When** the application initializes
**Then** Sentry SDK is loaded in both backend and frontend
**And** environment (dev/staging/prod) is tagged
**And** release version is attached to events
**And** source maps are uploaded for stack traces
**And** DSN is stored in environment variables

---

#### Story 12.2: Error Capture and Context

As a **developer**,
I want errors captured with full context,
So that I can diagnose issues quickly.

**Acceptance Criteria:**

**Given** an error occurs in the application
**When** it's sent to Sentry
**Then** stack trace is included (with source maps)
**And** user context (userId, orgId) is attached
**And** request context (URL, method, headers) is included
**And** breadcrumbs show recent events leading to error
**And** sensitive data is scrubbed (passwords, tokens)

---

#### Story 12.3: Health Check Endpoint (Liveness)

As a **load balancer**,
I want a liveness health check endpoint,
So that I can detect if the service is running.

**Acceptance Criteria:**

**Given** the API is running
**When** GET `/health` is called
**Then** 200 OK is returned immediately
**And** response includes: status, timestamp, version
**And** no database or external service checks are performed
**And** response time is <10ms
**And** endpoint requires no authentication

---

#### Story 12.4: Readiness Check Endpoint

As a **load balancer**,
I want a readiness health check endpoint,
So that I can detect if the service can handle traffic.

**Acceptance Criteria:**

**Given** the API is running
**When** GET `/health/ready` is called
**Then** database connectivity is verified
**And** Redis connectivity is verified
**And** Auth0 reachability is checked (cached)
**And** 200 OK if all healthy, 503 if any unhealthy
**And** response details which checks passed/failed

---

#### Story 12.5: Request Correlation IDs

As a **developer**,
I want every request to have a correlation ID,
So that I can trace requests across services.

**Acceptance Criteria:**

**Given** a request is received
**When** it's processed
**Then** correlation ID is extracted from `X-Correlation-ID` header
**And** new UUID is generated if header missing
**And** correlation ID is attached to all logs
**And** correlation ID is passed to external service calls
**And** correlation ID is returned in response header

---

#### Story 12.6: Structured Logging

As a **developer**,
I want structured JSON logs,
So that logs can be searched and analyzed efficiently.

**Acceptance Criteria:**

**Given** a log statement is made
**When** it's written
**Then** output is JSON format (in production)
**And** includes: timestamp, level, message, correlationId
**And** additional context is attached (userId, agentId)
**And** log levels are configurable (debug/info/warn/error)
**And** console-friendly format in development

---

#### Story 12.7: Performance Monitoring (APM)

As a **developer**,
I want application performance monitoring,
So that I can identify slow endpoints and bottlenecks.

**Acceptance Criteria:**

**Given** Sentry APM is configured
**When** requests are processed
**Then** transaction traces are recorded
**And** database queries are captured as spans
**And** external HTTP calls are captured
**And** P50, P95, P99 latencies are calculated
**And** slow transactions are flagged (>1.5s)

---

#### Story 12.8: Response Time Alerting

As an **operator**,
I want alerts when response times degrade,
So that I can respond to performance issues.

**Acceptance Criteria:**

**Given** performance data is being collected
**When** P95 response time exceeds 1.5s for 5 minutes
**Then** alert is triggered in Sentry
**And** alert includes affected endpoints
**And** alert severity is based on duration/severity
**And** alert resolves automatically when recovered
**And** PagerDuty/Slack integration is configurable

---

#### Story 12.9: Error Rate Alerting

As an **operator**,
I want alerts when error rates spike,
So that I can respond to production issues.

**Acceptance Criteria:**

**Given** errors are being captured
**When** error rate exceeds threshold (>1% of requests)
**Then** alert is triggered
**And** alert groups similar errors
**And** first occurrence vs regression is distinguished
**And** alert includes error details and stack trace
**And** escalation happens if not acknowledged

---

#### Story 12.10: Graceful Degradation - AI Service

As a **system**,
I want graceful degradation when AI service is unavailable,
So that users get helpful fallback messages.

**Acceptance Criteria:**

**Given** AI service (n8n) is unreachable
**When** a chat message is sent
**Then** user receives fallback message (configurable)
**And** message indicates temporary unavailability
**And** retry is suggested
**And** error is logged but not shown to user
**And** service automatically recovers when AI returns

---

#### Story 12.11: Graceful Degradation - Database

As a **system**,
I want graceful degradation during database issues,
So that partial functionality remains available.

**Acceptance Criteria:**

**Given** database is experiencing issues
**When** queries fail
**Then** read operations fail gracefully with cached data where possible
**And** write operations return clear error messages
**And** health check marks service as unhealthy
**And** reconnection is attempted automatically
**And** detailed errors are logged for debugging

---

#### Story 12.12: Uptime Monitoring

As an **operator**,
I want external uptime monitoring,
So that I know when the service is down.

**Acceptance Criteria:**

**Given** the production service is deployed
**When** external monitoring is configured
**Then** `/health` endpoint is checked every 60 seconds
**And** downtime is detected within 2 minutes
**And** uptime percentage is tracked (target: 99.9%)
**And** status page is updated automatically
**And** incident notifications are sent

---

#### Story 12.13: Request/Response Logging

As a **developer**,
I want request/response logging for debugging,
So that I can troubleshoot API issues.

**Acceptance Criteria:**

**Given** an API request is made
**When** logging middleware processes it
**Then** request method, URL, and headers are logged
**And** response status code and duration are logged
**And** request body is logged (sanitized, optional)
**And** response body is NOT logged (too large, sensitive)
**And** logging level is configurable per environment

---

#### Story 12.14: Dashboard System Status Indicator

As a **dashboard user**,
I want to see system status in the UI,
So that I know if issues are affecting my experience.

**Acceptance Criteria:**

**Given** I'm using the dashboard
**When** system issues occur
**Then** status indicator appears in header
**And** indicator shows: operational, degraded, outage
**And** clicking shows details of affected services
**And** indicator updates in real-time (polling)
**And** historical incidents are linkable

---

## Story Summary

| Epic | Name | Stories |
|------|------|---------|
| 0 | Project Foundation | 12 |
| 1 | Authentication | 10 |
| 2 | Multi-Tenant | 8 |
| 3 | Agent Creation | 9 |
| 4 | Theme Editor | 13 |
| 5 | Chat Widget | 14 |
| 6 | Chat Experience | 14 |
| 7 | AI Integration | 12 |
| 8 | Analytics | 14 |
| 9 | Event Tracking | 12 |
| 10 | Voice/Language | 13 |
| 11 | Security/Audit | 15 |
| 12 | Observability | 14 |
| **Total** | | **160** |

**FR Coverage:** All 168 Functional Requirements mapped to stories
**NFR Coverage:** All Non-Functional Requirements addressed in acceptance criteria
**Test Coverage:** P0 and P1 test requirements integrated into stories
