---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
inputDocuments:
  - 'docs/deep-dive-dashboard.md'
  - 'docs/deep-dive-server.md'
  - 'docs/deep-dive-widget.md'
  - 'docs/ANALYTICS-KPIS.md'
workflowType: 'prd'
briefCount: 0
researchCount: 0
brainstormingCount: 0
projectDocsCount: 4
classification:
  projectType: saas_b2b
  domain: general
  complexity: medium
  projectContext: brownfield
---

# Product Requirements Document - cw

**Author:** Dhruv
**Date:** 2026-01-31

## Success Criteria

### User Success

**For Organization Admins:**
- Create and configure an AI chat agent in under 5 minutes
- Customize widget appearance with real-time preview
- Deploy widget to website with single script tag
- View comprehensive analytics with 14 KPIs in dashboard
- Configure multi-language support (English, Hindi, Marathi, Hinglish)
- Enable voice input/output for chat interactions

**For End Users (Website Visitors):**
- Receive AI response within 1-1.5 seconds of sending message (P95 < 1.5s)
- Experience smooth, real-time streaming responses
- Seamless conversation continuity within session
- Widget loads without impacting page performance (<200ms)
- Interact via text, voice input, or receive voice responses
- Automatic language detection and appropriate responses

**Emotional Success Moments:**
- "This looks like it's part of my brand" - Theme customization
- "It just works" - Embedding simplicity
- "Conversations feel natural" - Streaming responses with voice support
- "The insights are exactly what I need" - Comprehensive analytics

### Business Success

**3-Month Success:**
- Platform handles 100+ organizations
- 1,000+ active chat widgets deployed
- 99.5% uptime SLA maintained
- Average response time < 1.5 seconds (P95)
- Voice-enabled conversations: >40% adoption

**12-Month Success:**
- 500+ organizations paying customers
- 10,000+ active widgets
- 1M+ conversations processed
- <1% error rate on AI responses
- Successful AI provider swap (proving abstraction works)
- Multi-language conversations: >60% non-English usage
- Voice interactions: >50% of total conversations

**Key Metrics:**
- Organization signup to first widget deployed: <15 minutes
- Widget embed success rate: >95%
- User satisfaction (chat quality): >4.0/5.0
- System uptime: 99.9%
- Response time P95: <1.5 seconds
- Voice recognition accuracy: >95%

### Technical Success

**Performance:**
- Dashboard: <1s page load, <100ms interaction response
- Widget: <200ms load time, minimal parent page impact
- Zero unnecessary re-renders (React DevTools verified)
- Optimized component reusability across all apps
- Voice processing: <500ms latency for transcription

**Architecture:**
- Backend successfully abstracts AI provider (n8n swappable)
- All APIs auto-documented (OpenAPI/Swagger)
- Real-time observability on both client and server
- 100% containerized deployment
- Shared Zod validation library across monorepo

**Quality:**
- >80% test coverage across all packages
- All code passes linting and type checking
- Zero critical security vulnerabilities
- API response times monitored and alerted
- Automated testing gates block merge on failure

### Measurable Outcomes

**Performance Metrics:**
1. **Time to First Widget**: <15 minutes from signup to embedded widget
2. **Response Latency**: P95 < 1.5 seconds, P99 < 2 seconds for AI responses
3. **System Reliability**: 99.9% uptime, <0.1% error rate
4. **Performance Budget**: Dashboard FCP <1s, Widget load <200ms
5. **Voice Latency**: <500ms for speech-to-text, <300ms for text-to-speech

**Analytics KPIs (14 Core Metrics):**
1. **Total Users**: New vs Returning (60-day window)
2. **Total Conversations Initiated**: Session count (6h inactivity window)
3. **Total Messages**: Sent (user) and Received (bot)
4. **Message Volume Trends**: Peak hours/days identification
5. **Languages Used**: English, Hindi, Marathi, Hinglish, Other distribution
6. **Most Popular Topics**: Pricing, Support, Product, Billing, Policy
7. **User Retention Rate**: % of users returning within 60 days (target: 55-70%)
8. **User Growth Rate**: New user growth period-over-period (target: +5-25%)
9. **% Change in New Users**: Daily/Weekly/Monthly deltas
10. **Unresolved Queries**: Failed/unhandled queries (target: <4%)
11. **Fallback Rate**: % of fallback responses (target: <8%)
12. **Average Bot Response Time**: 1-1.5 seconds (vs demo 1.6-2.0s)
13. **Number of Queries Raised**: Total user prompts
14. **Total Messages Exchanged**: Sum of user + bot messages

