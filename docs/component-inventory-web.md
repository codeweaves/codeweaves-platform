# Component Inventory - Web Dashboard

> Generated: 2026-02-14 | Part: web | Framework: Next.js 16 + React 19

## Component Library

**Design System:** Shadcn/ui (new-york style)
**CSS Framework:** Tailwind CSS 4
**Icon Library:** Lucide React
**Primitives:** Radix UI

## Components Overview

| Category | Component | Path | Type |
|----------|-----------|------|------|
| Auth | LoginButton | `components/auth/login-button.tsx` | Custom |
| Auth | LogoutButton | `components/auth/logout-button.tsx` | Custom |
| Auth | UserMenu | `components/auth/user-menu.tsx` | Custom |
| UI | Avatar | `components/ui/avatar.tsx` | Shadcn |
| UI | Button | `components/ui/button.tsx` | Shadcn |
| UI | DropdownMenu | `components/ui/dropdown-menu.tsx` | Shadcn |

## Auth Components

### LoginButton (`components/auth/login-button.tsx`)
- **Type:** Client Component
- **Purpose:** Triggers Auth0 login redirect
- **Dependencies:** `@auth0/auth0-react`, Button (Shadcn)

### LogoutButton (`components/auth/logout-button.tsx`)
- **Type:** Client Component
- **Purpose:** Triggers Auth0 logout
- **Dependencies:** `@auth0/auth0-react`, Button (Shadcn)

### UserMenu (`components/auth/user-menu.tsx`)
- **Type:** Client Component
- **Purpose:** User avatar dropdown with profile info and logout
- **Dependencies:** Avatar, DropdownMenu (Shadcn), `@auth0/auth0-react`

## Shadcn UI Components

### Button (`components/ui/button.tsx`)
- **Variants:** default, destructive, outline, secondary, ghost, link
- **Sizes:** default, sm, lg, icon
- **Built with:** `class-variance-authority`

### Avatar (`components/ui/avatar.tsx`)
- **Subcomponents:** Avatar, AvatarImage, AvatarFallback
- **Built with:** `@radix-ui/react-avatar`

### DropdownMenu (`components/ui/dropdown-menu.tsx`)
- **Subcomponents:** DropdownMenu, Trigger, Content, Item, Separator, Label, etc.
- **Built with:** `@radix-ui/react-dropdown-menu`

## Providers

### Auth0Provider (`providers/auth0-provider.tsx`)
- **Type:** Client Component ("use client")
- **Purpose:** Wraps app with Auth0 authentication context
- **Config:** Domain, clientId, audience from env vars
- **Redirect:** `/callback` for post-login

## Hooks

### useAuth (`hooks/use-auth.ts`)
- **Purpose:** Custom wrapper around `useAuth0()`
- **Provides:** User profile, authentication state, login/logout functions

## Library Files

### api-client (`lib/api-client.ts`)
- **Purpose:** HTTP client for backend API communication
- **Auth:** Attaches Auth0 JWT tokens automatically

### utils (`lib/utils.ts`)
- **Purpose:** Utility functions (primarily `cn()` for Tailwind class merging)
- **Dependencies:** `clsx`, `tailwind-merge`

## Pages (App Router)

| Route | File | Type | Purpose |
|-------|------|------|---------|
| `/` | `app/page.tsx` | Server/Client | Home page |
| `/callback` | `app/callback/page.tsx` | Client | Auth0 callback handler |

## Adding New Components

Shadcn components are added via CLI:
```bash
bunx shadcn@latest add <component_name>
```

Configuration in `components.json`:
- Style: new-york
- RSC: enabled
- CSS Variables: enabled
- Base Color: neutral
- Icon Library: lucide
