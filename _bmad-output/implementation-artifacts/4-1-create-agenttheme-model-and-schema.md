# Story 4.1: Create AgentTheme Model and Schema

Status: ready-for-dev

## Story

As a **backend developer**,
I want an AgentTheme database model with JSONB config storage,
so that widget appearance settings can be stored and versioned per agent.

## Acceptance Criteria

1. **AC1:** `AgentTheme` table stores: `id` (UUID), `agentId` (unique FK to Agent), `config` (JSONB — full WidgetTheme object), `version` (Int, default 1), `createdAt`, `updatedAt`
2. **AC2:** One-to-one relationship with Agent (optional on Agent side) — cascading delete when agent is deleted
3. **AC3:** `version` field increments on every config update (cache busting per ADR-009)
4. **AC4:** Default theme values are defined in `packages/validation/src/theme.ts` as a `defaultWidgetTheme` constant
5. **AC5:** Zod validation schemas for WidgetTheme and all sub-objects are defined in `packages/validation/src/theme.ts` and re-exported from `packages/validation/src/index.ts`
6. **AC6:** Prisma migration creates the table successfully with `prisma migrate dev`
7. **AC7:** `config` column uses Postgres JSONB type for efficient querying
8. **AC8:** Agent model gains an optional `theme AgentTheme?` relation

## Tasks / Subtasks

- [ ] **Task 1: Define WidgetTheme Zod Schemas** (AC: 4, 5)
  - [ ] 1.1 Create `packages/validation/src/theme.ts`
  - [ ] 1.2 Define `iconConfigSchema` — position (left/right), backgroundColor, hoverBackgroundColor, size (40-80), borderRadius (0-50), customImageUrl (optional), shadow
  - [ ] 1.3 Define `headerConfigSchema` — title, subtitle (optional), backgroundColor, textColor, subtitleColor, showLogo, logoUrl (optional)
  - [ ] 1.4 Define `messageConfigSchema` — backgroundColor, textColor, borderRadius (0-24)
  - [ ] 1.5 Define `avatarConfigSchema` — type (robot/machine/bot/support/custom), shape (circle/square/rounded), backgroundColor, color, customImageUrl (optional)
  - [ ] 1.6 Define `inputConfigSchema` — backgroundColor, textColor, placeholderText, placeholderColor, borderColor, borderRadius (0-24)
  - [ ] 1.7 Define `sendButtonConfigSchema` — backgroundColor, hoverBackgroundColor, iconColor, borderRadius (0-24)
  - [ ] 1.8 Define `bodyConfigSchema` — backgroundColor
  - [ ] 1.9 Define `bubbleConfigSchema` — enabled, text, backgroundColor, textColor, delayMs (number)
  - [ ] 1.10 Define `typographyConfigSchema` — fontFamily, baseFontSize
  - [ ] 1.11 Define `animationsConfigSchema` — transitionDuration, showTypingIndicator
  - [ ] 1.12 Define `timestampsConfigSchema` — show, format (12h/24h), color
  - [ ] 1.13 Define `starterSchema` and `startersConfigSchema` — array of `{ text, message }` max 4
  - [ ] 1.14 Define `brandingConfigSchema` — enabled, textPrefix, useLogo, linkText, linkUrl, logo (optional), textColor, linkColor
  - [ ] 1.15 Define root `widgetThemeSchema` composing all sub-schemas
  - [ ] 1.16 Export `WidgetTheme` type from `z.infer`
  - [ ] 1.17 Define and export `defaultWidgetTheme` constant with all default values
  - [ ] 1.18 Re-export everything from `packages/validation/src/index.ts`

- [ ] **Task 2: Prisma Schema** (AC: 1, 2, 3, 6, 7, 8)
  - [ ] 2.1 Add `AgentTheme` model to `schema.prisma` with all fields
  - [ ] 2.2 Add `theme AgentTheme?` relation on `Agent` model
  - [ ] 2.3 Add `@@map("agent_themes")` table mapping
  - [ ] 2.4 Add `@@index([agentId])` index
  - [ ] 2.5 Run `bunx prisma migrate dev --name add-agent-theme-model`
  - [ ] 2.6 Verify generated migration SQL is correct

