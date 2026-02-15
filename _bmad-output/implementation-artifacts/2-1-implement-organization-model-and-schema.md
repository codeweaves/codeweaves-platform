# Story 2.1: Implement Organization Model and Schema

Status: done

## Story

As a **backend developer**,
I want an Organization database model with proper relationships,
So that tenant data can be stored and managed.

## Acceptance Criteria

1. **Given** Prisma is configured
   **When** reviewing the Organization model
   **Then** Organization table stores: id (UUID), name, slug (unique), createdAt, updatedAt

2. **Given** the Organization model exists (already created in Epic 1)
   **When** updating the schema
   **Then** a `slug` column is added (unique, indexed, lowercase alphanumeric with hyphens)
   **And** one-to-many relationship with Users is verified
   **And** one-to-many relationship with Agents is prepared (Agent model comes in Epic 3)

3. **Given** the updated schema
   **When** running `npx prisma migrate dev`
   **Then** migration creates the `slug` column successfully
   **And** existing organizations get a slug derived from their name

4. **Given** the Organization model
   **When** creating a new organization
   **Then** slug is auto-generated from name if not provided
   **And** slug uniqueness is enforced at DB level

## Tasks / Subtasks

- [x] Task 1: Update Organization model in `apps/api/prisma/schema.prisma`
  - [x] Add `slug String @unique` field
  - [x] Add `@@index([slug])` for lookup performance
  - [x] Verify existing `users User[]` relationship
  - [x] Keep `@@map("organizations")` table mapping

- [x] Task 2: Create Prisma migration
  - [x] Run `npx prisma migrate dev --name add_org_slug`
  - [x] Verify migration SQL is correct
  - [x] Test migration applies cleanly

- [x] Task 3: Create slug generation utility
  - [x] Create `apps/api/src/utils/slug.ts` with `generateSlug(name: string): string`
  - [x] Lowercase, replace spaces with hyphens, strip special characters
  - [x] Handle collision by appending random suffix

- [x] Task 4: Add Zod validation schema for Organization
  - [x] Add `createOrganizationSchema` to `packages/validation/src/index.ts`
  - [x] Fields: `name` (string, min 2, max 100), `slug` (optional, regex `/^[a-z0-9-]+$/`)
  - [x] Add `updateOrganizationSchema` (partial of create)

- [x] Task 5: Write unit tests
  - [x] Test slug generation from various name inputs
  - [x] Test slug uniqueness handling
  - [x] Test validation schemas accept/reject correct inputs

## Dev Notes

### Current State

The Organization model already exists in `schema.prisma` with `id`, `name`, `users[]`, `createdAt`, `updatedAt`. This story extends it with `slug` for URL-friendly identification.

### Schema Change

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  users     User[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([slug])
  @@map("organizations")
}
```

### Slug Examples

| Name | Slug |
|------|------|
| Acme Corp | acme-corp |
| My Company 123 | my-company-123 |
| Test & Demo! | test-demo |

### Architecture Compliance

- **ADR-006:** Application-level data access (no RLS) - Organization is the tenant boundary
- **FR11-FR16:** Organization model is the foundation for multi-tenant management

### References

- Existing schema: `apps/api/prisma/schema.prisma`
- Validation package: `packages/validation/src/index.ts`

## Dev Agent Record

### File List

| Action | File |
|--------|------|
| Modified | `apps/api/prisma/schema.prisma` |
| Created | `apps/api/prisma/migrations/20260215131356_add_org_slug/migration.sql` |
| Created | `apps/api/src/utils/slug.ts` |
| Created | `apps/api/src/models/organization.dto.ts` |
| Modified | `packages/validation/src/index.ts` |
| Modified | `apps/api/src/services/users.service.ts` |
| Modified | `apps/api/src/decorators/current-user.decorator.ts` |
| Modified | `apps/api/src/interceptors/user-sync.interceptor.ts` |
| Created | `apps/api/test/utils/slug.spec.ts` |
| Created | `apps/api/test/models/organization.validation.spec.ts` |
| Modified | `apps/api/test/services/users/users.service.spec.ts` |
| Modified | `apps/api/test/controllers/auth/users.controller.spec.ts` |
| Modified | `apps/api/test/controllers/invitations/invitations.controller.spec.ts` |
| Modified | `apps/api/test/decorators/current-user.decorator.spec.ts` |
| Modified | `apps/api/test/interceptors/user-sync.interceptor.spec.ts` |

### Change Log

- 2026-02-15: Added `slug` field to Organization model with unique constraint and index
- 2026-02-15: Created migration `20260215131356_add_org_slug`
- 2026-02-15: Created slug generation utility (`generateSlug`, `generateUniqueSlug`)
- 2026-02-15: Added Zod validation schemas (`slugSchema`, `createOrganizationSchema`, `updateOrganizationSchema`)
- 2026-02-15: Updated `organizationSummarySchema` to include `slug`
- 2026-02-15: Updated `CurrentUserData`, `CachedUserData`, and `USER_WITH_ORG_SELECT` to include `slug`
- 2026-02-15: Created 29 unit tests (13 slug utility + 16 validation schema)
- 2026-02-15: Updated 5 existing test files to include `slug` in mock organization objects
