# Notifications & Email Templates — Implementation Plan

**Status:** BUILT on `feature/notifications-email-templates`, awaiting manual testing
**Date:** 2026-07-27

> **Deviation from the original plan — email deep link.** The plan had the
> handover email linking to `/dashboard/inbox?session=<publicSessionId>`. The
> security review caught that `publicSessionId` is a **bearer credential**: it
> alone authenticates the unauthenticated `GET /public/chat/:sessionId/poll`
> endpoint, which returns the full visitor transcript. Emailing it would hand a
> no-login transcript-read capability to any mailbox on the recipient list
> (which, by design, may be a shared alias with no dashboard access).
>
> The email now links to `/dashboard/inbox?n=<notificationId>` instead. A
> notification id grants nothing on its own — `GET /notifications/:id` requires a
> verified Clerk token and is org-scoped — and the Inbox swaps it for the
> conversation behind auth. `NotificationService.deepLink` owns this, and
> `NotificationService.emit` fills `conversationUrl` itself (overriding anything a
> producer passes) so no future producer can reintroduce the leak.

---

## Scope

Two things, built together:

1. **Handover notifications** — when a visitor asks for a human, the team finds out
   immediately: in-app bell + toast + sound + browser popup, and (optionally) an email.
2. **Email template editor** — a SUPER_ADMIN-only page in the dashboard where templates
   are pasted as HTML and previewed side-by-side, stored in the DB so copy changes never
   require a deploy.

### Explicitly NOT in this build

Deferred until we discuss them separately:

- Lead / data-capture notifications
- Knowledge-base-edited notifications
- WhatsApp channel-health notifications
- Teammate-joined notifications
- Hourly summary ("digest") emails
- Delayed / escalating email (email sends **instantly**, no waiting)
- Web Push (notifications when every tab is closed)

The `notifications` table and `NotificationService` are built generically so adding those
later is a new `type` value and a new producer call — not a redesign.

---

## Part 1 — Data model

### `notifications`

```prisma
enum NotificationType {
  HANDOVER_REQUESTED
}

enum NotificationSeverity {
  INFO
  URGENT
}

model Notification {
  id             String               @id @default(uuid())
  organizationId String
  organization   Organization         @relation(fields: [organizationId], references: [id])
  agentId        String?
  agent          Agent?               @relation(fields: [agentId], references: [id])
  type           NotificationType
  severity       NotificationSeverity @default(INFO)
  /// Server-composed, safe to show in a toast. NEVER contains visitor message text.
  title          String               @db.VarChar(300)
  body           String?              @db.VarChar(1000)
  /// Deep-link target — e.g. entityType 'conversation', entityId = publicSessionId
  entityType     String?              @db.VarChar(40)
  entityId       String?
  createdAt      DateTime             @default(now())

  reads          NotificationRead[]

  @@index([organizationId, createdAt(sort: Desc)])
  @@map("notifications")
}

/// Per-user read state. Only written when a user actually opens/clicks an item.
model NotificationRead {
  notificationId String
  notification   Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  readAt         DateTime     @default(now())

  @@id([notificationId, userId])
  @@index([userId])
  @@map("notification_reads")
}
```

Add to `User`:

```prisma
  /// Cursor for the unread BADGE — set to now() when the bell panel is opened.
  /// Badge count = notifications in my org created after this. One indexed count,
  /// no join. Per-item read state lives in NotificationRead.
  notificationsSeenAt DateTime?
  notificationReads   NotificationRead[]
```

**Why a cursor AND a read table:** the badge number is hit on every page load, so it must
be one cheap indexed count. Per-item "which ones are bold" is only needed when the panel is
actually open. This is the Slack model and it avoids write amplification (one row per
event, not one row per event *per user*).

**Retention:** purge `notifications` older than 90 days inside the **existing**
`/internal/retention/run` sweep. Do not add a new cron.

### `email_templates`

```prisma
model EmailTemplate {
  /// Stable machine key the code calls — e.g. 'HANDOVER_REQUESTED', 'TEAM_INVITATION'.
  /// Rows are seeded by migration; the UI can edit but never create/delete.
  key         String   @id @db.VarChar(60)
  name        String   @db.VarChar(120)
  description String?  @db.VarChar(300)
  subject     String   @db.VarChar(300)
  html        String   @db.Text
  updatedAt   DateTime @updatedAt
  updatedBy   String?

  @@map("email_templates")
}
```

Templates are **seeded, not created**. The list is fixed by what the code sends; SUPER_ADMIN
edits `subject` + `html` only. This is what keeps the feature small — no CRUD, no orphaned
templates, no "which key does the code actually call" confusion.

