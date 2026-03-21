# Story 10.6: Voice Configuration Schema & Database

Status: review

## Story

As a **developer**,
I want a voice configuration schema stored per-agent,
So that each agent can have independent voice settings.

## Acceptance Criteria

1. `voiceEnabled` Boolean field added to Agent model (default: false)
2. `voiceConfig` JSONB column added to Agent model via Prisma migration
3. Zod schema `voiceConfigSchema` validates the config in `packages/validation`
4. Schema includes: `sttEnabled`, `ttsEnabled`, `sttProvider`, `ttsProvider`, `defaultLanguage`, `supportedLanguages`, `ttsVoiceId`, `ttsSpeed`, `autoDetectLanguage`
5. Agent CRUD endpoints (`PATCH /agents/:id`) accept `voiceEnabled` and `voiceConfig` fields
6. Widget config response includes `voiceConfig` when voice is enabled
7. Defaults are sensible: `sttEnabled: true`, `ttsEnabled: true`, `defaultLanguage: 'en'`, `autoDetectLanguage: true`
8. Unit tests verify schema validation, defaults, and agent update with voice config

## Tasks / Subtasks

- [x] Task 1: Prisma schema migration (AC: #1, #2)
  - [x] 1.1 Add `voiceEnabled Boolean @default(false)` to Agent model in `apps/api/prisma/schema.prisma`
  - [x] 1.2 Add `voiceConfig Json? @db.JsonB` to Agent model
  - [x] 1.3 Run `bunx prisma migrate dev --name add-agent-voice-config`
  - [x] 1.4 Verify migration creates both columns with correct types and defaults

- [x] Task 2: Zod validation schemas (AC: #3, #4, #7)
  - [x] 2.1 Create `voiceProviderEnum` in `packages/validation/src/voice.ts` (if not already from 10-1)
  - [x] 2.2 Create `voiceConfigSchema` with all fields and defaults
  - [x] 2.3 Export `VoiceConfig` type via `z.infer`
  - [x] 2.4 Export from `packages/validation/src/index.ts`

- [x] Task 3: Update agent schemas (AC: #5)
  - [x] 3.1 Add `voiceEnabled: z.boolean().optional()` to `updateAgentSchema` in `packages/validation/src/index.ts`
  - [x] 3.2 Add `voiceConfig: voiceConfigSchema.optional()` to `updateAgentSchema`
  - [x] 3.3 Update the `.refine()` validator to include voice fields in "at least one field" check
  - [x] 3.4 Ensure `createAgentSchema` does NOT include voice fields (agents start with voice disabled)

- [x] Task 4: Update AgentsService (AC: #5)
  - [x] 4.1 Update `update()` method in `apps/api/src/services/agents.service.ts` to handle `voiceEnabled` and `voiceConfig`
  - [x] 4.2 When saving `voiceConfig`, validate with `voiceConfigSchema.parse()` before writing to DB
  - [x] 4.3 When returning agent data, include `voiceEnabled` and `voiceConfig` in responses
  - [x] 4.4 If `voiceEnabled` is set to `false`, optionally preserve `voiceConfig` (don't delete it — user may re-enable)

- [x] Task 5: Update agent response DTOs (AC: #5, #6)
  - [x] 5.1 Ensure agent list and detail responses include `voiceEnabled` field
  - [x] 5.2 Ensure agent detail response includes `voiceConfig` (parsed from JSONB)
  - [x] 5.3 For widget config response (when it exists), include `voiceConfig` only when `voiceEnabled: true`

- [x] Task 6: Add environment variables placeholder (AC: #5)
  - [x] 6.1 Ensure `.env.example` has voice provider API keys (may already exist from 10-1):
    ```
    # Voice Providers (Epic 10)
    SARVAM_API_KEY=
    DEEPGRAM_API_KEY=
    ELEVENLABS_API_KEY=
    ELEVENLABS_DEFAULT_VOICE_ID=
    ```

- [x] Task 7: Unit tests (AC: #8)
  - [x] 7.1 Update `apps/api/test/services/agents/agents.service.spec.ts`
  - [x] 7.2 Test updating agent with `voiceEnabled: true`
  - [x] 7.3 Test updating agent with full `voiceConfig` object
  - [x] 7.4 Test `voiceConfig` validation rejects invalid values (bad provider name, speed out of range)
  - [x] 7.5 Test `voiceConfig` defaults are applied for missing fields
  - [x] 7.6 Test disabling voice preserves voiceConfig
  - [x] 7.7 Test agent response includes voice fields

## Dev Notes

### Current Agent Model (schema.prisma)

```prisma
model Agent {
  id             String        @id @default(uuid())
  publicId       String        @unique @db.VarChar(8)
  name           String
  status         AgentStatus   @default(ACTIVE)
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id])
  allowedDomains String[]
  hmacEnabled    Boolean       @default(false)
  systemPrompt   String?       @db.Text
  welcomeMessage String?
  secret         AgentSecret?
  theme          AgentTheme?
  chatSessions   ChatSession[]
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  deletedAt      DateTime?

  @@index([publicId])
  @@index([organizationId])
  @@index([status])
  @@map("agents")
}
```

### After Migration — Add These Fields

```prisma
model Agent {
  // ... existing fields ...
  hmacEnabled    Boolean       @default(false)
  voiceEnabled   Boolean       @default(false)     // NEW
  voiceConfig    Json?         @db.JsonB            // NEW
  systemPrompt   String?       @db.Text
  // ... rest of existing fields ...
}
```

Place `voiceEnabled` and `voiceConfig` near `hmacEnabled` — they follow the same pattern (feature toggle + config).

### Voice Config Schema

```typescript
// packages/validation/src/voice.ts

export const voiceProviderEnum = z.enum(['sarvam', 'deepgram', 'elevenlabs']);

export const voiceConfigSchema = z.object({
  sttEnabled: z.boolean().default(true),
  ttsEnabled: z.boolean().default(true),
  sttProvider: voiceProviderEnum.optional(),       // null = auto-route
  ttsProvider: voiceProviderEnum.optional(),       // null = auto-route
  defaultLanguage: z.string().default('en'),
  supportedLanguages: z.array(z.string()).default(['en']),
  ttsVoiceId: z.string().optional(),              // Provider-specific voice ID
  ttsSpeed: z.number().min(0.5).max(2.0).default(1.0),
  autoDetectLanguage: z.boolean().default(true),
});

export type VoiceConfig = z.infer<typeof voiceConfigSchema>;
```

**If voice.ts already exists from story 10-1**, add to it. If not, create it and export from `index.ts`.

### Update Agent Schema Pattern

Current `updateAgentSchema`:
```typescript
export const updateAgentSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    status: agentStatusEnum.optional(),
    allowedDomains: allowedDomainsSchema.optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.status !== undefined || data.allowedDomains !== undefined,
    { message: 'At least one field must be provided' },
  );
```

**Updated:**
```typescript
export const updateAgentSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    status: agentStatusEnum.optional(),
    allowedDomains: allowedDomainsSchema.optional(),
    voiceEnabled: z.boolean().optional(),
    voiceConfig: voiceConfigSchema.optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.status !== undefined ||
      data.allowedDomains !== undefined ||
      data.voiceEnabled !== undefined ||
      data.voiceConfig !== undefined,
    { message: 'At least one field must be provided' },
  );
```

### Agent Service Update Pattern

Follow the existing `update()` method pattern in `apps/api/src/services/agents.service.ts`. The service already handles partial updates via Prisma:

```typescript
// In agents.service.ts update method, add to the Prisma update data:
const updateData: Prisma.AgentUpdateInput = {};

if (dto.voiceEnabled !== undefined) {
  updateData.voiceEnabled = dto.voiceEnabled;
}

if (dto.voiceConfig !== undefined) {
  // Validate before saving to DB
  const parsed = voiceConfigSchema.parse(dto.voiceConfig);
  updateData.voiceConfig = parsed as Prisma.InputJsonValue;
}
```

### JSONB Storage Pattern

The codebase already uses JSONB for `AgentTheme.config`:
```prisma
model AgentTheme {
  config    Json     // Stores full WidgetTheme object as JSONB
}
```

Follow the same pattern. The `voiceConfig` JSONB stores the full `VoiceConfig` object. Parse with Zod on read, validate with Zod on write.

### Example voiceConfig Values

**Default (voice just enabled, no customization):**
```json
{
  "sttEnabled": true,
  "ttsEnabled": true,
  "defaultLanguage": "en",
  "supportedLanguages": ["en"],
  "ttsSpeed": 1.0,
  "autoDetectLanguage": true
}
```

**Indian market agent:**
```json
{
  "sttEnabled": true,
  "ttsEnabled": true,
  "sttProvider": "sarvam",
  "ttsProvider": "sarvam",
  "defaultLanguage": "hi",
  "supportedLanguages": ["en", "hi", "mr", "hinglish"],
  "ttsVoiceId": "Anushka",
  "ttsSpeed": 1.0,
  "autoDetectLanguage": true
}
```

**English-only premium voice:**
```json
{
  "sttEnabled": true,
  "ttsEnabled": true,
  "sttProvider": "deepgram",
  "ttsProvider": "elevenlabs",
  "defaultLanguage": "en",
  "supportedLanguages": ["en"],
  "ttsVoiceId": "Xb7hH8MSUJpSbSDYk0k2",
  "ttsSpeed": 1.0,
  "autoDetectLanguage": false
}
```

### What NOT to Do

- **Do NOT** create a separate `AgentVoiceConfig` model/table — use JSONB column on Agent (simpler, matches AgentTheme pattern)
- **Do NOT** add voice fields to `createAgentSchema` — agents start with voice disabled, configure later
- **Do NOT** delete `voiceConfig` when `voiceEnabled` is set to false — preserve settings for re-enabling
- **Do NOT** add indexes on `voiceConfig` — JSONB queries not needed, we only read the whole object
- **Do NOT** implement the dashboard UI for editing voice config — that's story 10-10
- **Do NOT** modify the voice controller — that's story 10-7

### Dependencies

- **Soft dependency on story 10-1** (voice.ts Zod schemas may already exist)
- No hard dependency on provider stories (10-2, 10-3, 10-4) — this is schema only
- Story 10-5 (VoiceService) reads from this schema — can be developed in parallel

### Project Structure Notes

- Prisma schema: `apps/api/prisma/schema.prisma`
- Validation: `packages/validation/src/voice.ts` + `packages/validation/src/index.ts`
- Agent service: `apps/api/src/services/agents.service.ts`
- Agent tests: `apps/api/test/services/agents/agents.service.spec.ts`

### References

- [Architecture: Section 20.6 - Voice Configuration Schema](_bmad-output/planning-artifacts/architecture.md)
- [Architecture: Section 20.7 - Database Schema Additions](_bmad-output/planning-artifacts/architecture.md)
- [Current Prisma schema](apps/api/prisma/schema.prisma) — Agent model at line 100
- [Current agent validation](packages/validation/src/index.ts) — `updateAgentSchema` at line 180
- [AgentTheme JSONB pattern](apps/api/prisma/schema.prisma) — AgentTheme model at line 137
- [Agent service](apps/api/src/services/agents.service.ts)
- [Story 10-1: Voice Provider Interface](_bmad-output/implementation-artifacts/10-1-voice-provider-interface-adapter-foundation.md) — may have voice.ts already

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Supabase project was paused/unhealthy during initial migration attempt — waited for DB to come online before running migration
- Bun + Jest `stack-utils` readonly property error affects all test suites when run from `apps/api` directly — must run from monorepo root via `bun run test`

### Completion Notes List
- ✅ Task 1: Migration `20260321054050_add_agent_voice_config` applied — added `voiceEnabled` (Boolean, default false) and `voiceConfig` (JSONB, nullable) to Agent model
- ✅ Task 2: `voiceConfigSchema` already existed from story 10-1 in `packages/validation/src/voice.ts` — verified all fields match AC #3, #4, #7
- ✅ Task 3: `updateAgentSchema` updated with `voiceEnabled` and `voiceConfig` optional fields, refine check extended, `createAgentSchema` left untouched
- ✅ Task 4: `AgentsService.update()` handles both voice fields — Zod validates `voiceConfig` before DB write, `voiceConfig` preserved when disabling voice
- ✅ Task 5: Agent list/detail responses include voice fields (Prisma returns full model). `getDemoInfo` conditionally returns `voiceConfig` only when `voiceEnabled: true`
- ✅ Task 6: `.env.example` already has all 4 voice provider keys from story 10-1
- ✅ Task 7: 9 unit tests added covering all 7 subtasks — voiceEnabled toggle, full config update, invalid provider rejection, ttsSpeed range validation, defaults, preserve on disable, response inclusion, widget conditional config
- ✅ All 1114 tests pass, lint clean, type-check clean, build successful

### File List
- `apps/api/prisma/schema.prisma` — Added `voiceEnabled` and `voiceConfig` fields to Agent model
- `apps/api/prisma/migrations/20260321054050_add_agent_voice_config/migration.sql` — Migration file
- `packages/validation/src/index.ts` — Added `voiceEnabled` and `voiceConfig` to `updateAgentSchema`, imported `voiceConfigSchema`
- `apps/api/src/services/agents.service.ts` — Updated `update()` with voice field handling, updated `getDemoInfo` with conditional voiceConfig
- `apps/api/test/services/agents/agents.service.spec.ts` — Added 9 voice config tests (2 describe blocks), added `agentTheme` to mock, added `voiceEnabled`/`voiceConfig` to mockAgent

### Change Log
- 2026-03-21: Implemented story 10-6 — Voice Configuration Schema & Database. Added voiceEnabled/voiceConfig to Agent model, updated PATCH endpoint, added 9 unit tests. All 1114 tests pass.
