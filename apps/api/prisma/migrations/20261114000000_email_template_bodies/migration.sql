-- Email templates now hold only the BODY of the email.
--
-- The logo header, the white card and the footer are a fixed layout in code
-- (apps/api/src/services/email-layout.ts) that wraps every body at send time.
-- The seeded rows still carried their own outer wrapper (width, padding,
-- font), so this migration replaces them with body-only HTML.
--
-- The button is a table cell with a background colour (a "bulletproof"
-- button), because Outlook ignores padding and border-radius on a plain link.
--
-- `"updatedBy" IS NULL` means "never edited in the dashboard". A row that a
-- SUPER_ADMIN has edited is left as it is. It still renders inside the new
-- layout.

UPDATE "email_templates"
SET "html" = '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:#0a1a45;">Someone is waiting to talk to you</h1>
<p style="margin:0 0 12px;">A visitor on <strong style="color:#111827;">{{agentName}}</strong> asked to speak with a human.</p>
<p style="margin:0 0 28px;">They are waiting in the chat now. Join as soon as you can.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="#0a1a45" style="border-radius:8px;"><a href="{{conversationUrl}}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open the conversation</a></td>
</tr></table>
<hr style="border:0;border-top:1px solid #e6e8ee;margin:32px 0 20px;">
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Button not working? Copy this link into your browser:<br><a href="{{conversationUrl}}" style="color:#0a1a45;word-break:break-all;">{{conversationUrl}}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">You get this email because you are on the {{orgName}} team on Klivo.</p>',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'HANDOVER_REQUESTED' AND "updatedBy" IS NULL;

UPDATE "email_templates"
SET "html" = '<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.3px;color:#0a1a45;">Join {{orgName}} on Klivo</h1>
<p style="margin:0 0 12px;">You have been invited to join the <strong style="color:#111827;">{{orgName}}</strong> team on Klivo.</p>
<p style="margin:0 0 28px;">Set up your account to get started.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="#0a1a45" style="border-radius:8px;"><a href="{{actionUrl}}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">{{actionLabel}}</a></td>
</tr></table>
<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">This invitation expires in {{expiresIn}}.</p>
<hr style="border:0;border-top:1px solid #e6e8ee;margin:32px 0 20px;">
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">Button not working? Copy this link into your browser:<br><a href="{{actionUrl}}" style="color:#0a1a45;word-break:break-all;">{{actionUrl}}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">If you did not expect this invitation, you can ignore this email.</p>',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'TEAM_INVITATION' AND "updatedBy" IS NULL;