### Agent — the handover email toggle

Add flat columns next to the existing handover fields (they already live flat on `Agent`:
`humanTakeoverEnabled`, `showTalkToHumanButton`, `humanConnectedLabel`):

```prisma
  /// Email the team when a visitor requests a human. Only meaningful when
  /// humanTakeoverEnabled is true.
  handoverEmailEnabled    Boolean  @default(false)
  /// Who to email. Empty = every member of the owning organization, at their
  /// login email. Non-empty = exactly these addresses (e.g. a shared support inbox).
  handoverEmailRecipients String[] @default([])
```

---

## Part 2 — Backend

### `NotificationService`

`apps/api/src/services/notification.service.ts`. One public method producers call:

```ts
async emit(input: {
  organizationId: string;
  agentId?: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  email?: { enabled: boolean; recipients: string[]; templateKey: string; vars: Record<string, string> };
}): Promise<void>
```

It does three things, **all fire-and-forget** — every one wrapped so a failure can never
break the caller's request (same hard rule as `event_logs`):

1. `prisma.notification.create(...)` → the bell
2. `realtime.emitNotification(...)` → live push
3. `notificationMailer.send(...)` → email, if `email.enabled`

### Socket — extend the gateway you already have

Add to [handover.gateway.ts](../../apps/api/src/gateways/handover.gateway.ts):

```ts
/** A dashboard notification → org room ONLY. */
emitNotification(orgId: string, payload: {
  id: string; type: string; severity: string;
  title: string; entityType?: string; entityId?: string; createdAt: string;
}): void {
  this.server.to(orgRoom(orgId)).emit('notification', payload);
}
```

Two rules:

- **Org room only.** Do NOT fan out to `PLATFORM_ROOM` — super-admins watch every org and
  would be flooded. If we want that later it's an explicit opt-in.
- **`title` is server-composed** from a fixed format string, never raw visitor text. This
  preserves the gateway's existing "no chat content on the wire" invariant while still
  giving the toast something to say. Body/details load from the API when the bell opens.

Mirror it in `RealtimeService` with the same try/catch fail-open wrapper the other two
emitters use.

### Producer — where handover fires

In [handover.service.ts](../../apps/api/src/services/handover.service.ts), at the existing
`REQUESTED` transition (currently line ~208, right after
`await this.realtime.emitHandover(ctx, 'REQUESTED')`):

```ts
void this.notifications.emit({
  organizationId: ctx.organizationId,
  agentId: session.agentId,
  type: 'HANDOVER_REQUESTED',
  severity: 'URGENT',
  title: `A visitor asked for a human on ${agent.name}`,
  entityType: 'conversation',
  entityId: ctx.publicSessionId,
  email: {
    enabled: agent.handoverEmailEnabled,
    recipients: agent.handoverEmailRecipients,
    templateKey: 'HANDOVER_REQUESTED',
    vars: { orgName, agentName: agent.name, conversationUrl },
  },
});
```

Fire the *other* transitions (taken over, resolved) as socket-only — they already have
`emitHandover`, no notification row needed.

### Email layer

Keep [email.service.ts](../../apps/api/src/services/email.service.ts) as the dumb transport.
Add two services above it.

**`EmailTemplateService`** — `render(key, vars) → { subject, html, text }`

- Loads the row, caches it in-memory for 60s (templates change ~never; this keeps a DB read
  off the send path).
- Substitutes `{{varName}}`.
- **HTML-escapes every substituted value.** A visitor named `<script>` or an org name with
  `<` must not be able to break or inject into the email. Non-negotiable.
- Unknown `{{vars}}` render as empty string, not literal `{{foo}}`.
- Auto-derives a plain-text part by stripping tags — HTML-only email gets penalized by spam
  filters, and this is a one-liner.

**`NotificationMailerService`** — resolves recipients and sends

- `recipients` empty → all non-deleted `User` rows in the org, their `email`.
- `recipients` non-empty → exactly those.
- De-dupe, cap at 20 addresses per send.
- Calls `EmailTemplateService.render()` then `EmailService.send()`.
- Never throws.

**Small additions to `EmailService.send()`** while we're in there:

- accept an optional `text` part and pass it to Resend
- accept `replyTo`
- accept `tags: { type: 'HANDOVER_REQUESTED' }` for per-template analytics in Resend

### Deliverability — one-time setup, not code

Before this goes live, add **SPF, DKIM and DMARC** DNS records for the sending domain
(Resend generates the exact values to paste). Without them Gmail treats us as suspicious by
default; with them, normal transactional volume lands in the inbox. This is the actual
anti-spam lever — nothing in the code substitutes for it.

### API endpoints

