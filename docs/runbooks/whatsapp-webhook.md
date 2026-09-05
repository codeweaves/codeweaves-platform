# WhatsApp messages not arriving or not answered

## Symptom
Customers message the WhatsApp number and get nothing back, or Meta shows webhook delivery failures.

## Confirm
```sql
SELECT "eventName", success, "errorMessage", count(*)
FROM event_logs
WHERE channel = 'WHATSAPP' AND "createdAt" > now() - interval '1 hour'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```
- No `WHATSAPP_MESSAGE_RECEIVED` rows: Meta is not reaching us (webhook URL, verification, or signature rejection).
- `WHATSAPP_WEBHOOK_REJECTED`: signature check failed. The API verifies `X-Hub-Signature-256` against the raw body with `WHATSAPP_APP_SECRET`. Wrong secret = every delivery rejected.
- Received but no `WHATSAPP_REPLY_SENT`: reply path failed. Read the `META_WHATSAPP_SEND_TEXT` rows for the Graph API error (token expired, template required outside the 24 h window, number not opted in).
- Agent editor, WhatsApp: channel connected, phone number id correct, token present.

## Cause
- App secret or access token rotated in Meta but not in the API or channel config.
- Webhook subscription lost after a Meta app review or business verification change.
- Agent inactive, or the channel disconnected.
- Session is `ACTIVE_HUMAN`: the bot correctly stays silent; the reply must come from the dashboard inbox.

## Fix
1. Meta App Dashboard, WhatsApp, Configuration: webhook URL `https://<api>/api/klivo/v1/public/whatsapp/webhook`, verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `messages` field subscribed. Re-verify.
2. `WHATSAPP_APP_SECRET` in Render must match the Meta app secret exactly. Redeploy after change.
3. Token errors on send: reconnect the channel from the agent editor to store a fresh token.
4. Send a test from your own number and read the two event rows it should produce.

## Prevent
- Use a permanent System User token, not a temporary one.
- Alert on `WHATSAPP_WEBHOOK_REJECTED` > 0 in 10 minutes.
