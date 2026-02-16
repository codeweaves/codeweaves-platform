# Project Overview - CodeWeaves Platform

> Generated: 2026-02-14 | Scan Level: Quick | Mode: Initial Scan

## Executive Summary

CodeWeaves Platform is a multi-tenant SaaS application built as a **TypeScript monorepo**. It provides a web dashboard for managing organizations and users, backed by a NestJS API with Auth0 authentication, and includes an embeddable Preact widget for customer-facing integrations.

The platform is in **early development** (Sprint 1), with the authentication and user management foundation established. The architecture follows a clean separation between the API backend, web dashboard, and embeddable widget.

## Project Identity

| Property | Value |
|----------|-------|
| **Name** | codeweaves-platform |
| **Type** | Multi-tenant SaaS Platform |
| **Repository** | Monorepo (Turborepo + Bun Workspaces) |
| **Language** | TypeScript 5.9.2 |
| **Package Manager** | Bun 1.3.8 |
| **Orchestrator** | Turborepo 2.6.1 |
| **Node Version** | >= 18 (CI uses 24) |

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                   Client                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │ Web App  │  │  Widget  │  │  External  │ │
│  │ (Next.js)│  │ (Preact) │  │  Clients   │ │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘ │
└───────┼──────────────┼──────────────┼───────┘
        │              │              │
   ┌────▼──────────────▼──────────────▼────┐
   │          Auth0 (Identity Provider)     │
   └────────────────┬──────────────────────┘
                    │ JWT Tokens
   ┌────────────────▼──────────────────────┐
   │         NestJS API (apps/api)          │
   │  ┌──────┐  ┌────────┐  ┌──────────┐  │
   │  │Guards│  │Services│  │Controllers│  │
   │  └──┬───┘  └───┬────┘  └─────┬────┘  │
   │     └───────────┼─────────────┘       │
   │           ┌─────▼─────┐               │
   │           │   Prisma   │               │
   │           └─────┬─────┘               │
   └─────────────────┼────────────────────┘
                     │
   ┌─────────────────▼────────────────────┐
   │    PostgreSQL (Supabase Cloud)        │
   │    Redis (Local/Docker)               │
   └──────────────────────────────────────┘
```

## Technology Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| **API** | NestJS | 11.x |
| **ORM** | Prisma | 7.3.0 |
| **Database** | PostgreSQL | 16 (Supabase) |
| **Cache** | Redis | 7 |
| **Auth** | Auth0 | - |
| **Web** | Next.js | 16.1.0 |
| **UI** | React + Shadcn/ui | 19.2.0 |
| **CSS** | Tailwind CSS | 4.x |
| **Widget** | Preact + Vite | 10.26.0 / 6.3.0 |
| **Testing** | Jest + Testcontainers | 29.x |
| **CI/CD** | GitHub Actions | - |
| **Monorepo** | Turborepo | 2.6.1 |

## Parts Summary

### 1. API (`apps/api/`) - Backend Service
- NestJS 11 REST API
- Prisma ORM with PostgreSQL (Supabase)
- Auth0 JWT authentication with Passport
- Multi-tenant data model (Organization → User → Invitation)
- 8 unit test files with full coverage setup

### 2. Web (`apps/web/`) - Dashboard
- Next.js 16 with App Router and React Server Components
- Auth0 React SDK for authentication
- Shadcn/ui component library (new-york style)
- Tailwind CSS 4 for styling
- API client for backend communication

### 3. Widget (`apps/widget/`) - Embeddable Component
- Preact 10 for minimal bundle size
- Vite 6 with single-file output (widget.js)
- Designed for CDN deployment and customer embedding

### 4. Shared Packages (`packages/`)
- **eslint-config**: Shared linting rules (base, jest, next, react-internal)
- **jest-config**: Shared test configs (base, node, react)
- **typescript-config**: Shared TS configs (base, nextjs, react-library)
- **validation**: Shared Zod validation schemas

## Links to Detailed Documentation

- [Source Tree Analysis](./source-tree-analysis.md)
- [Architecture - API](./architecture-api.md)
- [Architecture - Web](./architecture-web.md)
- [Architecture - Widget](./architecture-widget.md)
- [API Contracts](./api-contracts-api.md)
- [Data Models](./data-models-api.md)
- [Component Inventory - Web](./component-inventory-web.md)
- [Development Guide](./development-guide.md)
- [Integration Architecture](./integration-architecture.md)