**Quality Metrics:**
- Code Quality: >80% coverage, zero critical issues
- Developer Experience: API docs auto-generated, types shared via Zod
- Multi-language Accuracy: >90% correct language detection
- Voice Recognition Accuracy: >95% transcription accuracy

## Product Scope

### MVP - Minimum Viable Product

**Core Platform (Rebuild Foundation):**
- User authentication and authorization (Auth0)
- Multi-tenant organization management
- Role-based access control (Admin, Owner, Client)
- Turborepo monorepo setup with shared packages

**Dashboard Application (Next.js + Shadcn UI):**
- Agent creation and configuration
- Visual theme customizer with live preview
- Widget deployment (embed code generation)
- **Comprehensive analytics dashboard (14 KPIs)**
  - Real-time metrics with date range selection (7/14/30 days)
  - User analytics (new, returning, growth, retention)
  - Conversation metrics (volume, trends, peak times)
  - Quality metrics (response time, fallback rate, unresolved queries)
  - Language distribution and topic analysis
  - Per-agent performance tables
- User/organization management
- **Multi-language configuration** (English, Hindi, Marathi, Hinglish)

**Embeddable Widget (Next.js + Shadcn UI + Shadow DOM):**
- Customizable chat interface (Shadcn UI components)
- Real-time streaming responses
- Device tracking and session management
- Shadow DOM isolation
- Responsive design
- **Voice input support** (speech-to-text)
- **Voice output support** (text-to-speech)
- **Multi-language support** with automatic detection
- Language preference persistence

**Backend Services (NestJS + Prisma):**
- **AI Service Abstraction Layer** (swappable providers)
  - Provider interface contract
  - n8n integration as initial provider
  - Provider switching without frontend changes
- RESTful API with auto-documentation (OpenAPI)
- Real-time streaming endpoint (SSE)
- Event tracking and analytics ingestion
- **Analytics data aggregation** (14 KPIs calculation)
- **Voice processing endpoints**
  - Speech-to-text transcription
  - Text-to-speech synthesis
  - Language detection for voice
- Session management (6h inactivity window)
- Message history and context management

**Shared Libraries (Monorepo Packages):**
- Zod validation schemas (shared across frontend/backend)
- TypeScript types (generated from Zod)
- Common utilities and helpers
- Design system components (Shadcn UI)

**Infrastructure & DevOps:**
- Turborepo monorepo configuration
- Containerized services (Docker)
- Supabase (Postgres + Object Storage)
- Auth0 integration (NO Supabase Auth)
- **Real-time observability**
  - Error tracking (client + server)
  - Performance monitoring (APM)
  - Log aggregation
- CI/CD pipeline with quality gates
  - Automated testing (Jest)
  - Linting and type checking
  - Security scanning
  - Performance budgets

### Growth Features (Post-MVP)

**Enhanced Analytics:**
- Custom dashboard builder
- Advanced filtering and segmentation
- Export capabilities (CSV, PDF)
- Scheduled reports via email
- Comparative analysis (bot vs bot, period vs period)
- Real-time alerts on anomalies

**Advanced Agent Features:**
- Multiple AI providers (OpenAI, Anthropic, Gemini)
- Provider routing rules (fallback, load balancing)
- Conversation routing and escalation
- Lead capture and CRM integration
- Custom training data management
- Agent collaboration (multi-agent conversations)

**Platform Capabilities:**
- Advanced theme customization (CSS injection)
- Widget A/B testing
- Additional language support (50+ languages)
- SSO integration (SAML, OAuth)
- White-label options
- API rate limiting and quotas

**Developer Features:**
- Webhooks for events
- Public REST API for integrations
- GraphQL API option
- SDK for custom implementations (JS, Python, React)
- Migration tools (import from legacy system)
- Terraform/IaC templates

**Voice Enhancements:**
- Voice customization (pitch, speed, accent)
- Multiple voice options per language
- Real-time voice-to-voice conversation
- Voice sentiment analysis

### Vision (Future)

**AI Innovation:**
- Multi-provider routing (best model for task)
- Fine-tuned models per organization
- RAG (Retrieval-Augmented Generation) integration
- Knowledge base management
- Agent memory and personalization

