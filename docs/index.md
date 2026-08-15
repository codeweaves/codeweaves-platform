# CodeWeaves Platform - Documentation Index

> Generated: 2026-02-14 | Scan Level: Quick | Mode: Initial Scan

## Project Overview

- **Type:** Monorepo with 3 application parts
- **Primary Language:** TypeScript 5.9.2
- **Architecture:** Multi-tenant SaaS (Auth0 + NestJS + Next.js)
- **Package Manager:** Bun 1.3.8
- **Orchestrator:** Turborepo 2.6.1

## Quick Reference

### API Backend (`apps/api/`)

- **Type:** Backend (NestJS 11)
- **Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 16, Auth0/Passport JWT
- **Entry Point:** `src/main.ts`
- **Port:** 3001

### Web Dashboard (`apps/web/`)

- **Type:** Web (Next.js 16)
- **Tech Stack:** Next.js 16, React 19, Tailwind CSS 4, Shadcn/ui, Auth0
- **Entry Point:** `app/layout.tsx`
- **Port:** 3000

### Widget (`apps/widget/`)

- **Type:** Embeddable Widget (Preact 10)
- **Tech Stack:** Preact 10, Vite 6
- **Entry Point:** `src/main.tsx`
- **Output:** Single-file `widget.js`

## Generated Documentation

### Project-Wide

- [Project Overview](./project-overview.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Integration Architecture](./integration-architecture.md)
- [Development Guide](./development-guide.md)
- [Project Parts Metadata](./project-parts.json)

### API Backend

- [Architecture - API](./architecture-api.md)
- [API Contracts](./api-contracts-api.md)
- [Data Models](./data-models-api.md)

### Web Dashboard

- [Architecture - Web](./architecture-web.md)
- [Component Inventory - Web](./component-inventory-web.md)

### Widget

- [Architecture - Widget](./architecture-widget.md)

## Existing Documentation

- [README.md](../README.md) - Project overview (generic Turborepo starter)
- [CLAUDE.md](../CLAUDE.md) - Development guidelines and conventions
- [API README](../apps/api/README.md) - Comprehensive API testing and setup guide
- [Web README](../apps/web/README.md) - Next.js getting started
- [.env.example](../.env.example) - Environment configuration template
- [docker-compose.yml](../docker-compose.yml) - Local development services
- [CI/CD Pipeline](../.github/workflows/ci.yml) - GitHub Actions workflow
- [Auth Components README](../apps/web/components/auth/README.md) - Auth component docs

## Getting Started

### First Time Setup

1. Install prerequisites: Node.js >= 18, Bun 1.3.8, Docker
2. Clone the repository and run `bun install`
3. Copy `.env.example` files (see [Development Guide](./development-guide.md))
4. Set up Auth0 tenant and configure environment variables
5. Run `cd apps/api && bun prisma generate && bun prisma migrate deploy`
6. Start Redis: `docker-compose up redis -d`
7. Start dev servers: `bun run dev`

### For AI-Assisted Development

When working with AI tools on this codebase:
1. **Start here** - This index provides the entry point to all project documentation
2. **For API work** - Reference [Architecture - API](./architecture-api.md) + [API Contracts](./api-contracts-api.md)
3. **For Web UI work** - Reference [Architecture - Web](./architecture-web.md) + [Component Inventory](./component-inventory-web.md)
4. **For Widget work** - Reference [Architecture - Widget](./architecture-widget.md)
5. **For full-stack features** - Reference both API and Web architectures + [Integration Architecture](./integration-architecture.md)
6. **For data changes** - Reference [Data Models](./data-models-api.md)

### Pre-Commit Checklist

```bash
bun run lint
bun run check-types
bun run build
bun run test:cov
```
