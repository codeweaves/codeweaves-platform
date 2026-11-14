# ADR-0022: Organization conversation limit, alert only

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Dhruv

## Context

Clients buy a number of conversations, for example 17,000. Sales sells top-ups. There is no self-serve payment. Today nothing records what a client bought, and nobody knows when a client is close to the end of it. We find out late, or not at all.

Platform staff need to set a limit on an organization and get told, in time, when the client uses it up. The product owner decided these rules:

- The limit is alert only. Reaching it never blocks or slows a chat.
- A conversation is one `chat_sessions` row with `source` WIDGET or WHATSAPP. DEMO previews in the dashboard do not count.
- Usage counts from the moment staff set the limit. Each submit of a limit, even the same number, restarts the count.
- The contract start date is for display only.
- Every super admin gets one email at 50%, 90% and 100% of each limit.

Volume today is about 10,000 conversations a month across all organizations, and it will grow. The check runs once per new conversation.

## The four questions

- **Blast radius:** if the check is wrong, an alert comes late, early or twice. Chats are not affected: the check is not awaited and never throws. If the count is wrong, staff see a wrong usage number on one page.
- **One-way or two-way door:** two-way. Three nullable columns and one small table. Removing the feature is a migration that drops them and one hook call in `ChatService`.
- **Couples us to:** the meaning of a conversation as one `chat_sessions` row. If session rotation rules change (lifetime cap, page reload), usage changes with them.
- **Cost of waiting:** client onboarding starts the week of 2026-11-16. Without this, staff track limits by hand in a spreadsheet and miss the moment a client runs out.

## Decision

We store the limit on the organization and check it after each new conversation.

| Part                                      | What                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations.conversation_limit`        | The limit. Null means no limit.                                                                                                                                   |
| `organizations.conversation_limit_set_at` | Stamped by the API on every submit of a limit. Usage counts sessions created at or after it. A CHECK constraint keeps it null exactly when the limit is null.     |
| `organizations.contract_start_date`       | A date for display. Never used in counting.                                                                                                                       |
| `conversation_limit_alerts`               | One row per alert sent. Unique on (organization, `limit_set_at`, threshold). A CHECK allows only 50, 90 and 100.                                                  |
| `GET/PATCH /organizations/:id/contract`   | Staff read and set the contract. Gated by `OrganizationContract:Read` and `OrganizationContract:Update`. Both are platform-only and held by the super admin only. |
| `CONVERSATION_LIMIT_ALERT` email template | The body is in the database and editable. The layout is in code (ADR-0021).                                                                                       |

Rules that follow:

- `ChatService` calls `ConversationLimitService.checkAfterNewConversation(agentId)` after it creates a WIDGET or WHATSAPP session. It does not await the call. The check catches all its errors, and `ChatService` adds a second catch as a backstop.
- The check does as little as it can. First it reads the organization's limit, and stops when there is none. Then it reads the alerts already sent for this limit, and stops when all three are sent. Only then does it count. The count has no cap, because the alert email reports it and sales may bill from it. It must be the real number even when an alert goes out late, after a retried send or a jump past the limit. Above the limit, the email shows the real usage (for example 17,050 of 17,000) and 0 left.
- The unique key decides who sends. Two conversations that cross a threshold at the same moment both try to insert the alert row. Only one insert succeeds, and only that call sends the email.
- One call sends at most one email, for the highest threshold it inserted. A jump from 40% to 100% records all three rows and sends one 100% email.
- Recipients are users with an active `platform.super_admin` assignment, at most 20.
- Each recipient gets a separate email with only their own address in `to`. The emails go one after another, not in parallel, because the provider's rate limit is low. One bad or bounced address does not stop the others, and no super admin sees another's address.
- An alert row means the provider accepted the email for at least one recipient. The row is inserted first, as a claim, so that a concurrent check does not send too.
- When no recipient's email is accepted, the call deletes exactly the rows it inserted. This covers no super admin to receive it, a template that fails to render, and a provider that refuses every email. The next new conversation then claims the threshold and tries again. Retries continue, one per new conversation, until at least one email is accepted.
- When some recipients fail and at least one succeeds, the alert counts as sent. The failed recipients are not retried. The `CONVERSATION_LIMIT_ALERT_SENT` event records how many were delivered and how many failed.
- If that delete fails, the alert stays marked as sent and is not retried. The failure is logged in `event_logs` as `CONVERSATION_LIMIT_ALERT_RELEASE_FAILED`.

## Options rejected

### Hard stop at the limit

**Good:** the limit means what it says. No client can use more than they paid for, and no one has to chase a top-up.

**Rejected because:** there is no self-serve payment. Sales handles top-ups by hand. A client who runs out at night or on a weekend would lose their chatbot until someone in sales replies. Cutting off a client's customers harms the relationship more than the extra conversations cost us.

**Revisit if:** we add self-serve payment, so a client can top up the moment they run out.

### A cron job that scans all organizations

**Good:** no work on the chat path at all. One query can count every organization in a batch, so the total database work can be lower than one check per conversation.

**Rejected because:** it needs a scheduler entry in every environment (pg_cron or an external trigger), and each one must be set up and watched. Alerts arrive only on the next run, so a client can cross 100% hours before anyone is told. The per-conversation check is cheap once it skips early.

**Revisit if:** volume grows enough that the per-conversation count shows up in database load.

### A counter column incremented per conversation

**Good:** O(1). The check reads one number, with no count over `chat_sessions`.

**Rejected for now because:** the counter can drift from the real rows. A failed increment, a session deleted by the retention sweep or by an erasure request, or a bug in one channel would make the number wrong, and we would need a repair job to fix it. The count with an early skip is cheap enough today.

**Revisit if:** the count becomes a measurable cost. A counter can then sit beside the count, with the count as the check.

### Count from the contract start date, with an automatic yearly reset

**Good:** no one has to remember to reset the count. Usage lines up with the contract year.

**Rejected because:** the product owner wants manual control. Contracts do not all run a year, top-ups happen mid-term, and a reset that happens by itself can surprise staff. Submitting the limit is the reset, and staff decide when.

## Consequences

- Staff see each client's usage against their limit, and super admins get an email at 50%, 90% and 100%.
- Chats are never blocked or slowed by the limit.
- Conversations above an old limit are not carried into the new count. When staff submit a new limit, the count starts again at zero. A client at 120% who gets a top-up starts at 0% of the new limit.
- DEMO previews are not counted. Staff testing an agent in the dashboard does not use up the client's conversations.
- A conversation is a session, so usage follows the session rules. A visitor who reloads the page starts a new session, and that counts as a new conversation.
- Organizations with no limit pay one indexed lookup per new conversation. Organizations with a limit pay two or three more queries until all three alerts are sent, then one more lookup.
- An alert that reached nobody is retried on the next new conversation until one email is accepted. While the provider is down, an organization past a threshold makes one round of sends (one per super admin) per new conversation. Each failed round is logged as `CONVERSATION_LIMIT_ALERT_FAILED`.
- One alert costs one provider call, one usage row and one audit row per super admin, not one per alert. With the cap of 20 and at most three alerts per limit, this stays small.
- When the provider reports a failure but delivered the email anyway, the retry sends it a second time. We accept this. A missed alert costs more than a duplicate.
- An organization with no super admin to email retries on every new conversation, at the cost of one recipient query each time, until a super admin exists.
- The usage number on the page is a live count, not a cached value.
- New work: the contract page in the dashboard, which reads and writes the two routes above.
