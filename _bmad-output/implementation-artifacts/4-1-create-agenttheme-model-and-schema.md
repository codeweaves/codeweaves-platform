# Story 4.1: Create AgentTheme Model and Schema

Status: done

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

- [x] **Task 1: Define WidgetTheme Zod Schemas** (AC: 4, 5)
  - [x] 1.1 Create `packages/validation/src/theme.ts`
  - [x] 1.2 Define `iconConfigSchema` — position (left/right), backgroundColor, hoverBackgroundColor, size (40-80), borderRadius (0-50), customImageUrl (optional), shadow
  - [x] 1.3 Define `headerConfigSchema` — title, subtitle (optional), backgroundColor, textColor, subtitleColor, showLogo, logoUrl (optional)
  - [x] 1.4 Define `messageConfigSchema` — backgroundColor, textColor, borderRadius (0-24)
  - [x] 1.5 Define `avatarConfigSchema` — type (robot/machine/bot/support/custom/user), shape (circle/square/rounded), backgroundColor, color, customImageUrl (optional)
  - [x] 1.6 Define `inputConfigSchema` — backgroundColor, textColor, placeholderText, placeholderColor, borderColor, borderRadius (0-24)
  - [x] 1.7 Define `sendButtonConfigSchema` — backgroundColor, hoverBackgroundColor, iconColor, borderRadius (0-24)
  - [x] 1.8 Define `bodyConfigSchema` — backgroundColor
  - [x] 1.9 Define `bubbleConfigSchema` — enabled, text, backgroundColor, textColor, delayMs (number)
  - [x] 1.10 Define `typographyConfigSchema` — fontFamily, baseFontSize
  - [x] 1.11 Define `animationsConfigSchema` — transitionDuration, showTypingIndicator
  - [x] 1.12 Define `timestampsConfigSchema` — show, format (12h/24h), color
  - [x] 1.13 Define `starterSchema` and `startersConfigSchema` — array of `{ text, message }` max 4
  - [x] 1.14 Define `brandingConfigSchema` — enabled, textPrefix, useLogo, linkText, linkUrl, logo (optional), textColor, linkColor
  - [x] 1.15 Define root `widgetThemeSchema` composing all sub-schemas
  - [x] 1.16 Export `WidgetTheme` type from `z.infer`
  - [x] 1.17 Define and export `defaultWidgetTheme` constant with all default values
  - [x] 1.18 Re-export everything from `packages/validation/src/index.ts`

- [x] **Task 2: Prisma Schema** (AC: 1, 2, 3, 6, 7, 8)
  - [x] 2.1 Add `AgentTheme` model to `schema.prisma` with all fields
  - [x] 2.2 Add `theme AgentTheme?` relation on `Agent` model
  - [x] 2.3 Add `@@map("agent_themes")` table mapping
  - [x] 2.4 Add `@@index([agentId])` index
  - [x] 2.5 Run `bunx prisma migrate dev --name add-agent-theme-model`
  - [x] 2.6 Verify generated migration SQL is correct

- [x] **Task 3: DTO Re-exports** (AC: 5)
  - [x] 3.1 Create `apps/api/src/models/agent-theme.dto.ts` re-exporting theme types from `@repo/validation`

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
Claude Opus 4.6

### Debug Log References
- Fixed ESM import extension: `./theme` → `./theme.js` in `packages/validation/src/index.ts` (node16 moduleResolution requires `.js`)
- Fixed lint warning: unused destructured `_` variable in test → `_icon` with eslint-disable comment

### Completion Notes List
- Task 1: Created `packages/validation/src/theme.ts` with 15 Zod sub-schemas, root `widgetThemeSchema`, `WidgetTheme` type, and `defaultWidgetTheme` constant. Added `user` to avatar type enum to match existing defaults. Re-exported from `index.ts`. 48 unit tests written and passing.
- Task 2: Added `AgentTheme` model to Prisma schema with UUID id, unique agentId FK, JSONB config, version (default 1), timestamps. Added `theme AgentTheme?` on Agent model. Cascade delete configured. Migration `20260220130545_add_agent_theme_model` applied successfully.
- Task 3: Created `apps/api/src/models/agent-theme.dto.ts` re-exporting all 16 schemas and 15 types from `@repo/validation`.
- All validations pass: lint (0 warnings), check-types, build, test:cov (616 tests, 33 suites, 0 failures).

### Code Review Fixes (2026-02-20)
- [FIXED][HIGH] Added `colorString` validator (min(1), max(50)) to all ~25 color fields — prevents empty strings and excessively long values
- [FIXED][MED] Exported `partialWidgetThemeSchema` (deepPartial) and `PartialWidgetTheme` type for future PATCH operations (story 4-2)
- [FIXED][LOW] Added `delayMs` upper bound (max 30000ms) to `bubbleConfigSchema`
- [FIXED][LOW] Added tests: invalid `customImageUrl`, empty color rejection, `delayMs` max boundary, `partialWidgetThemeSchema` (5 new tests → 60 total)
- [DEFERRED][MED] `defaultWidgetTheme` values diverge from `defaultPreviewFormData` in `agent-editor-context.tsx` (13+ differences: borderRadius, colors, text, font). The frontend flat structure will be refactored to use WidgetTheme in stories 4-7 through 4-10. No action needed now.
- [DEFERRED][MED] `starters` uses `{ text, message }` objects vs frontend `string[]` — mapping needed in story 4-12 (theme save/reset)
- [DEFERRED][MED] `userAvatarType: 'male'` in frontend is not in WidgetTheme enum (uses `'user'`). Frontend update in later story.
- [FIXED][LOW] Added `cssValueString` validator (min(1), max(200)) for `shadow` field

### Change Log
- 2026-02-20: Story 4.1 implementation complete — WidgetTheme schemas, Prisma AgentTheme model, DTO re-exports
- 2026-02-20: Code review fixes — color validation, partial schema, delayMs bound, 12 new test cases

### File List
- `packages/validation/src/theme.ts` (NEW) — Zod schemas + defaultWidgetTheme + partialWidgetThemeSchema
- `packages/validation/src/index.ts` (MODIFIED) — added re-export of theme.js
- `apps/api/prisma/schema.prisma` (MODIFIED) — AgentTheme model + Agent.theme relation
- `apps/api/prisma/migrations/20260220130545_add_agent_theme_model/migration.sql` (NEW) — migration SQL
- `apps/api/src/models/agent-theme.dto.ts` (NEW) — DTO re-exports (incl. partialWidgetThemeSchema)
- `apps/api/test/models/theme.validation.spec.ts` (NEW) — 60 unit tests