- [ ] **Task 3: DTO Re-exports** (AC: 5)
  - [ ] 3.1 Create `apps/api/src/models/agent-theme.dto.ts` re-exporting theme types from `@repo/validation`

## Dev Notes

### Prisma Schema — Exact Model

Add to `schema.prisma`:

```prisma
model AgentTheme {
  id        String   @id @default(uuid())
  agentId   String   @unique
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  config    Json     // Stores full WidgetTheme object as JSONB
  version   Int      @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([agentId])
  @@map("agent_themes")
}
```

Also add to `Agent` model:

```prisma
theme AgentTheme?
```

### WidgetTheme Default Values

Match the `defaultPreviewFormData` in `agent-editor-context.tsx` — these are the production defaults:

```typescript
export const defaultWidgetTheme: WidgetTheme = {
  icon: {
    position: 'right',
    backgroundColor: '#3b82f6',
    hoverBackgroundColor: '#2563eb',
    size: 56,
    borderRadius: 50,
    shadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },
  header: {
    title: 'Chat with us',
    subtitle: 'We usually reply within a few minutes',
    backgroundColor: '#3b82f6',
    textColor: '#ffffff',
    subtitleColor: '#e0e7ff',
    showLogo: false,
  },
  userMessage: {
    backgroundColor: '#3b82f6',
    textColor: '#ffffff',
    borderRadius: 16,
  },
  botMessage: {
    backgroundColor: '#f3f4f6',
    textColor: '#1f2937',
    borderRadius: 16,
  },
  botAvatar: {
    type: 'robot',
    shape: 'circle',
    backgroundColor: '#e0e7ff',
    color: '#3b82f6',
  },
  userAvatar: {
    type: 'user',
    shape: 'circle',
    backgroundColor: '#dbeafe',
    color: '#3b82f6',
  },
  input: {
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    placeholderText: 'Type your message...',
    placeholderColor: '#9ca3af',
    borderColor: '#e5e7eb',
    borderRadius: 12,
  },
  sendButton: {
    backgroundColor: '#3b82f6',
    hoverBackgroundColor: '#2563eb',
    iconColor: '#ffffff',
    borderRadius: 12,
  },
  body: {
    backgroundColor: '#ffffff',
  },
  bubble: {
    enabled: true,
    text: 'Hi there! How can I help?',
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    delayMs: 3000,
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    baseFontSize: 14,
  },
  animations: {
    transitionDuration: 200,
    showTypingIndicator: true,
  },
  timestamps: {
    show: true,
    format: '12h',
    color: '#9ca3af',
  },
  starters: [],
  branding: {
    enabled: true,
    textPrefix: 'Powered by',
    useLogo: false,
    linkText: 'CodeWeaves',
    linkUrl: 'https://codeweaves.com',
    textColor: '#9ca3af',
    linkColor: '#3b82f6',
  },
};
```

### Project Structure Notes

- Validation schemas go in `packages/validation/src/theme.ts` — new file, re-exported from index
- Follow `packages/validation/` pattern for exporting types alongside schemas
- The `config` JSONB column will be validated at the application layer (Zod), not at the DB level
- Keep avatar fields (bot + user) as separate top-level keys in the theme, not nested under messages

### References

- [Source: `_bmad-output/planning-artifacts/architecture.md`] — AgentTheme model spec, WidgetTheme schema (section 8.2), cache config
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1447-1462] — Story 4.1 acceptance criteria
- [Source: `apps/web/components/features/agents/agent-editor/agent-editor-context.tsx`] — PreviewFormData and defaults (lines 77-195)
- [Source: `apps/api/prisma/schema.prisma`] — existing Agent model, AgentSecret model patterns
- [Source: `packages/validation/src/index.ts`] — existing schema patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