**Enterprise Scale:**
- Dedicated infrastructure options
- SLA tiers (99.9%, 99.99%, 99.999%)
- Advanced security (SOC2, HIPAA compliance)
- Custom model deployment
- Private cloud/on-premise options

**Platform Evolution:**
- Mobile SDK (iOS/Android native)
- Agent marketplace
- No-code agent builder
- Advanced workflow automation
- Video chat support
- AR/VR integrations

## User Journeys

### Journey 1: Priya - The Marketing Manager (Client User)

**Opening Scene:**
Priya is a marketing manager at a growing e-commerce company. Her support team is overwhelmed with 200+ daily customer inquiries about shipping, returns, and product details. Response times have stretched to 4+ hours, and customer satisfaction is dropping. She's been tasked with finding a solution, fast.

**Rising Action:**
Priya signs up for the platform using her work email. Within minutes, she's authenticated via Auth0 and lands in a clean dashboard. She clicks "Create Agent" and names it "ShopAssist". The theme customizer shows her brand colors instantly - she uploads her logo, adjusts the primary color to match her website (#FF6B35), and watches the live preview update in real-time.

She configures the initial context: "You are a helpful shopping assistant for TrendyWear. Help customers with order tracking, return policies, and product recommendations." She enables multi-language support (English, Hindi) since 30% of her customers prefer Hindi. She activates voice input/output - imagining customers speaking their questions while browsing on mobile.

**Climax:**
Priya copies the single-line embed code and sends it to her developer. Within 10 minutes, the widget is live on the website. She opens her company's homepage on her phone, taps the chat bubble, and speaks in Hindi: "Mera order kaha hai?" The widget transcribes perfectly, streams an AI response with order tracking instructions, and reads it back in Hindi. Her heart races - this actually works.

**Resolution:**
Over the next 7 days, Priya watches the analytics dashboard. 847 conversations handled, 1.2s average response time, 67% in English, 28% in Hindi, 5% mixed (Hinglish). Fallback rate is only 4%. Support ticket volume drops 60%. Her CEO asks how she did it. Priya grins - "Let me show you the dashboard."

---

### Journey 2: Raj - The Website Visitor (End User)

**Opening Scene:**
Raj is browsing an online furniture store on his phone during his lunch break. He found the perfect sofa but needs to know if it fits in his 10x12 living room. The FAQ page is buried somewhere, and he doesn't have time to search. He's about to abandon the cart.

**Rising Action:**
A chat bubble appears in the corner: "Need help? Ask me anything!" Raj taps it and speaks into his phone: "Will the Milano 3-seater sofa fit in a 10 by 12 room?" He doesn't type - he's eating lunch.

Within 1.2 seconds, the widget transcribes his speech, streams back a response: "The Milano 3-seater is 84 inches wide and 36 inches deep. In a 10x12 room (120x144 inches), you'll have plenty of space! Would you like to see room layout suggestions?" A voice reads it back to him clearly.

**Climax:**
Raj asks a follow-up: "What about delivery time?" Another instant response with his zip code's delivery estimate. He's impressed - this feels like talking to a knowledgeable friend, not a bot.

**Resolution:**
Raj completes his purchase. The entire interaction took 90 seconds. No waiting for email support, no digging through FAQs. Later, he rates the experience 5/5 when prompted by the widget. The conversation is logged with full context, language detection (English), and performance metrics.

---

### Journey 3: Sarah - The Super Admin (Platform Super Admin)

**Opening Scene:**
Sarah (co-founder) manages the multi-tenant SaaS platform serving 150+ organizations. It's 2 AM, and her phone buzzes - Datadog alerts: "Response time spike on Agent ID 47, P95 latency: 4.2s." She needs to investigate immediately without waking the engineering team.

**Rising Action:**
Sarah opens the super admin dashboard on her phone. She navigates to the analytics view, filters by Agent ID 47, and sees the issue: this organization switched their n8n webhook to a new AI provider that's timing out. The observability dashboard shows exactly where - 28 failed requests in the last hour.

She checks the AI service abstraction layer logs. The new provider's API is returning 503s. Sarah temporarily switches the agent back to the default n8n webhook using the super admin panel. Response times drop back to 1.3s instantly.

