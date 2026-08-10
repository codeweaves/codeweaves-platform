# RBAC: Additive DB-Backed Roles with Scope Gating

> Status: **All six phases built and green.** · 2026-08-09 · Owner: Dhruv
>
> The migration in `prisma/migrations/20260809000000_rbac_roles_permissions/` is
> written but **NOT deployed**. The API will not boot until it runs, because
> `PermissionCatalogService` loads the catalog at startup and the route assertion
> validates every decorator key against it.
> Supersedes the partial `PERMISSION_MATRIX` in [permissions.ts](../../apps/api/src/common/rbac/permissions.ts) (7 call sites, effectively dead).

## TL;DR

A user has **one access scope** (which rows they can touch) and **any number of roles** (what they can do). Permissions are the union of their roles.

Roles and permissions live in **database tables**, seeded and changed by migration, so every change goes through a PR. Two boolean flags decide what an org user may ever hold. Both default to `false`, so a newly added permission is invisible to orgs until someone deliberately opens it.

Three mechanisms make the flags real rather than decorative: a **purity trigger** (an org role can never contain a platform-only permission), an **assignment trigger** (an org user can never hold a platform role), and a **startup assertion** (the app will not boot if any route lacks an authorization declaration, or if a decorator references a permission that does not exist).

No new dependencies. Roughly **11 to 15 days** across six phases. Phase A is one day, needs no schema change, and closes two live gaps.

---

## 1. Current state (code-verified)

### 1.1 One column doing two jobs

