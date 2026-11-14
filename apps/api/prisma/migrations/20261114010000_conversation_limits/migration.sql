-- Per-organization conversation limit with alert emails (ADR-0022).
--
-- The limit is ALERT ONLY. Reaching it never blocks a chat. Usage counts the
-- WIDGET and WHATSAPP sessions created since `conversation_limit_set_at`.
-- DEMO previews do not count. The API stamps `conversation_limit_set_at` each
-- time staff submit a limit, so a new limit starts a fresh count.
--
-- `contract_start_date` is for display only. It never affects counting.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "contract_start_date" DATE,
ADD COLUMN     "conversation_limit" INTEGER,
ADD COLUMN     "conversation_limit_set_at" TIMESTAMP(3);

-- A limit without a stamp would have no start for its count, and a stamp
-- without a limit means nothing. The API writes both together; this keeps any
-- other writer honest. Prisma does not model CHECK constraints, so this causes
-- no schema drift.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_conversation_limit_set_at_check"
  CHECK (("conversation_limit" IS NULL) = ("conversation_limit_set_at" IS NULL));

-- One row per alert sent (50, 90 or 100 percent) for one limit. The unique key
-- makes each alert fire exactly once per limit, even when two conversations
-- cross the line at the same moment.

-- CreateTable
CREATE TABLE "conversation_limit_alerts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "limit_set_at" TIMESTAMP(3) NOT NULL,
    "threshold" INTEGER NOT NULL,
    "conversation_limit" INTEGER NOT NULL,
    "conversations_used" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_limit_alerts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_limit_alerts_threshold_check" CHECK ("threshold" IN (50, 90, 100))
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_limit_alerts_organization_id_limit_set_at_thre_key" ON "conversation_limit_alerts"("organization_id", "limit_set_at", "threshold");

-- AddForeignKey
ALTER TABLE "conversation_limit_alerts" ADD CONSTRAINT "conversation_limit_alerts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Permissions
--
-- OrganizationContract:Read    view the contract start date, the limit and usage.
-- OrganizationContract:Update  set the contract start date and the limit.
--
-- Both are platform-only (org_allowed = false): the contract is our commercial
-- data about the client, not something the client manages. The role-purity
-- trigger (20260809000000_rbac_roles_permissions) stops any org role from ever
-- holding them. Only the super admin holds them.
-- ---------------------------------------------------------------------------

INSERT INTO "permissions" ("key", "resource", "action", "description", "org_allowed") VALUES
  ('OrganizationContract:Read',   'OrganizationContract', 'Read',   'View an organization''s contract, conversation limit and usage', false),
  ('OrganizationContract:Update', 'OrganizationContract', 'Update', 'Set an organization''s contract start date and conversation limit', false)
ON CONFLICT ("key") DO NOTHING;

-- Super admin holds every permission.
INSERT INTO "role_permissions" ("role_key", "permission_key")
SELECT 'platform.super_admin', "key" FROM "permissions"
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Email template
--
-- The row holds only the email BODY. The fixed layout in code
-- (apps/api/src/services/email-layout.ts, ADR-0021) adds the logo header and
-- the footer at send time.
-- ---------------------------------------------------------------------------

INSERT INTO "email_templates" ("key", "name", "description", "subject", "html", "updatedAt")
VALUES (
  'CONVERSATION_LIMIT_ALERT',
  'Conversation Limit Alert',
  'Sent to super admins when an organization uses 50%, 90% and 100% of its conversation limit.',
  '{{orgName}} has used {{thresholdPercent}}% of its conversations',
  '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:#0a1a45;">{{orgName}} has used {{thresholdPercent}}% of its conversations</h1>
<p style="margin:0 0 12px;"><strong style="color:#111827;">{{orgName}}</strong> has used <strong style="color:#111827;">{{conversationsUsed}}</strong> of its <strong style="color:#111827;">{{conversationLimit}}</strong> conversations.</p>
<p style="margin:0 0 12px;">{{conversationsRemaining}} conversations are left.</p>
<p style="margin:0 0 28px;">The agents keep working. Talk to the client about a top-up if they need more.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="#0a1a45" style="border-radius:8px;"><a href="{{organizationUrl}}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open the organization</a></td>
</tr></table>
<hr style="border:0;border-top:1px solid #e6e8ee;margin:32px 0 20px;">
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Button not working? Copy this link into your browser:<br><a href="{{organizationUrl}}" style="color:#0a1a45;word-break:break-all;">{{organizationUrl}}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">You get this email because you are a super admin on Klivo.</p>',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