**Climax:**
Sarah sends the organization owner a notification: "We detected performance issues with your custom AI provider. We've temporarily switched to our default provider to maintain service quality. Please check your webhook configuration." She also invites a new support engineer to the platform to help handle the growing support load.

**Resolution:**
By morning, the organization owner has fixed their webhook. Sarah switches them back with one click. The entire incident was resolved in 15 minutes without a single customer experiencing downtime. The observability system logged everything for the post-mortem. Sarah goes back to sleep.

---

### Journey 4: Amit - The Support Engineer (Admin User)

**Opening Scene:**
Amit is a support engineer who was just invited to the platform by the super admin. A client emails: "Our widget stopped working on our website." He needs to diagnose and fix the issue quickly while the client waits on a support call.

**Rising Action:**
Amit logs into the admin dashboard (with limited permissions). He can see all organizations and their agents, but he cannot invite new users or access billing settings. He pulls up the client's organization and checks the real-time analytics: no new conversations in the past 20 minutes.

He reviews the widget config API logs - no errors. He checks the embed code generation - looks correct. He asks the client to share their website URL. Visiting it, Amit notices the widget isn't loading. He opens browser DevTools - CORS error.

**Climax:**
Amit identifies that the client recently changed their domain from "shop.example.com" to "store.example.com" but didn't update the allowed domains in their agent configuration. He updates the agent's allowed domains via the admin panel: "*.example.com" wildcard. He refreshes the client's website. The widget loads instantly.

**Resolution:**
The client is relieved - "That was fast!" The entire fix took 6 minutes. Amit documents the issue in the knowledge base and alerts the super admin about a potential UX improvement: proactive CORS error detection. The observability system tracked every step of the investigation.

---

### Journey 5: Dev - The Integration Developer (Developer/Integrator)

**Opening Scene:**
Dev is a full-stack developer at a healthcare startup. His PM wants an AI chat widget on their patient portal by Friday. It's Tuesday. He's never embedded a chat widget before and he's nervous about breaking the carefully-styled healthcare UI.

**Rising Action:**
Dev reads the auto-generated API documentation (OpenAPI spec). Clear, concise, with code examples. He copies the embed code, adds it to the React app. Shadow DOM isolation means zero CSS conflicts - the widget appears perfectly styled without touching their design system.

He tests the configuration API to customize the theme programmatically. The TypeScript types are auto-generated from Zod schemas - his IDE autocompletes every field. He sets up voice input/output since many of their elderly patients prefer speaking.

**Climax:**
Dev deploys to staging. The widget loads in <200ms, works on mobile, doesn't slow down their page (Lighthouse score: unchanged). He tests the voice input with his phone - perfect transcription. The real-time streaming responses feel magical. QA approves.

**Resolution:**
Friday morning, the widget goes to production. Dev sets up observability dashboards to monitor performance. Everything works flawlessly. His PM is thrilled. Dev adds the API to his "favorite APIs" list - well-documented, type-safe, and actually works as advertised.

---

### Journey Requirements Summary

**Capabilities Revealed by Journeys:**

**From Priya (Client User) Journey:**
- Fast agent creation (<5 min)
- Real-time theme customization with live preview
- Multi-language configuration (English, Hindi, Marathi, Hinglish)
- Voice input/output enablement
- Simple embed code generation (one-line)
- Comprehensive analytics dashboard (14 KPIs)
- Language distribution tracking
- Performance monitoring (response time, fallback rate)

**From Raj (End User) Journey:**
- Voice input support (<500ms transcription)
- Real-time streaming responses (1-1.5s)
- Voice output (text-to-speech)
- Mobile-optimized chat interface
- Conversation continuity within session
- Rating/feedback mechanism
- Fast widget load (<200ms)

**From Sarah (Super Admin) Journey:**
- Full platform control and visibility
- Real-time observability and alerting
- Cross-organization analytics and monitoring
- AI provider switching capability (abstraction layer)
- Performance monitoring per agent
- User invitation and management (super admin only)
- Quick access to logs and metrics
- Mobile-friendly admin dashboard
- Incident response tools

**From Amit (Admin User) Journey:**
- Limited admin dashboard access
- Organization and agent management
- Cannot invite users (super admin only)
- Cannot access billing/critical settings
- Troubleshooting tools and logs
- Widget configuration management
- Domain/CORS management
- Knowledge base access
- Client support capabilities

