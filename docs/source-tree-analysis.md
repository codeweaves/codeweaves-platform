# Source Tree Analysis - CodeWeaves Platform

> Generated: 2026-02-14 | Scan Level: Quick | Mode: Initial Scan

## Repository Structure

**Type:** Monorepo (Turborepo + Bun Workspaces)

```
codeweaves-platform/
├── apps/                          # Application packages
│   ├── api/                       # NestJS API Backend (Part: api)
│   │   ├── prisma/                # Database schema & migrations
│   │   │   ├── schema.prisma      # Prisma schema (3 models)
│   │   │   └── migrations/        # SQL migrations
│   │   ├── src/
│   │   │   ├── main.ts            # ★ Entry point (NestJS bootstrap)
│   │   │   ├── controllers/       # HTTP request handlers
│   │   │   │   ├── auth/          # Authenticated endpoints
│   │   │   │   │   └── users.controller.ts    # User CRUD operations
│   │   │   │   └── public/        # Public endpoints
│   │   │   │       └── health.controller.ts   # Health check
│   │   │   ├── services/          # Business logic layer
│   │   │   │   ├── app.service.ts
│   │   │   │   ├── prisma.service.ts          # Database connection
│   │   │   │   └── users.service.ts           # User operations
│   │   │   ├── modules/           # NestJS dependency injection
│   │   │   │   ├── app.module.ts              # Root module
│   │   │   │   ├── auth.module.ts             # Auth configuration
│   │   │   │   ├── prisma.module.ts           # DB module
│   │   │   │   └── users.module.ts            # Users feature module
│   │   │   ├── guards/
│   │   │   │   └── jwt-auth.guard.ts          # JWT authentication guard
│   │   │   ├── interceptors/
│   │   │   │   └── user-sync.interceptor.ts   # Auth0 → DB user sync
│   │   │   ├── decorators/
│   │   │   │   ├── current-user.decorator.ts  # @CurrentUser() decorator
│   │   │   │   └── public.decorator.ts        # @Public() route decorator
│   │   │   ├── strategies/
│   │   │   │   └── jwt.strategy.ts            # Passport JWT strategy
│   │   │   ├── interfaces/
│   │   │   │   └── jwt-payload.interface.ts   # JWT payload type
│   │   │   └── models/
│   │   │       └── user.dto.ts                # User data transfer object
│   │   ├── test/                  # Unit & integration tests
│   │   │   ├── controllers/       # Controller tests (2 specs)
│   │   │   ├── services/          # Service tests (2 specs)
│   │   │   ├── guards/            # Guard tests (1 spec)
│   │   │   ├── interceptors/      # Interceptor tests (1 spec)
│   │   │   ├── decorators/        # Decorator tests (1 spec)
│   │   │   ├── strategies/        # Strategy tests (1 spec)
│   │   │   ├── setup/             # Test setup (global, teardown, jest)
│   │   │   └── utils/             # Test utilities (jwt.helper.ts)
│   │   ├── nest-cli.json
│   │   ├── jest.config.cjs        # Unit test config
│   │   ├── jest.e2e.config.cjs    # E2E test config
│   │   └── package.json
│   │
│   ├── web/                       # Next.js Web Dashboard (Part: web)
│   │   ├── app/                   # Next.js App Router
│   │   │   ├── layout.tsx         # ★ Root layout (entry point)
│   │   │   ├── page.tsx           # Home page
│   │   │   ├── callback/
│   │   │   │   └── page.tsx       # Auth0 callback handler
│   │   │   ├── globals.css        # Tailwind CSS + theme variables
│   │   │   └── fonts/             # Geist font files
│   │   ├── components/
│   │   │   ├── auth/              # Authentication UI components
│   │   │   │   ├── login-button.tsx
│   │   │   │   ├── logout-button.tsx
│   │   │   │   └── user-menu.tsx
│   │   │   └── ui/                # Shadcn UI components
│   │   │       ├── avatar.tsx
│   │   │       ├── button.tsx
│   │   │       └── dropdown-menu.tsx
│   │   ├── providers/
│   │   │   └── auth0-provider.tsx # Auth0 context provider
│   │   ├── hooks/
│   │   │   └── use-auth.ts        # Custom auth hook
│   │   ├── lib/
│   │   │   ├── api-client.ts      # → Calls api/ endpoints
│   │   │   └── utils.ts           # Utility functions (cn, etc.)
│   │   ├── public/                # Static assets
│   │   ├── components.json        # Shadcn configuration
│   │   ├── next.config.js
│   │   ├── postcss.config.mjs
│   │   └── package.json
│   │
│   └── widget/                    # Preact Embeddable Widget (Part: widget)
│       ├── src/
│       │   ├── main.tsx           # ★ Entry point
│       │   └── App.tsx            # Root component
│       ├── index.html             # Widget HTML shell
│       ├── vite.config.ts         # Build config (single-file output)
│       └── package.json
│
├── packages/                      # Shared configuration packages
│   ├── eslint-config/             # Shared ESLint rules
│   │   ├── base.js                # Base config for all packages
│   │   ├── jest.js                # Jest-specific rules
│   │   ├── next.js                # Next.js rules
│   │   └── react-internal.js      # React internal rules
│   ├── jest-config/               # Shared Jest configurations
│   │   ├── base.js                # Base test config
│   │   ├── node.js                # Node.js test config (API)
│   │   └── react.js               # React test config (Web)
│   ├── typescript-config/         # Shared TS configs
│   │   ├── base.json              # Base TypeScript config
│   │   ├── nextjs.json            # Next.js TS config
│   │   └── react-library.json     # React library TS config
│   └── validation/                # Shared validation schemas
│       └── src/index.ts           # Zod schemas (shared across apps)
│
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions CI pipeline
├── docker-compose.yml             # Local dev: Redis + API + Web
├── turbo.json                     # Turborepo task configuration
├── package.json                   # Root workspace config
├── CLAUDE.md                      # Development guidelines
└── README.md                      # Project README
```

## Critical Folders

| Folder | Purpose | Part |
|--------|---------|------|
| `apps/api/src/controllers/` | HTTP endpoint handlers | api |
| `apps/api/src/services/` | Business logic | api |
| `apps/api/src/modules/` | NestJS DI modules | api |
| `apps/api/src/guards/` | Authentication guards | api |
| `apps/api/prisma/` | Database schema & migrations | api |
| `apps/web/app/` | Next.js pages & routes | web |
| `apps/web/components/` | React UI components | web |
| `apps/web/providers/` | Context providers | web |
| `apps/web/lib/` | API client & utilities | web |
| `apps/widget/src/` | Widget source | widget |
| `packages/validation/` | Shared Zod schemas | shared |

## Entry Points

| Part | File | Description |
|------|------|-------------|
| api | `apps/api/src/main.ts` | NestJS application bootstrap |
| web | `apps/web/app/layout.tsx` | Next.js root layout (App Router) |
| widget | `apps/widget/src/main.tsx` | Preact widget mount point |

## Integration Paths

- **web → api**: `apps/web/lib/api-client.ts` makes HTTP calls to the API
- **api ← Auth0**: JWT tokens validated via `jwt.strategy.ts` + `jwks-rsa`
- **web ← Auth0**: `@auth0/auth0-react` SDK in `auth0-provider.tsx`
- **widget → api**: (planned) Widget will call API endpoints