**Notifications** (any authenticated dashboard user, org-scoped):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/notifications?limit=20&cursor=` | List for my org, newest first, with `readAt` per item |
| `GET` | `/notifications/unread-count` | Badge number (cursor-based count) |
| `POST` | `/notifications/seen` | Set `user.notificationsSeenAt = now()` — clears the badge |
| `POST` | `/notifications/:id/read` | Upsert a `NotificationRead` row |

**Email templates** (`@Roles('SUPER_ADMIN')`):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/email-templates` | List (key, name, description, subject, updatedAt) |
| `GET` | `/email-templates/:key` | Full row incl. `html` + the allowed variable list |
| `PATCH` | `/email-templates/:key` | Update `subject` + `html` |

`PATCH` writes an **audit log** via
`TracerService.logAuditEvent(ctx, 'EMAIL_TEMPLATE_UPDATED', { key, subjectBefore, subjectAfter, htmlLengthBefore, htmlLengthAfter }, { organizationId })`.
Per the user's call, the audit log is the change history — no separate versioning table.

### The variable registry

Defined once in code (`apps/api/src/services/email-template.registry.ts`) so the editor can
show exactly what's available and the preview knows what to fill in:

```ts
export const TEMPLATE_VARIABLES = {
  HANDOVER_REQUESTED: [
    { key: 'orgName',         label: 'Organization name', sample: 'Acme Corp' },
    { key: 'agentName',       label: 'Agent name',        sample: 'Support Bot' },
    { key: 'visitorName',     label: 'Visitor name',      sample: 'Priya S.' },
    { key: 'conversationUrl', label: 'Link to the chat',  sample: 'https://app.../inbox/abc123' },
  ],
  TEAM_INVITATION: [
    { key: 'orgName',    label: 'Organization name', sample: 'Acme Corp' },
    { key: 'inviterName',label: 'Who invited them',  sample: 'Dhruv' },
    { key: 'inviteUrl',  label: 'Accept-invite link',sample: 'https://app.../invite/xyz' },
    { key: 'expiresIn',  label: 'Expiry text',       sample: '7 days' },
  ],
} as const;
```

`GET /email-templates/:key` returns this list alongside the row. `sample` powers the preview.

### Migrate the existing invitation email