**From Dev (Developer) Journey:**
- Auto-generated API documentation (OpenAPI)
- TypeScript types from Zod schemas
- Shadow DOM isolation (zero CSS conflicts)
- Configuration API for programmatic control
- Lightweight widget (<200ms load)
- Performance monitoring (Lighthouse integration)
- Clear code examples and documentation

**Cross-Journey Technical Requirements:**
- Backend AI service abstraction (swappable providers)
- Multi-language support (detection + configuration)
- Voice processing (STT + TTS) with <500ms latency
- Real-time observability on client and server
- Session management (6h inactivity window)
- Analytics calculation engine (14 KPIs)
- Shadow DOM widget architecture
- Auto-documented APIs (OpenAPI + TypeScript)
- **RBAC with 3-tier hierarchy:**
  - Super Admin: Full platform control, user invitations, billing
  - Admin User: Organization/agent management, support tools, no invites
  - Client User: Own agents only, no cross-org access
- Mobile-first responsive design

## SaaS B2B Platform - Technical Requirements

### Multi-Tenancy Architecture

**Tenant Model:**
- **Organization-based isolation**: Each B2B client is a separate tenant (organization)
- **Data segregation**: Complete data isolation at application query level (NO Row Level Security)
- **Per-tenant configuration**: Independent agent configs, themes, settings per organization
- **Shared infrastructure**: Single codebase, database, infrastructure serving all tenants
- **Tenant identification**: Organization ID for all data access and filtering

**Tenant Onboarding Flow:**
1. Client signs up via Auth0 (or invited by Admin/Super Admin)
2. Super Admin or Admin User creates organization record
3. Admin User creates initial agent(s) for client organization
4. Client User can then edit their agents via dashboard

### Role-Based Access Control (RBAC) - Corrected

**3-Tier Permission Matrix:**

| **Capability** | **Super Admin** | **Admin User** | **Client User** |
|---|---|---|---|
| **User Management** ||||
| Invite new users | ✅ | ❌ | ❌ |
| Manage user roles | ✅ | ❌ | ❌ |
| View all organizations | ✅ | ✅ | ❌ |
| **Agent Management** ||||
| Create agents (any org) | ✅ | ✅ | ❌ |
| Create agents (own org) | ✅ | ✅ | ❌ |
| Edit agents (any org) | ✅ | ✅ | ❌ |
| Edit agents (own org) | ✅ | ✅ | ✅ |
| Delete agents (any org) | ✅ | ✅ | ❌ |
| Delete agents (own org) | ✅ | ✅ | ✅ |
| **Analytics & Monitoring** ||||
| View analytics (any org) | ✅ | ✅ | ❌ |
| View analytics (own org) | ✅ | ✅ | ✅ |
| View platform-wide analytics | ✅ | ✅ (limited) | ❌ |
| Switch AI providers (any org) | ✅ | ❌ | ❌ |
| **Platform Management** ||||
| Access super admin dashboard | ✅ | ❌ | ❌ |
| Manage billing/subscriptions | ✅ | ❌ | ❌ |
| Configure observability | ✅ | ❌ | ❌ |
| Manage knowledge base | ✅ | ✅ | ❌ |
| **Logs & Troubleshooting** ||||
| Access system logs | ✅ | ✅ (all orgs) | ✅ (own org only) |
| View audit trails | ✅ | ✅ (all orgs) | ✅ (own org only) |
| View API usage logs | ✅ | ✅ (all orgs) | ✅ (own org only) |
| Troubleshoot client issues | ✅ | ✅ | ❌ |
| Update CORS/domains | ✅ | ✅ | ✅ |

**Client User Log Visibility (Limited):**
- ✅ Audit trail (who changed what in their agents)
- ✅ Widget activity logs (embed events, CORS issues, load failures)
- ✅ API usage logs (request counts, rate limits, errors)
- ✅ Performance metrics (response times, fallback rates)
- ❌ Internal system logs (database queries, stack traces, infrastructure)

### Integration Architecture

**Core Integrations (MVP):**

**1. Auth0** (Authentication & Authorization)
- Social logins (Google, GitHub, Microsoft)
- Email/password authentication
- JWT token management with claims
- Role assignment and RBAC enforcement
- Multi-factor authentication (MFA) support

