# Architecture - Web Dashboard

> Generated: 2026-02-14 | Part: web | Type: web

## Overview

The Web Dashboard is a **Next.js 16** application using the App Router pattern with React Server Components. It provides the admin interface for the CodeWeaves Platform, featuring Auth0-based authentication and a Shadcn/ui design system.

## Architecture Pattern

**Component-Based / App Router Architecture**

```
Browser
    │
    ▼
┌──────────────────┐
│   App Router      │  File-system routing (app/ directory)
│   (layout.tsx)    │  Server Components by default
└──────┬───────────┘
       ▼
┌──────────────────┐
│   Providers       │  Client-side context
│   (Auth0Provider) │  Authentication state
└──────┬───────────┘
       ▼
┌──────────────────┐
│   Pages           │  Route-based views
│   (page.tsx)      │  Server + Client components
└──────┬───────────┘
       ▼
┌──────────────────┐
│   Components      │  Reusable UI elements
│   (auth/, ui/)    │  Shadcn + custom components
└──────┬───────────┘
       ▼
┌──────────────────┐
│   Lib / Hooks     │  API client + utilities
│   (api-client.ts) │  Custom auth hook
└──────┬───────────┘
       ▼
┌──────────────────┐
│   API Backend     │  NestJS REST API
│   (apps/api)      │  (external service)
└──────────────────┘
```

## Technology Stack

| Category | Technology | Version | Purpose |
|----------|-----------|---------|---------|
| Framework | Next.js | 16.1.0 | Full-stack React framework |
| UI Library | React | 19.2.0 | Component rendering |
| CSS | Tailwind CSS | 4.x | Utility-first styling |
| Components | Shadcn/ui | new-york | Pre-built UI primitives |
| Primitives | Radix UI | - | Accessible component primitives |
| Icons | Lucide React | 0.563.0 | Icon library |
| Auth | @auth0/auth0-react | 2.12.0 | Client-side authentication |
| Utilities | clsx + tailwind-merge | - | Class name composition |

## Page Structure

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Home / landing page |
| `/callback` | `app/callback/page.tsx` | Auth0 login callback handler |

## Component Architecture

### Auth Components (`components/auth/`)
- **login-button.tsx** - Triggers Auth0 login flow
- **logout-button.tsx** - Handles user logout
- **user-menu.tsx** - User avatar dropdown with profile/logout options

### UI Components (`components/ui/`) - Shadcn
- **button.tsx** - Button with variants (default, destructive, outline, etc.)
- **avatar.tsx** - User avatar with image/fallback
- **dropdown-menu.tsx** - Accessible dropdown menu

## State Management

The web app uses a **minimal state approach**:

1. **Auth0 Provider** (`providers/auth0-provider.tsx`)
   - Wraps the entire app in `Auth0Provider`
   - Manages authentication state (user, tokens, loading)
   - Client-side component ("use client")

2. **Custom Auth Hook** (`hooks/use-auth.ts`)
   - Wraps `useAuth0()` for app-specific auth logic
   - Provides user profile, login/logout functions

3. **No global state store** - Relies on:
   - React Server Components for server-side data
   - Auth0 context for auth state
   - Local component state where needed

## Styling System

- **Tailwind CSS 4** with PostCSS
- **Shadcn/ui** (new-york style, neutral base color)
- **CSS Variables** for theming (`globals.css`)
- **Geist** font family (mono + sans)
- **tw-animate-css** for animations

## API Integration

**File:** `lib/api-client.ts`

- HTTP client that communicates with the NestJS API
- Attaches Auth0 JWT tokens to requests
- Base URL configured via environment variable

## UI Conventions (Dashboard & Widget)

These conventions apply to **all** dashboard pages and the embeddable widget.

### Input Handling
- **Trimming**: Always `trimStart()` on `onChange`, `trim()` before submitting or sending to API
- **Max length**: All text inputs must have a sensible `maxLength` (e.g. 100 for names, 255 for descriptions)
- **Search inputs**: 300ms debounce, trim value before API call

### Tables (DataTable component)
- **Cell text**: Uniform font weight and color for data rows — only headers use `font-medium`
- **Left padding**: First column gets extra left spacing (`first:pl-4` on `TableHead`/`TableCell`)
- **Long text**: Use `break-all` on cells that may contain long text (names, slugs, URLs)
- **No `whitespace-nowrap`** on `TableCell` — allows text wrapping with `break-all`
- **Pagination**: Icon-only chevron buttons (no text labels), only rendered when `totalPages > 1`

### Dialogs & Forms
- **Slug/preview overflow**: Use `truncate` class for previews in dialogs
- **Validation**: Min length checks before submit, inline error messages via `text-destructive`

### Reusable DataTable (`components/ui/data-table/`)
- Server mode (paginated, API-driven) and simple mode (client-side) via discriminated union
- Sub-components: toolbar (search + actions), pagination, skeleton, empty state, sortable column header
- State management is caller-controlled via `onStateChange` — DataTable doesn't manage URL params

## Configuration

| Env Variable | Purpose |
|-------------|---------|
| `NEXT_PUBLIC_AUTH0_DOMAIN` | Auth0 tenant domain |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Auth0 client ID |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | Auth0 API audience |
| `NEXT_PUBLIC_API_URL` | Backend API base URL |

## Entry Point

**File:** `app/layout.tsx`

Root layout wrapping all pages with:
- HTML structure and metadata
- Auth0Provider (client-side)
- Global CSS import
- Font configuration