[invitations.service.ts:394](../../apps/api/src/services/invitations.service.ts#L394) currently
builds HTML inline. Move that exact HTML into the `TEAM_INVITATION` seed row and switch the
service to `emailTemplate.render('TEAM_INVITATION', {...})`. This proves the system works on
a real email that's already in production.

---

## Part 3 — Frontend (`apps/web`)

### Bell — dashboard header

- `use-notifications.ts` — React Query. List + unread count. Polls at 60s **only when the
  socket is disconnected** (reuse `useHandoverSocketConnected` from
  [handover-socket.ts](../../apps/web/lib/handover-socket.ts) — the existing pattern).
- Badge shows unread count; opening the panel calls `/notifications/seen` and optimistically
  zeroes it.
- Each item deep-links to the conversation and marks itself read on click.

### Live delivery — one listener, four outputs

Add a `notification` listener to the existing singleton socket. When an event arrives:

1. **Cache update** — push into the React Query list, bump the badge. No refetch.
2. **Toast** — Shadcn `sonner`, click → deep link.
3. **Sound** — see below.
4. **Browser notification** — see below.

### Sound

`apps/web/lib/notification-sound.ts`, module singleton:

- Small self-hosted file at `public/sounds/notification.mp3` (~15KB). Decode once into an
  `AudioBuffer`.
- **Autoplay unlock:** browsers block audio until a gesture on the page. On first
  `pointerdown` after load, play a silent buffer to unlock the `AudioContext`. Without this,
  the very first ding of a session can be silently swallowed. (Same class of problem as the
  [voice preview silent primer](../../docs/).)
- **Coalesce:** ignore repeat plays within 3s, or five simultaneous handovers sound like a
  machine gun.
- **Only when useful:** play if the tab is hidden (`use-tab-visible.ts`) **or** the user
  isn't currently on the Inbox page. Dinging while they stare at the inbox is just noise.
- On/off + volume in **localStorage**, not the DB — sound is a per-device preference (on at
  the desk, off on the laptop). Small speaker toggle in the bell panel header.

### Browser notification

`apps/web/lib/browser-notification.ts` — the **Notifications API** (`new Notification(...)`),
not Web Push. It fires whenever any tab of the app is open, which is exactly the case we
care about: dashboard open in one tab, working in another. Zero backend, zero service worker.

- Fire only when `document.hidden`.
- `tag: notification.id` so a redelivery replaces rather than stacks.
- `onclick` → `window.focus()` + route to the deep link.
- **Never call `Notification.requestPermission()` on page load.** Browsers penalize it and
  users reflex-click Block, which is permanent and only reversible in site settings. Ask on
  an explicit click: a dismissible card in the bell panel — *"Get alerted when a visitor asks
  for a human? [Enable]"* — shown only when `Notification.permission === 'default'`.

### Agent editor — the toggle

In [human-handover-settings.tsx](../../apps/web/components/features/agents/agent-editor/sections/human-handover-settings.tsx),
nested under `humanTakeoverEnabled` exactly like `showTalkToHumanButton` already is:

- Switch: **"Email the team when a visitor asks for a human"** → `handoverEmailEnabled`
- When on, a tags input: **"Send to"** → `handoverEmailRecipients`, with the helper text
  *"Leave empty to email everyone in your organization."*
- Validate email format client-side; max 20.

Wire through `agent-editor-context.tsx` + `agent-editor-layout.tsx` following the existing
`humanTakeoverEnabled` plumbing, and add both fields to the agent update DTO/Zod schema.

### Sidebar — Utilities → Email

New sidebar group **Utilities**, visible only to `SUPER_ADMIN`, with one item **Email** at
`/dashboard/utilities/email`.

Master–detail, structured like the Inbox:

```
┌──────────────────┬──────────────────────────────────────────┐
│ Handover Request │  Subject: [_______________________]      │
│ Team Invitation  │  Variables: {{orgName}} {{agentName}} …   │
│                  │  ┌──────────┬─────────┐                  │
│                  │  │   HTML   │ Preview │        [Save]    │
│                  │  ├──────────┴─────────────────────────┐  │
│                  │  │                                    │  │
│                  │  │   <textarea>  /  <iframe>          │  │
│                  │  │                                    │  │
│                  │  └────────────────────────────────────┘  │
└──────────────────┴──────────────────────────────────────────┘
```

- Left: fixed template list from `GET /email-templates`.
- Right: subject input, clickable variable chips (insert at cursor), and the HTML/Preview
  tab pair.
- **Preview** renders client-side: substitute each `{{var}}` with its `sample` value, write
  the result into a **`sandbox="allow-same-origin"` iframe via `srcdoc`**. Sandboxed so
  pasted HTML/JS can never touch the dashboard. Debounce ~300ms so typing stays smooth.
- Unsaved-changes guard — reuse `use-unsaved-changes-warning.ts`.
- HTML editor is a plain monospace `<textarea>` for v1. No CodeMirror dependency; we can
  upgrade later if it feels cramped.

---

## Part 4 — Tests (`apps/api` only)

Per project convention — backend unit tests required, frontend manual only.

- `notification.service.spec.ts` — writes the row, emits the socket event, calls the mailer;
  **and every failure path stays swallowed** (DB down / socket throw / mailer throw must not
  propagate).
- `email-template.service.spec.ts` — substitution, **HTML escaping of values**, unknown vars
  → empty, cache hit/expiry, text-part derivation.
- `notification-mailer.service.spec.ts` — empty recipients → all org members; explicit
  recipients → exactly those; dedupe; 20 cap.
- `notifications.controller.spec.ts` — org scoping (a user cannot read another org's
  notifications), seen/read endpoints.
- `email-templates.controller.spec.ts` — non-SUPER_ADMIN is rejected; PATCH writes an audit
  log; unknown key → 404 (no creation).
- Update `handover.service.spec.ts` for the new `notifications.emit` call.

---

## Test checkpoints

Build straight through; stop and click at these three points.

1. **Live delivery** — request a handover from the widget → toast + sound + browser popup +
   bell entry appear in the dashboard. Verify: sound doesn't fire while sitting on the
   Inbox; browser popup only fires when the tab is unfocused; nothing appears in a *different*
   org's dashboard.
2. **Template editor** — open Utilities → Email, edit the handover template, preview updates,
   save, audit log row appears. Then trigger a real handover and confirm the delivered email
   matches what was saved.
3. **Toggle** — flip the agent-editor switch off → no email but bell/toast/sound still work.
   Add a custom recipient → only that address gets it. Empty the list → all org members do.

---

## Scale notes (10K orgs)

- Every notification write and emit is fire-and-forget, off the request's critical path.
- Badge count is a single indexed count against `notificationsSeenAt` — never a join, never
  `count(*)` over the whole table.
- Template reads are cached 60s in-memory, so a send does not hit the DB for the template.
- Socket fan-out is already in-memory per instance; multi-instance is covered by the existing
  env-gated `SOCKET_IO_REDIS`.
- No new cron, no new queue, no new Redis usage.