**2. Supabase** (Database & Storage)
- PostgreSQL database (NO Row Level Security, application-level control)
- Object storage for assets (logos, theme images, files)
- Connection pooling for performance
- Automated backups and point-in-time recovery

**3. n8n** (AI Provider - Initial, Swappable)
- Webhook-based integration
- All AI/LLM logic handled in n8n workflows
- Per-organization custom webhooks supported
- Swappable via backend AI abstraction layer
- Provider interface contract for future providers

**4. Sentry** (Observability)
- Error tracking (client + server)
- Performance monitoring (APM)
- Log aggregation and search
- Real-time alerting
- Release tracking and source maps

**5. Swagger/OpenAPI** (API Documentation)
- Auto-generated API docs from NestJS controllers
- Interactive API explorer
- TypeScript types from Zod schemas
- Code examples for common operations

**Integration Requirements:**
- API-first design for all integrations
- Webhook support for event-driven integrations
- OAuth 2.0 for third-party integrations
- API key management per organization
- Integration health monitoring

### Audit & Compliance

**Audit Logging:**
- **Event Types**: CREATE, UPDATE, DELETE, INVITE, LOGIN, LOGOUT, ROLE_CHANGE
- **Logged Fields**: User ID, Organization ID, Event type, Target resource, Timestamp, IP address, User agent
- **Retention**: 2 years minimum
- **Access**: Super Admin (all), Admin User (all orgs), Client User (own org)
- **Use Cases**: Security audits, compliance, troubleshooting, accountability

**Security Requirements:**
- Auth0 handles authentication (no password storage)
- API rate limiting per organization
- CORS protection with domain validation
- Encrypted data in transit (HTTPS/TLS 1.3)
- Encrypted data at rest (Supabase encryption)
- Session management (JWT expiration 7 days, refresh tokens)
- Audit logging for all mutations

**Data Privacy (GDPR Compliance):**
- Data export capabilities (user data portability)
- Right to deletion (data erasure within 30 days)
- Privacy policy and terms of service
- Cookie consent management
- Data retention policies configurable per org

### Technical Architecture

**Scalability:**
- Horizontal scaling via Docker + Kubernetes
- Database connection pooling (PgBouncer)
- Redis caching for sessions and config
- CDN for static assets (widget JS, images)
- Async job processing for analytics (BullMQ/RabbitMQ)

**Performance Optimization:**
- Database indexing on organization_id + agent_id for all queries
- Query optimization (Prisma query analysis, N+1 prevention)
- API response caching (Redis) where appropriate
- Widget code splitting and lazy loading
- Image optimization (WebP, responsive images, compression)
- Component reusability (zero unnecessary re-renders)

**Monitoring & Observability (Sentry):**
- Real-time error tracking (client + server)
- Performance monitoring (API latency, DB queries, React performance)
- Resource utilization (CPU, memory, storage)
- Business metrics dashboards (conversations, users, usage)
- Alerting (PagerDuty/Slack) for critical issues

### Implementation Considerations

