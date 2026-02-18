# Story 4.2: Create Theme API Endpoints

Status: ready-for-dev

## Story

As an **agent owner**,
I want API endpoints for theme management,
so that I can save, retrieve, and reset theme configurations for my agents.

## Acceptance Criteria

1. **AC1:** `GET /agents/:id/theme` returns the current theme config with version, or default theme if none saved
2. **AC2:** `PUT /agents/:id/theme` saves the entire theme config, increments version, returns updated theme
3. **AC3:** `PATCH /agents/:id/theme` merges partial theme updates into existing config, increments version
4. **AC4:** `POST /agents/:id/theme/reset` resets theme to defaults, increments version
5. **AC5:** Version is incremented on every PUT, PATCH, or reset operation (cache busting)
6. **AC6:** ETag header is set on GET response using the version number
7. **AC7:** Only ADMIN, SUPER_ADMIN, and CLIENT (own org) can access theme endpoints — same scoping as agent access
8. **AC8:** Theme config is validated against `widgetThemeSchema` on PUT, partial validation on PATCH
9. **AC9:** If agent has no theme record, GET returns default theme with version 0
10. **AC10:** Unit tests for service and controller are written and passing

## Tasks / Subtasks

- [ ] **Task 1: Theme Service** (AC: 1-6, 9)
  - [ ] 1.1 Create `apps/api/src/services/agent-themes.service.ts`
  - [ ] 1.2 Inject `PrismaService`, `AgentLoggerService`
  - [ ] 1.3 Implement `getTheme(agentId, user)` — return existing theme or default
  - [ ] 1.4 Implement `updateTheme(agentId, config, user)` — full replace, increment version
  - [ ] 1.5 Implement `patchTheme(agentId, partialConfig, user)` — deep merge with existing, increment version
  - [ ] 1.6 Implement `resetTheme(agentId, user)` — set config to default, increment version
  - [ ] 1.7 Add helper `ensureAgentAccess(agentId, user)` — reuse agent service's access checks
  - [ ] 1.8 Use upsert for create-or-update pattern (agent may not have theme yet)

- [ ] **Task 2: Theme Controller** (AC: 1-4, 6, 7, 8)
  - [ ] 2.1 Create `apps/api/src/controllers/agents/agent-themes.controller.ts`
  - [ ] 2.2 `GET /agents/:id/theme` — returns config + version, sets ETag header
  - [ ] 2.3 `PUT /agents/:id/theme` — validates full config with `widgetThemeSchema`, returns updated
  - [ ] 2.4 `PATCH /agents/:id/theme` — validates partial config with `widgetThemeSchema.deepPartial()`, returns updated
  - [ ] 2.5 `POST /agents/:id/theme/reset` — returns default theme
  - [ ] 2.6 Apply `@Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)` to all endpoints
  - [ ] 2.7 Full Swagger documentation on all endpoints

- [ ] **Task 3: Validation Schemas** (AC: 8)
  - [ ] 3.1 Add `updateThemeSchema` (full widgetThemeSchema) to `packages/validation/src/theme.ts`
  - [ ] 3.2 Add `patchThemeSchema` (deepPartial of widgetThemeSchema) to `packages/validation/src/theme.ts`
  - [ ] 3.3 Re-export from `packages/validation/src/index.ts`

- [ ] **Task 4: Module Registration** (AC: all)
  - [ ] 4.1 Create `apps/api/src/modules/agent-themes.module.ts` or register in `AgentsModule`
  - [ ] 4.2 Register controller and service
  - [ ] 4.3 Import in `AppModule` if separate module

- [ ] **Task 5: Unit Tests** (AC: 10)
  - [ ] 5.1 Create `apps/api/test/services/agent-themes/agent-themes.service.spec.ts`
  - [ ] 5.2 Create `apps/api/test/controllers/agents/agent-themes.controller.spec.ts`
  - [ ] 5.3 Test: GET returns default theme when no record exists
  - [ ] 5.4 Test: PUT creates theme record if none exists (upsert)
  - [ ] 5.5 Test: PUT replaces full config and increments version
  - [ ] 5.6 Test: PATCH merges partial config into existing
  - [ ] 5.7 Test: Reset sets config to defaults and increments version
  - [ ] 5.8 Test: CLIENT can only access own org's agent theme
  - [ ] 5.9 Test: Invalid config rejected by validation
  - [ ] 5.10 Run `bun run test` and confirm all pass

## Dev Notes

### API Endpoint Patterns

Follow `AgentsController` patterns for auth, validation, and response formatting:

```typescript
@Controller('agents/:id/theme')
@ApiTags('Agent Themes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, UserSyncGuard, RolesGuard)
export class AgentThemesController {

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.CLIENT)
  @ApiOperation({ summary: 'Get agent theme configuration' })
  async getTheme(
    @Param('id', ParseUUIDPipe) agentId: string,
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    const theme = await this.themesService.getTheme(agentId, user);
    res.setHeader('ETag', `"${theme.version}"`);
    return theme;
  }
}
```

### Deep Merge Strategy for PATCH

Use a recursive merge — nested objects are merged, arrays are replaced:

```typescript
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

### Upsert Pattern

```typescript
await this.prisma.agentTheme.upsert({
  where: { agentId },
  create: { agentId, config, version: 1 },
  update: { config, version: { increment: 1 } },
});
```

### Project Structure Notes

- Controller nested under `/agents/:id/theme` — same path structure as agent secrets
- Service can reuse `AgentsService.findByIdRaw()` for agent access validation
- Consider registering theme controller in the existing `AgentsModule` to share service dependencies
- ETag uses version number for simple cache validation

### References

- [Source: `_bmad-output/planning-artifacts/architecture.md`] — Theme API endpoints (section 10.2), cache config
- [Source: `_bmad-output/planning-artifacts/epics.md` lines 1465-1480] — Story 4.2 acceptance criteria
- [Source: `apps/api/src/controllers/agents/agents.controller.ts`] — controller patterns
- [Source: `apps/api/src/services/agents.service.ts`] — service patterns, access control
- [Source: `apps/api/src/controllers/agents/agent-secrets.controller.ts`] — nested route pattern

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
