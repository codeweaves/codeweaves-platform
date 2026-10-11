# ADR-0014: Retire n8n chat routing

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Dhruv Khator

## Context

Every agent carried a routing switch, `aiConfig.routingMode`, with two values:

- `n8n`: the API forwarded each chat or voice message to a tenant-configured n8n webhook URL and relayed the reply. Responses could be HMAC-verified with a per-agent secret.
- `direct`: the API calls the model provider itself through `DirectChatService`.

Facts on 2026-10-11:

- We stopped using n8n for chatbots earlier. All product work since then (handover, PII vault, consent, usage ledger, tool calls) exists only on the direct path. n8n agents got none of it: no human handover, no `connect_to_human` tool, no per-turn cost metering.
- The shared validation default was still `n8n`. On the dev database, 14 of 27 agents had no `routingMode` set, so they silently fell onto the n8n path. 6 agents had a stored webhook URL.
- The webhook URL was the only place a tenant could make our server call an arbitrary address. The vendor security review that prompted this work found that the "test webhook" button could be pointed at internal addresses (SSRF), including through a redirect.
- The n8n path carried its own code: a streaming client, an HMAC service and module, three webhook endpoints, the `agent_secrets` table, the `hmacEnabled` column, and a voice branch. About 1,500 lines across source and tests.

If we do nothing, agents keep landing on a path that lacks our safety and compliance work, and we keep a tenant-controlled outbound URL we would have to harden against SSRF.

## The four questions

- **Blast radius:** an agent that genuinely depended on an n8n workflow stops calling it and answers with the direct LLM instead. There are no paying customers on n8n, and production is not live.
- **One-way or two-way door:** one-way for data. The migration drops `agent_secrets` (webhook URLs and HMAC secrets) and the `hmacEnabled` column. The code can be restored from git history, but the stored URLs cannot.
- **Couples us to:** nothing new. It removes a coupling to n8n's response format.
- **Cost of waiting:** every day the default stays `n8n`, new agents with an empty config skip handover, PII controls and metering. The SSRF finding stays open on the vendor assessment.

## Decision

Every agent is served by the direct path. n8n routing is removed, not just disabled.

| Area                                                            | Change                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat (`ChatService.sendMessage`, `PublicChatController.stream`) | Always `DirectChatService`. The n8n branch, webhook client and HMAC verification are deleted.                                                                                                    |
| Voice (`VoiceController`)                                       | Always `DirectChatService`, adapted to the voice token stream. The webhook branch is deleted. The stream chunk type is renamed `TokenStreamChunk`.                                               |
| API surface                                                     | `PATCH/GET /agents/:id/webhook` and `POST /agents/:id/webhook/test` are deleted. `editor-config` no longer returns `webhookUrl`.                                                                 |
| Database                                                        | Migration `20261011000200_retire_n8n` drops `agent_secrets` and `agents.hmacEnabled`, and strips `routingMode` from stored `aiConfig`.                                                           |
| Validation                                                      | `routingMode` stays accepted but ignored, so older payloads still pass the `.strict()` schema, the same treatment as `piiLogRedaction`. `resolveRoutingMode` and the webhook schema are deleted. |
| Dashboard                                                       | The Integration tab loses the routing switch and the webhook field. It keeps allowed domains and the model settings.                                                                             |
| Env                                                             | `DEFAULT_WEBHOOK_URL` and `N8N_ALLOW_PRIVATE_WEBHOOK_HOSTS` are gone.                                                                                                                            |

Kept on purpose:

- The `AgentSecret:Read` and `AgentSecret:Update` permissions. They gate the Integration tab (ADR-0010). Renaming them is a separate RBAC change.
- n8n remains fine for internal automation outside the chat path.

Rule that follows: any future feature that calls a tenant-supplied URL needs its own SSRF design (connect-time address check, no redirects) before it ships.

## Options rejected

### Keep n8n, default new agents to direct

**Good:** no data loss, and a customer with an existing n8n workflow keeps it.

**Rejected because:** n8n agents would still lack handover, PII controls and metering, and the tenant-set webhook URL would still need a full SSRF guard. We would maintain two chat engines for no current user.

**Revisit if:** a paying customer needs their own workflow engine in the reply path. Build that as a proper integration (a tool the direct agent calls), not as a second routing mode.

### Keep n8n behind an SSRF guard

**Good:** closes the security finding without removing a feature. A guard was in fact written and tested (host check, connect-time address re-check, no redirects).

**Rejected because:** it hardens a path nobody uses, and it leaves the feature gap above. Deleting the path closes the finding completely.

## Consequences

- Better: one chat engine. Every agent gets handover, PII redaction, consent, metering and tool calls. The SSRF surface is gone.
- Better: about 1,500 fewer lines to maintain, and the voice pipeline no longer names a retired vendor.
- Worse: the 6 stored webhook URLs are deleted. Anyone who still wants an n8n flow must rebuild it as an integration.
- Worse: historical `chat_messages.metadata` rows may still carry `n8nReceivedAt` and `agentRepliedAt`, and historical `event_logs` rows may carry provider `N8N`. Nothing reads them, and retention removes them over time.
- New work: none required. The `AgentSecret` permission name is now misleading and can be renamed in a later RBAC change.