**Development Workflow:**
- Turborepo monorepo for all packages (apps/dashboard, apps/widget, apps/backend, packages/*)
- Shared Zod schemas across frontend/backend (packages/validation)
- TypeScript strict mode enforced everywhere
- Pre-commit hooks (Husky): lint, type-check, test
- CI/CD pipeline with quality gates (GitHub Actions)

**Deployment Strategy:**
- Containerized services (Docker multi-stage builds)
- Infrastructure as Code (Terraform/Pulumi preferred)
- Blue-green deployments for zero-downtime
- Database migrations (Prisma Migrate)
- Environment parity (dev, staging, production)

**API Design Principles:**
- RESTful principles (resources, verbs, status codes)
- OpenAPI/Swagger auto-documentation
- Versioning strategy (/v1/, /v2/ in URL path)
- Consistent error response format (RFC 7807 Problem Details)
- Pagination for list endpoints (cursor-based preferred)
- Filtering, sorting, search capabilities
- HATEOAS for discoverability

**Performance Targets (Enforced):**
- Dashboard: First Contentful Paint <1s, Time to Interactive <1.5s
- Widget: Load time <200ms, minimal parent page impact
- API: P95 response time <100ms (excluding AI calls)
- AI responses: P95 <1.5s, P99 <2s
- Database queries: P95 <50ms
- Zero unnecessary React re-renders (monitored)

## Functional Requirements

### User Management & Authentication

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

### Organization & Multi-Tenancy Management

- FR11: Super Admin can create new organization records for B2B clients
- FR12: Admin User can view and manage agents across all organizations
- FR13: Client User can view and manage only their own organization's agents
- FR14: Super Admin can view list of all organizations with metadata (name, created date, agent count)
- FR15: System can enforce organization-based data isolation using application-level filtering (no RLS)
- FR16: Each organization can have multiple agents managed independently

### Agent Configuration & Management

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

### Theme & Visual Customization

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

### Widget Embedding & Deployment

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

### Chat & Conversation Management

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

### Real-Time Streaming & AI Integration

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

### Analytics & Metrics

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

### Event Tracking & Usage Monitoring

- FR101: Widget can track widget_opened event once per device
- FR102: Widget can track rating_submitted events with rating value and comment
- FR103: Widget can track error events with error message and stack trace
- FR104: System can store usage events with metadata (timestamp, URL, user agent, country)
- FR105: System can accept bulk message ingestion from widget
- FR106: System can extract and store telemetry from AI responses (model, tokens, latency)
- FR107: System can track widget lifecycle events (opened, minimized, closed)
- FR108: System can correlate events with sessions and agents for analytics

### Security & Compliance

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

### Audit Logging & Traceability

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

### Voice & Multi-Language Support

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

### Device & Session Tracking

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

### System Health & Monitoring

- FR160: System can expose health check endpoint for monitoring
- FR161: System can serve widget configuration with ETag support for caching
- FR162: System can set cache headers for widget config (5-minute max-age)
- FR163: System can log errors to console in development mode
- FR164: System can integrate with Sentry for error tracking and monitoring
- FR165: System can integrate with Sentry for performance monitoring (APM)
- FR166: System can integrate with Sentry for log aggregation
- FR167: System can track API response times and latency
- FR168: System can alert on performance degradation (P95 > 1.5s)

## Non-Functional Requirements

### Performance

**Response Times:**
- NFR1: AI chat responses must complete in <1.5 seconds (P95) and <2 seconds (P99)
- NFR2: Dashboard page load must achieve First Contentful Paint <1 second
- NFR3: Dashboard interactions must respond in <100ms
- NFR4: Widget JavaScript must load in <200ms without impacting parent page performance
- NFR5: API endpoints must respond in <100ms (P95) excluding AI processing
- NFR6: Database queries must execute in <50ms (P95)
- NFR7: Voice transcription must complete in <500ms
- NFR8: Text-to-speech synthesis must complete in <300ms

**Optimization:**
- NFR9: React components must be reusable with zero unnecessary re-renders (monitored via React DevTools)
- NFR10: Widget bundle size must remain <150KB (minified)
- NFR11: Dashboard must use code splitting and lazy loading for optimal performance

### Security

**Authentication & Authorization:**
- NFR12: All user authentication must be handled via Auth0 (no password storage in application)
- NFR13: API requests must be authenticated with JWT tokens
- NFR14: JWT tokens must expire after 7 days with refresh token support
- NFR15: Role-based access control must be enforced at application level for all data access

**Data Protection:**
- NFR16: All data in transit must be encrypted using HTTPS/TLS 1.3
- NFR17: All data at rest must be encrypted (Supabase encryption)
- NFR18: Agent secrets (webhooks, API keys) must be stored in isolated private schema with encryption
- NFR19: Sensitive data must never be logged or exposed in error messages

**Attack Prevention:**
- NFR20: System must enforce rate limiting per organization to prevent abuse
- NFR21: System must validate all CORS requests against allowed domain list
- NFR22: System must validate and sanitize all user input to prevent XSS attacks
- NFR23: System must prevent SQL injection via parameterized queries (Prisma ORM)
- NFR24: System must support HMAC signature verification for widget requests
- NFR25: System must prevent replay attacks using nonce cache with timestamp validation

**Compliance:**
- NFR26: System must support GDPR data export (user data portability)
- NFR27: System must support GDPR data deletion (right to erasure within 30 days)
- NFR28: System must track user consent for cookies and data processing
- NFR29: System must maintain audit log for all state-changing operations

### Scalability

**Horizontal Scaling:**
- NFR30: Backend services must support horizontal scaling via Docker + Kubernetes
- NFR31: System must handle 100+ organizations in 3 months
- NFR32: System must scale to 500+ organizations in 12 months
- NFR33: System must support 1,000+ concurrent widget instances
- NFR34: System must scale to 10,000+ active widgets in 12 months

**Performance Under Load:**
- NFR35: System must maintain <10% performance degradation with 10x user growth
- NFR36: Database must use connection pooling (PgBouncer) for efficient resource management
- NFR37: Static assets (widget JS, images) must be served via CDN
- NFR38: System must use Redis caching for sessions, config, and frequently accessed data
- NFR39: System must process analytics asynchronously using job queues (BullMQ/RabbitMQ)

### Reliability

**Uptime & Availability:**
- NFR40: System must maintain 99.9% uptime SLA (less than 8.76 hours downtime per year)
- NFR41: System must support zero-downtime deployments via blue-green strategy
- NFR42: System must include automated health checks for all services
- NFR43: System must implement graceful degradation when non-critical services fail

**Error Handling:**
- NFR44: System must maintain <1% error rate on AI responses
- NFR45: System must handle and log all errors without exposing sensitive information
- NFR46: System must recover gracefully from AI provider timeouts
- NFR47: System must retry failed operations with exponential backoff where appropriate

**Data Integrity:**
- NFR48: System must use database transactions for multi-step operations
- NFR49: System must maintain referential integrity across all database relationships
- NFR50: System must perform automated database backups with point-in-time recovery

### Observability

**Error Tracking:**
- NFR51: System must integrate with Sentry for real-time error tracking (client + server)
- NFR52: All errors must include context (user ID, org ID, request ID, stack trace)
- NFR53: Critical errors must trigger alerts to on-call engineers

**Performance Monitoring:**
- NFR54: System must integrate with Sentry APM for performance monitoring
- NFR55: System must track API latency, database query performance, and React rendering performance
- NFR56: System must alert when P95 response time exceeds 1.5 seconds

**Logging:**
- NFR57: System must integrate with Sentry for centralized log aggregation
- NFR58: Logs must include request tracing IDs for correlation
- NFR59: Logs must be searchable and filterable by org ID, user ID, timestamp
- NFR60: System must retain logs for minimum 90 days for troubleshooting

**Metrics & Dashboards:**
- NFR61: System must expose business metrics dashboards (conversations, users, usage)
- NFR62: System must track resource utilization (CPU, memory, storage, network)
- NFR63: System must monitor 14 KPIs in real-time with historical trends

### Quality

**Code Quality:**
- NFR64: Codebase must maintain >80% test coverage across all packages
- NFR65: All code must pass TypeScript type checking with strict mode enabled
- NFR66: All code must pass linting rules (ESLint) before merge
- NFR67: System must have zero critical security vulnerabilities (Snyk/Dependabot)

**Testing:**
- NFR68: All new features must include unit tests
- NFR69: Critical user flows must have integration tests
- NFR70: API endpoints must have contract tests
- NFR71: Automated tests must run in CI/CD pipeline and block merge on failure

**Documentation:**
- NFR72: All APIs must be auto-documented using OpenAPI/Swagger
- NFR73: API documentation must include code examples and error responses
- NFR74: Shared TypeScript types must be generated from Zod schemas
- NFR75: System must generate migration scripts for database schema changes

### Integration

**Third-Party Services:**
- NFR76: Auth0 integration must handle social logins (Google, GitHub, Microsoft)
- NFR77: Auth0 integration must support MFA (multi-factor authentication)
- NFR78: Supabase integration must use connection pooling for optimal performance
- NFR79: n8n integration must support custom webhooks per agent
- NFR80: n8n integration must be swappable without frontend changes (AI abstraction layer)

**API Standards:**
- NFR81: All REST APIs must follow RESTful principles (resources, verbs, status codes)
- NFR82: APIs must support versioning strategy (/v1/, /v2/ in URL path)
- NFR83: APIs must return consistent error response format (RFC 7807 Problem Details)
- NFR84: List endpoints must support pagination (cursor-based preferred)
- NFR85: List endpoints must support filtering, sorting, and search capabilities

**Data Formats:**
- NFR86: All API requests/responses must use JSON format
- NFR87: All timestamps must use ISO 8601 format
- NFR88: All API responses must include appropriate cache headers
- NFR89: Shared validation schemas must use Zod across frontend and backend