`User.role` ([schema.prisma:175](../../apps/api/prisma/schema.prisma#L175)) holds `SUPER_ADMIN | ADMIN | CLIENT` and answers two unrelated questions:

- *Which rows may I see?* Read in **47 places** as `...(user.role === Role.CLIENT && { organizationId: user.organizationId! })`. It answers this well.
- *What may I do?* Only three possible answers for every person on the platform. Far too coarse.

Splitting these is the entire redesign.

### 1.2 Guard stack

Global, in [app.module.ts:87-97](../../apps/api/src/modules/app.module.ts#L87-L97): `JwtAuthGuard` → `UserSyncGuard` → `RateLimitGuard`.

`UserSyncGuard` ([user-sync.guard.ts:57-69](../../apps/api/src/guards/user-sync.guard.ts#L57-L69)) attaches `id`, `role`, `organizationId` to `request.user`, cached 60s per `clerkId`.

**`RolesGuard` is not global.** It is applied per controller on 14 of them. A controller that forgets `@UseGuards(RolesGuard)` has its `@Roles()` decorators silently ignored, because metadata with no guard reading it does nothing.

**`TenantGuard` is on exactly one controller** ([organization-members.controller.ts:29](../../apps/api/src/controllers/organizations/organization-members.controller.ts#L29)). Its docstring and [permissions.ts:19](../../apps/api/src/common/rbac/permissions.ts#L19) both claim it enforces org scoping. It does not. It only checks *that* a CLIENT has an org, never *which* one.

### 1.3 The structural risk, and one live gap

`RolesGuard.canActivate` returns `true` when no decorator is present ([roles.guard.ts:42-44](../../apps/api/src/guards/roles.guard.ts#L42-L44)). That is the real hazard: a route with no declaration is open to every authenticated user, silently, with nothing to catch it in review.

Today exactly one route family hits that path:

| Controller | Problem | Severity |
|---|---|---|
| [voices.controller.ts:38](../../apps/api/src/modules/voice/voices.controller.ts#L38) | No guard, no declaration. `GET /voices` and `POST /voices/preview` are reachable by any authenticated user. Mitigated by a hand-rolled per-user sliding-window limit (60/min) and a 24h synthesis cache, so upstream spend is bounded | Low |

[users.controller.ts](../../apps/api/src/controllers/auth/users.controller.ts) is also undeclared but benign: both endpoints resolve from `user.id` and cannot reach another user's data. It needs `@SelfOnly` purely so the §7.4 assertion can tell "deliberately self-scoped" from "forgotten".

> **Corrected:** an earlier draft claimed `whatsapp-channel.controller.ts` was ungated. It is not. All four methods carry `@RequirePermission(Resource.Agent, ...)`; `GET` maps to `Agent:Read` and the three writes to `Agent:Update`, which is `ADMIN_AND_ABOVE`. A CLIENT cannot connect or disconnect WhatsApp. The controller has no `@Roles`, which is what the original grep looked for, but it was never unprotected.

The same default-allow pattern exists in the fpx backoffice codebase, which is decent evidence that review discipline does not prevent this class of bug. §7.4 does.

### 1.4 Roles cannot be changed at all

Role is set once at invite time ([invitation.dto.ts:8](../../apps/api/src/models/invitation.dto.ts#L8), SUPER_ADMIN-only) and copied at signup. `assignMember` moves the org and never touches role. **No role-assignment endpoint exists.**

The upside: no escalation surface today. `updateUserProfileSchema` is `{ name }` only ([index.ts:99-101](../../packages/validation/src/index.ts#L99-L101)). §7 must preserve that.

### 1.5 Frontend

Six files of inline `profile?.role === 'SUPER_ADMIN'`, eight `adminOnly` flags in [agent-editor-sidebar.tsx](../../apps/web/components/features/agents/agent-editor/agent-editor-sidebar.tsx), and a `roles:` array per nav item in [sidebar.tsx:41-50](../../apps/web/components/layout/sidebar.tsx#L41-L50). Rules re-implemented client-side instead of served.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Role shape | **Additive.** A user holds a set; permissions are the union. Overlapping roles are normal and dedupe |
| Storage | **DB tables**, seeded and changed by migration. No runtime role editor |
| `User.role` | **Renamed `User.accessScope`**, values `PLATFORM` and `ORG`. Same job it already did |
| Scope relationship | **PLATFORM ⊇ ORG.** A platform user may hold any role. An org user only `org_allowed` ones |
| Gating flags | Two: `org_allowed` (may an org user hold this at all) and `client_grantable` (may an org manager hand it out). Both `DEFAULT false` |
| Enforcement of flags | DB triggers, not app logic alone |
| Missing-guard protection | Startup assertion. The app refuses to boot |
| Library | **None.** ~150 lines of our own. No supply-chain surface |
| Tool/entitlement layer | **Not now.** `Resource:Action` already groups permissions. Feature entitlements are a billing concern for when plans exist |
| Admin portal | `/admin` route group in the same Next.js app, same Clerk session. Deferred to Phase F |
| Org manager grants | **Built, but shipped disabled.** `org.manager` exists; whether to hand it to customers is a later flag flip |

---

## 3. Model

### 3.1 Two axes

**Access scope** (`User.accessScope`) answers *whose data*. This is the tenant-scoping discriminator, so all 47 sites in §1.1 change mechanically from `role === Role.CLIENT` to `accessScope === 'ORG'` with identical semantics.

| Scope | Sees |
|---|---|
| `PLATFORM` | Every organization |
| `ORG` | Its own organization, via `User.organizationId` |

**Roles** answer *what actions*. A set, resolved to a union of permissions. Scope does not affect permission checks. It affects row filtering and which roles you may be assigned.

### 3.2 Why `super_admin` is a role, not a scope value

The old enum conflated "sees everything" with "may do everything". Splitting them means `platform.super_admin` becomes an ordinary role that happens to hold every permission. It never appears in a multi-select dialog alongside functional roles (§7.2), so a stray click cannot grant platform-wide access.

---

## 4. Schema

```prisma
enum AccessScope {
  PLATFORM
  ORG
}

model Permission {
  key         String   @id                      // 'Agent:Update'
  resource    String
  action      String
  description String?
  // May an ORG-scope user ever hold this? Defaults false so a newly added
  // permission is invisible to orgs until a migration deliberately opens it.
  orgAllowed  Boolean  @default(false) @map("org_allowed")
  createdAt   DateTime @default(now())

  roles       RolePermission[]
  @@index([resource])
  @@map("permissions")
}

model Role {
  key             String   @id                  // 'org.agent_editor'
  name            String
  description     String?
  // May an ORG-scope user hold this role at all?
  orgAllowed      Boolean  @default(false) @map("org_allowed")
  // May an org manager hand this out? Distinct from orgAllowed: org.manager is
  // orgAllowed (an org user holds it) but never clientGrantable (they must not
  // be able to create another manager).
  clientGrantable Boolean  @default(false) @map("client_grantable")
  createdAt       DateTime @default(now())

  permissions     RolePermission[]
  assignments     UserRoleAssignment[]
  @@map("roles")
}

model RolePermission {
  roleKey       String     @map("role_key")
  permissionKey String     @map("permission_key")
  role          Role       @relation(fields: [roleKey], references: [key], onDelete: Cascade)
  permission    Permission @relation(fields: [permissionKey], references: [key], onDelete: Cascade)

  @@id([roleKey, permissionKey])
  @@map("role_permissions")
}

model UserRoleAssignment {
  id             String        @id @default(uuid())
  userId         String        @map("user_id")
  roleKey        String        @map("role_key")
  // Null for PLATFORM-scope assignments. Set for ORG-scope so the grant is tied
  // to an org, which keeps multi-org membership possible later without a migration.
  organizationId String?       @map("organization_id")
  grantedBy      String?       @map("granted_by")
  createdAt      DateTime      @default(now())
  deletedAt      DateTime?

  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  role           Role          @relation(fields: [roleKey], references: [key])
  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, roleKey, organizationId])
  @@index([userId])
  @@index([organizationId])
  @@map("user_role_assignments")
}
```

`User` changes: `role Role` becomes `accessScope AccessScope @default(ORG)`, plus `roleAssignments UserRoleAssignment[]`. `UserInvitation` gains `roleKeys String[]` for the starting role set.

### 4.1 Triggers (these make the flags real)

Without these, the flags are documentation. Someone attaches `Organization:Delete` to an org role in a migration and nothing stops them.

```sql
-- 1. An org-allowed role can only ever contain org-allowed permissions.
CREATE OR REPLACE FUNCTION assert_org_role_purity() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT org_allowed FROM roles WHERE key = NEW.role_key)
     AND NOT (SELECT org_allowed FROM permissions WHERE key = NEW.permission_key)
  THEN
    RAISE EXCEPTION 'org-allowed role % cannot contain platform-only permission %',
      NEW.role_key, NEW.permission_key;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_permission_purity
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION assert_org_role_purity();

-- 2. Flipping a role to org_allowed re-checks everything already attached.
CREATE OR REPLACE FUNCTION assert_role_flip_safe() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.org_allowed AND NOT OLD.org_allowed AND EXISTS (
    SELECT 1 FROM role_permissions rp
    JOIN permissions p ON p.key = rp.permission_key
    WHERE rp.role_key = NEW.key AND NOT p.org_allowed
  ) THEN
    RAISE EXCEPTION 'cannot mark role % org-allowed: it holds platform-only permissions', NEW.key;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_role_flip_safe
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION assert_role_flip_safe();

-- 3. An ORG-scope user can never be assigned a non-org-allowed role.
CREATE OR REPLACE FUNCTION assert_assignment_scope() RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT access_scope FROM users WHERE id = NEW.user_id) = 'ORG'
     AND NOT (SELECT org_allowed FROM roles WHERE key = NEW.role_key)
  THEN
    RAISE EXCEPTION 'ORG-scope user % cannot hold platform role %', NEW.user_id, NEW.role_key;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assignment_scope
  BEFORE INSERT OR UPDATE ON user_role_assignments
  FOR EACH ROW EXECUTE FUNCTION assert_assignment_scope();
```

---

## 5. Permission catalog

Seeded by migration. `orgAllowed` defaults `false`; only the rows marked below are opened.

### 5.1 Agent and configuration

| Key | orgAllowed | Gates |
|---|---|---|
| `Agent:Create` | ✗ | `POST /agents` |
| `Agent:Read` | ✓ | `GET /agents`, `/:id`, `/:id/editor-config` |
| `Agent:Update` | ✓ | `PATCH /agents/:id` (general, behaviour, voice, classification, status) |
| `Agent:Delete` | ✓ | `DELETE /agents/:id` |
| `AgentTheme:Read` | ✓ | `GET /agents/:id/theme` |
| `AgentTheme:Update` | ✓ | `PUT`/`PATCH`/`reset` theme. **Branding stripped in service, see §5.5** |
| `AgentKnowledge:Read` | ✓ | `GET /agents/:id/knowledge` |
| `AgentKnowledge:Update` | ✓ | `PUT` knowledge, `POST` extract |
| `AgentKnowledge:Delete` | ✓ | `DELETE` knowledge |
| `File:Create` | ✓ | `POST /agents/:id/files/upload` |
| `File:Delete` | ✓ | `DELETE /agents/:id/files/:fileId` |
| `AgentSecret:Read` | ✗ | `GET /agents/:id/webhook` |
| `AgentSecret:Update` | ✗ | `PATCH` webhook, `POST` webhook/test |
| `AgentDataField:Read` | ✗ | `GET /agents/:id/data-fields` |
| `AgentDataField:Update` | ✗ | `PUT /agents/:id/data-fields` |
| `WhatsappChannel:Read` | ✗ | `GET /agents/:agentId/whatsapp` |
| `WhatsappChannel:Create` | ✗ | `POST` connect |
| `WhatsappChannel:Update` | ✗ | `PATCH` voice reply |
| `WhatsappChannel:Delete` | ✗ | `DELETE` disconnect |

### 5.2 Operations

| Key | orgAllowed | Gates |
|---|---|---|
| `CollectedData:Read` | ✓ | `GET /agents/:id/data-fields/collected` |
| `ChatSession:Read` | ✓ | `GET /conversations`, `/:sessionId` |
| `Handover:Read` | ✓ | `GET /handover/inbox`, `/enabled`, `/:sessionId` |
| `Handover:Take` | ✓ | `POST /handover/:sessionId/takeover` |
| `Handover:Reply` | ✓ | `POST /handover/:sessionId/messages` |
| `Handover:Resolve` | ✓ | `POST /handover/:sessionId/resolve` |
| `Analytics:Read` | ✓ | 14 analytics endpoints |
| `Analytics:Export` | ✓ | `POST /analytics/export-log` |
| `Notification:Read` | ✓ | `GET /notifications`, `/unread-count`, `/:id` |
| `Notification:Update` | ✓ | `POST /notifications/seen`, `/:id/read` |
| `Voice:Read` | ✓ | `GET /voices` |
| `Voice:Preview` | ✓ | `POST /voices/preview` |

### 5.3 Administration

| Key | orgAllowed | Gates |
|---|---|---|
| `Organization:Create` | ✗ | `POST /organizations` |
| `Organization:Read` | ✓ | `GET /organizations/:id` (own only, via scope) |
| `Organization:ReadAll` | ✗ | `GET /organizations` |
| `Organization:Update` | ✗ | `PATCH /organizations/:id` |
| `Organization:Delete` | ✗ | `DELETE`, `GET /:id/delete-preview` |
| `User:Read` | ✓ | `GET /users/:id` |
| `User:ReadAll` | ✗ | `GET /users` |
| `User:ManageScope` | ✗ | `PATCH /users/:id/scope` |
| `Member:Read` | ✓ | `GET /organizations/:orgId/members` |
| `Member:Manage` | ✓ | `PUT /users/:id/roles`, assign/remove member |
| `Role:Read` | ✓ | `GET /rbac/roles` (filtered, §7.3) |
| `Invitation:Create` | ✗ | `POST /invitations` |
| `Invitation:Read` | ✗ | `GET /invitations`, `/:id` |
| `Invitation:Update` | ✗ | `POST /invitations/:id/resend` |
| `Invitation:Delete` | ✗ | `DELETE /invitations/:id` |
| `Privacy:Read` | ✓ | `GET /privacy/visitors/:visitorId/summary` |
| `Privacy:Delete` | ✓ | `DELETE /privacy/visitors/:visitorId` |
| `Privacy:DeleteOrg` | ✗ | `DELETE /privacy/organizations/:orgId` |
| `EmailTemplate:Read` | ✗ | `GET /email-templates`, `/:key` |
| `EmailTemplate:Update` | ✗ | `PATCH /email-templates/:key` |
| `AuditLog:Read` | ✗ | reserved |

### 5.4 Self-scoped, no permission

`GET /auth/users/me` and `PATCH /auth/users/me` are marked `@SelfOnly`. They resolve from `user.id` and cannot reach another user's data.

### 5.5 Branding is not a permission

`AgentTheme.config` is a single JSONB blob holding appearance, chat interface, **and** branding ([schema.prisma](../../apps/api/prisma/schema.prisma), `model AgentTheme`). One endpoint writes the whole column, so "edit appearance but not branding" cannot be a permission check.

Handle it in `AgentThemesService`: when `accessScope === 'ORG'`, strip the branding keys from the incoming config and merge them back from the stored record. One special case, documented at the call site, not a role.

Rationale: branding is the "Powered by Klivo" footer. Commercially load-bearing, so it stays ours.

---

## 6. Role catalog

### 6.1 Platform roles (`orgAllowed: false`)

| Key | Name | clientGrantable | Permissions |
|---|---|---|---|
| `platform.super_admin` | Super Admin | ✗ | Every permission |
| `platform.support` | Support | ✗ | `Agent:Read`, `ChatSession:Read`, `Analytics:Read`, `User:Read`, `User:ReadAll`, `Member:Read` |
| `platform.ops` | Platform Ops | ✗ | `Organization:*`, `Invitation:*`, `EmailTemplate:*`, `User:ReadAll`, `Member:Manage`, `Role:Read` |
| `platform.privacy` | Privacy Officer | ✗ | `Privacy:*` including `Privacy:DeleteOrg` |
| `platform.agent_admin` | Agent Admin | ✗ | `Agent:Create`, `AgentSecret:*`, `AgentDataField:*`, `WhatsappChannel:*` |

### 6.2 Org roles (`orgAllowed: true` unless noted)

| Key | Name | clientGrantable | Permissions |
|---|---|---|---|
| `org.owner` | Owner | ✗ | Everything in §6.3. The default for existing clients |
| `org.manager` | Manager | ✗ | `Member:Read`, `Member:Manage`, `Role:Read`, `User:Read` |
| `org.agent_editor` | Agent Editor | ✓ | `Agent:Read`, `Agent:Update`, `AgentTheme:*`, `AgentKnowledge:*`, `File:*`, `Voice:*` |
| `org.inbox_agent` | Inbox Agent | ✓ | `Handover:Read`, `Take`, `Reply`, `Resolve`, `ChatSession:Read` |
| `org.analyst` | Analyst | ✓ | `Analytics:Read`, `Analytics:Export`, `ChatSession:Read`, `CollectedData:Read` |
| `org.viewer` | Viewer | ✓ | `Agent:Read`, `ChatSession:Read`, `Analytics:Read`, `Notification:Read` |
| `org.integrations` | Integrations | ✓ | `AgentSecret:*`, `WhatsappChannel:*`, `AgentDataField:*` — **seeded `orgAllowed: false`** |

> `org.integrations` is defined but closed. Its permissions are all `orgAllowed: false`, so the purity trigger would reject opening the role until those are opened too. Enabling it later is a two-line migration flipping the permissions then the role. This is the flag design working as intended: the capability exists, the door is shut, opening it is a reviewed change.

> `org.manager` is `orgAllowed: true` (an org user holds it) but `clientGrantable: false` (no manager can create another). Shipping it disabled in the UI is a Phase F decision, not a schema one.

### 6.3 What `org.owner` grants

Matches the agreed client capability exactly:

`Agent:Read`, `Agent:Update`, `Agent:Delete`, `AgentTheme:Read`, `AgentTheme:Update`, `AgentKnowledge:Read/Update/Delete`, `File:Create`, `File:Delete`, `Voice:Read`, `Voice:Preview`, `CollectedData:Read`, `ChatSession:Read`, `Handover:Read/Take/Reply/Resolve`, `Analytics:Read`, `Analytics:Export`, `Notification:Read/Update`, `Member:Read`, `User:Read`, `Organization:Read`, `Privacy:Read`, `Privacy:Delete`

Deliberately absent: `Agent:Create`, `AgentSecret:*`, `WhatsappChannel:*`, `AgentDataField:*`.

Branding is blocked by §5.5, not by a missing permission.

### 6.4 Backfill

Behaviour-preserving. Nobody's effective access changes on deploy.

```sql
-- accessScope from the old enum
UPDATE users SET access_scope = CASE
  WHEN role IN ('SUPER_ADMIN','ADMIN') THEN 'PLATFORM' ELSE 'ORG' END;

-- existing CLIENTs become org.owner of their org
INSERT INTO user_role_assignments (id, user_id, role_key, organization_id, created_at)
SELECT gen_random_uuid(), id, 'org.owner', organization_id, now()
FROM users WHERE role = 'CLIENT' AND organization_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- existing SUPER_ADMINs
INSERT INTO user_role_assignments (id, user_id, role_key, organization_id, created_at)
SELECT gen_random_uuid(), id, 'platform.super_admin', NULL, now()
FROM users WHERE role = 'SUPER_ADMIN' AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- existing ADMINs keep staff capability
INSERT INTO user_role_assignments (id, user_id, role_key, organization_id, created_at)
SELECT gen_random_uuid(), u.id, r.key, NULL, now()
FROM users u CROSS JOIN (VALUES ('platform.support'),('platform.ops'),
                                ('platform.privacy'),('platform.agent_admin')) AS r(key)
WHERE u.role = 'ADMIN' AND u.deleted_at IS NULL
ON CONFLICT DO NOTHING;
```

Verify before and after:

```sql
SELECT access_scope, count(*) FROM users WHERE deleted_at IS NULL GROUP BY access_scope;
SELECT role_key, count(*) FROM user_role_assignments WHERE deleted_at IS NULL GROUP BY role_key;
```

Existing clients currently have `Agent:Delete` and keep it under `org.owner`. The tightening applies only to members invited later at narrower roles.

---

## 7. Enforcement

### 7.1 Guard stack

```
JwtAuthGuard → UserSyncGuard → TenantGuard → PermissionGuard → RateLimitGuard
               (loads roleKeys) (global, real) (global, default DENY)
```

1. `PermissionGuard` (renamed from `RolesGuard`) becomes `APP_GUARD`. Delete all 14 `@UseGuards(RolesGuard)`.
2. Default **deny**: no declaration means throw, not `return true`. Safe once §7.4 guarantees every route declares.
3. `TenantGuard` global and doing real work: confirm an `ORG` user has an org, attach it, short-circuit `PLATFORM`.

### 7.2 Resolution

`UserSyncGuard` loads `roleKeys` in the query that already fetches the user, so no extra round trip. The catalog (`permissions`, `roles`, `role_permissions`) is loaded into memory at boot and refreshed on a TTL, so **zero extra queries per request**.

```ts
export function resolvePermissions(roleKeys: string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of roleKeys) {
    const role = CATALOG.roles.get(key);
    if (!role) { log.warn('resolvePermissions', 'unknown roleKey ignored', { key }); continue; }
    for (const p of role.permissions) out.add(p);   // overlap dedupes here
  }
  return out;
}
```

Unknown keys are ignored and logged, never fatal. A role removed from the catalog must not lock its holders out.

**A role change takes up to 60s** to take effect via the existing cache. §7.5 evicts the target directly on assignment.

### 7.3 Catalog filtering

`GET /rbac/roles` returns a different list per caller. This is enforced **in the endpoint**, not by hiding checkboxes, otherwise role names still travel in the response body.

| Caller | Sees |
|---|---|
| `platform.super_admin` or `platform.ops` | All roles |
| `org.manager` | Only `orgAllowed && clientGrantable` |
| Anyone else | Empty |

An org manager never learns `platform.ops` or `org.manager` exist.

### 7.4 Startup assertion

At boot, walk the Nest router and assert:

1. Every route declares exactly one of `@Public`, `@RequirePermission`, `@SelfOnly`.
2. Every permission key referenced by a `@RequirePermission` exists in the `permissions` table.

Throw on either. Log orphaned DB permissions that no endpoint checks.

This is what makes DB-backed permissions safe: a typo in a migration or a decorator fails the build rather than silently granting or denying. It also catches both §1.3 gaps automatically.

### 7.5 Shared agent access

Collapse the three copies (`assertAgentAccess` in agent-data-fields and agent-knowledge, `ensureAgentAccess` in agent-themes and files) into one exported helper.

---

## 8. Role administration

### 8.1 Grant rules

| Actor | May grant |
|---|---|
| `platform.super_admin` | Any role to any user |
| `platform.ops` | Any `orgAllowed` role. Never a platform role |
| `org.manager` | Only `orgAllowed && clientGrantable`, only to users in their own org, never to themselves |
| Anyone else | Nothing |

### 8.2 Invariants (one unit test each)

1. **No self-modification.** Cannot change your own assignments. `platform.super_admin` excepted.
2. **No manager minting.** `org.manager` is `clientGrantable: false`, so a manager cannot create another.
3. **No scope escalation.** Only `User:ManageScope` (super admin) changes `accessScope`, via a separate endpoint.
4. **Org containment.** Acting on a user outside your org returns 404, not 403. A 403 confirms they exist.
5. **Last owner standing.** An org must retain at least one live `org.owner`.
6. **Role floor.** A user must always end with at least one role. Assigning an empty set is rejected.
7. **Profile stays clean.** `updateUserProfileSchema` remains `{ name }`.
8. **Audit every change.** Actor, target user, org, before roles, after roles, timestamp. Via `TracerService.logAuditEvent`.
9. **Cache eviction** on the target after a successful write.

### 8.3 Endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /rbac/roles` | `Role:Read` | Filtered per §7.3 |
| `GET /users` | `User:ReadAll` | Paginated, searchable |
| `GET /users/:id` | `User:Read` | Roles + derived permissions |
| `PUT /users/:id/roles` | `Member:Manage` | **Full replace.** Body `{ roleKeys[] }`. Runs §8.1 and §8.2 |
| `PATCH /users/:id/scope` | `User:ManageScope` | Super admin only, separate from the dialog |

`PUT` not `PATCH`: the dialog submits the complete checked set, so replace semantics avoid a lost update when two managers edit the same person. The handler diffs against current state for the audit entry.

---

## 9. Frontend

`GET /auth/users/me` gains `{ accessScope, roleKeys, permissions }`, computed server-side. The client never re-implements a rule.

```ts
const { can } = usePermissions();
can('Agent:Delete')
```

Replaces the six inline checks, the eight `adminOnly` flags, and the nav `roles:` arrays.

**`/admin` route group**, same app, same Clerk session, no second login:

```
apps/web/app/(protected)/
  dashboard/   → customer product
  admin/       → users, orgs, invitations, email templates, roles viewer
```

Manage Users is a `DataTable` ([components/ui/data-table/](../../apps/web/components/ui/data-table/)) with search, a details page showing identity plus derived permissions read-only, and the role checkbox dialog fed by `GET /rbac/roles`.

A **read-only Roles viewer** lists every role and its permissions. Visibility without a runtime editor.

Client-side gating is UX only. The API is the boundary.

---

## 10. Phases

| Phase | Work | Status |
|---|---|---|
| **A** | `PermissionGuard` global, 14 `@UseGuards` deleted, startup assertion, default deny, `voices` + `users` declared | **Done** |
| **B** | 70 `@RequirePermission` declarations, `@Roles`/`ROLES_KEY` deleted, 22 tenant-scope sites on `isOrgScoped` | **Done** |
| **C** | Tables + 4 triggers + catalog seed + `accessScope` + backfill + `PermissionCatalogService` boot cache | **Done, migration not deployed** |
| **D** | Grant rules, invariants, 5 endpoints, catalog filtering, audit, cache eviction, tests | **Done** |
| **E** | Manage Users list + detail + role dialog at `/dashboard/users` | **Done** |
| **F** | `/me` payload, `usePermissions()`, 17 inline gates + 5 sidebar flags + nav table replaced, branding strip (§5.5) | **Done** |

The `/admin` route group was dropped: Manage Users lives at `/dashboard/users`
as its own sidebar entry, gated on `User:ReadAll`. Moving it under `/admin` later
is a directory move and a layout file, and nothing in the model depends on it.

**Not built, deliberately:** a read-only roles viewer screen. The role catalog is
already visible in the edit dialog with each role's full permission list, and on
the user detail page as the derived permission union, so a separate screen would
restate what those already show. Worth adding if the catalog grows.

One correctness note worth keeping: `UserSyncGuard`'s cache is **static** on
purpose. Nest builds the `APP_GUARD` instance separately from the one injected
into `UserRolesService`, so a per-instance map would mean `evict()` clearing a
cache the request path never reads, and a revocation silently taking the full 60s
TTL to apply.

Per CLAUDE.md, `apps/api` changes need controller and service unit tests; `apps/web` is manual only. Do not blanket-mock `updateMany` to `{count: 1}` for invariants 5 and 6, which are guarded-update shaped.

---

## 10b. Invitations carry their role set

`UserInvitation.roleKeys String[]` (migration `20260809010000_invitation_role_keys`).

Before it, signup could only map the legacy three-value `role`, so **every invited
client was provisioned as `org.owner`**. Inviting someone as inbox-only was
impossible: they arrived with full control of the organization and had to be
demoted afterwards, which depended on remembering to go back.

- The invite dialog shows the same filtered role checkboxes as the edit dialog,
  from the same `GET /rbac/roles`, so an invite can never hand out a role the
  sender could not assign afterwards.
- Scope is derived from the chosen roles, so it needs no column. An invite may
  not mix org and platform roles: an ORG account cannot hold a platform role and
  the assignment trigger would reject it.
- `createFromInvitation` falls back to `startingRolesFor()` when `roleKeys` is
  empty or absent, so **pending pre-RBAC invitations still resolve exactly as
  they did** and no data backfill was needed.

The grant check at invite time is the part that matters beyond convenience. It is
what keeps invitation from becoming a way around the role rules if org managers
are ever given `Invitation:Create` (§9.1).

## 11. Open, deliberately

1. **Ship `org.manager` to customers?** Built and enforced either way. Whether the UI exposes it is a Phase F decision.
2. **Does `AgentStatus` do anything?** `ACTIVE | INACTIVE` exists; worth confirming anything reads it before treating the toggle as meaningful. Five minute check, unrelated to RBAC.
3. **Open `org.integrations`?** Seeded closed. Two-line migration to open.
