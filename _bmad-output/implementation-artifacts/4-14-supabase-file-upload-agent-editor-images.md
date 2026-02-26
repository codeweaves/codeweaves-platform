# Story 4.14: Supabase File Upload & Agent Editor Image Upload

Status: done

## Story

As an **agent owner**,
I want to upload custom images (logos, icons, avatars) through the agent editor,
so that my widget can display branded imagery.

## Acceptance Criteria

1. **AC1:** Supabase Storage service configured with file upload/delete operations
2. **AC2:** Generic `File` model tracks all uploads with metadata (filename, size, mime type, URL, entity reference)
3. **AC3:** Image validation for type (JPEG, PNG, SVG, WebP, GIF) and size (max 5MB)
4. **AC4:** Image upload areas in agent editor for: header logo, icon image, bot avatar, user avatar, branding logo
5. **AC5:** `AgentFilesController` with upload and delete endpoints scoped to agent
6. **AC6:** Uploaded image URLs stored in theme config via `updateThemeData`
7. **AC7:** File entity tracks `entityType` and `entityId` for associating uploads with agents

## Tasks / Subtasks

- [x] **Task 1: Create Supabase Storage Service** (AC: 1, 3)
  - [x] 1.1 Add `@supabase/supabase-js` dependency
  - [x] 1.2 Create `SupabaseStorageService` with `upload()` and `delete()` methods
  - [x] 1.3 Validate file type and size before upload
  - [x] 1.4 Configure via `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`

- [x] **Task 2: Create File Model and Service** (AC: 2, 7)
  - [x] 2.1 Add `File` model to Prisma schema with fields: id, filename, mimeType, size, url, entityType, entityId
  - [x] 2.2 Create `FilesService` with CRUD operations
  - [x] 2.3 Run Prisma migration

- [x] **Task 3: Create Agent Files Controller** (AC: 5, 6)
  - [x] 3.1 Create `AgentFilesController` at `POST /agents/:id/files` and `DELETE /agents/:id/files/:fileId`
  - [x] 3.2 Scope to agent ownership via tenant filter
  - [x] 3.3 Register in `AgentsModule`

- [x] **Task 4: Add Image Upload UI in Agent Editor** (AC: 4)
  - [x] 4.1 Create image upload component with drag-and-drop or click-to-upload
  - [x] 4.2 Integrate in appearance settings (icon image), chat settings (bot/user avatars), header settings (logo), branding settings (logo)
  - [x] 4.3 Show upload progress and preview

## Dev Notes

- Supabase Storage requires server restart after adding env vars (NestJS reads `.env` at startup only)
- File entity uses `entityType: 'agent'` and `entityId: agent.id` for association
- Upload endpoint uses `@UseInterceptors(FileInterceptor('file'))` from `@nestjs/platform-express`

## Branch & PR

- Branch: `feature/agent-editor-enhancements`
- PR: #42
