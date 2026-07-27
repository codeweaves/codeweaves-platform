-- Dashboard notifications + DB-backed transactional email templates.
--
-- Three tables:
--   notifications      — one row per EVENT (not per recipient); powers the bell
--   notification_reads — per-user read state, fanned out on read
--   email_templates    — editable email bodies, SEEDED HERE (never created via API)
--
-- Plus: a per-user badge cursor on `users`, and the per-agent handover-email
-- toggle on `agents`.
--
-- RLS: the auto_enable_rls event trigger (migration 20260725000100) turns RLS on
-- for every new public table automatically. The explicit ALTERs at the bottom
-- are belt-and-braces so this migration is still correct if that trigger is ever
-- dropped. RLS with no policy = deny-all to anon/authenticated; the app connects
-- with the service role and bypasses it.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('HANDOVER_REQUESTED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'URGENT');

-- AlterTable: badge cursor
ALTER TABLE "users" ADD COLUMN "notificationsSeenAt" TIMESTAMP(3);

-- AlterTable: per-agent handover email settings
ALTER TABLE "agents" ADD COLUMN "handoverEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agents" ADD COLUMN "handoverEmailRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(300) NOT NULL,
    "body" VARCHAR(1000),
    "entityType" VARCHAR(40),
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "subject" VARCHAR(300) NOT NULL,
    "html" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key")
);

-- CreateIndex: the bell list + badge count both read (org, createdAt desc)
CREATE INDEX "notifications_organizationId_createdAt_idx" ON "notifications"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_reads_userId_idx" ON "notification_reads"("userId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Seed the template rows. ON CONFLICT DO NOTHING so a re-run never clobbers
-- copy that a SUPER_ADMIN has since edited in the dashboard.
--
-- NOTE on {{conversationUrl}}: it resolves to /dashboard/inbox?n=<notificationId>,
-- NOT to a session id. A publicSessionId is a bearer credential for the
-- unauthenticated public chat endpoints, so it must never appear in an email;
-- a notification id is useless without a login in the owning organization.
-- See NotificationService.deepLink.
-- ---------------------------------------------------------------------------

INSERT INTO "email_templates" ("key", "name", "description", "subject", "html", "updatedAt")
VALUES (
  'HANDOVER_REQUESTED',
  'Handover Requested',
  'Sent to the team the moment a visitor asks to speak with a human.',
  'A visitor wants to talk to a human on {{agentName}}',
  '<div style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h1 style="font-size:20px;margin:0 0 16px;">Someone is waiting to talk to you</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
    A visitor on <strong>{{agentName}}</strong> just asked to speak with a human.
  </p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#6b7280;">
    They are waiting in the chat right now — the sooner someone joins, the better.
  </p>
  <a href="{{conversationUrl}}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
    Open the conversation
  </a>
  <p style="font-size:13px;line-height:1.6;margin:28px 0 0;color:#9ca3af;">
    Sent by {{orgName}} via Klivo.
  </p>
</div>',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "email_templates" ("key", "name", "description", "subject", "html", "updatedAt")
VALUES (
  'TEAM_INVITATION',
  'Team Invitation',
  'Sent when someone is invited to join an organization on the platform.',
  'You have been invited to Klivo',
  '<div style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h1 style="font-size:20px;margin:0 0 16px;">Welcome to Klivo!</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">
    You have been invited to join <strong>{{orgName}}</strong> on the platform.
  </p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
    Click the button below to get started:
  </p>
  <a href="{{actionUrl}}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">
    {{actionLabel}}
  </a>
  <p style="font-size:13px;line-height:1.6;margin:28px 0 0;color:#9ca3af;">
    This link expires in {{expiresIn}}.
  </p>
</div>',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

-- Explicit RLS (the auto_enable_rls event trigger already does this; kept so
-- this migration remains correct on its own).
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
