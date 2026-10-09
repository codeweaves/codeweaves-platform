# ADR-0010: Integration is an add-on, and it owns allowed domains

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Dhruv Khator

## Context

The Integration section of the agent editor holds allowed domains (the widget's embed allow-list), routing (n8n or the AI orchestrator), the n8n webhook URL and the AI model. Integration is the `org.agent_integrations` add-on role (migration `20260810000000_split_agent_editor_roles`). Your team grants it to a user on purpose. It is not part of the owner package.

On develop, four rules disagreed:

| Where                             | Rule                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner role                        | `20260810000000` gave `org.owner` the add-on's `Agent:UpdateIntegration` permission, but not `AgentSecret:Read`.                                                |
| Dashboard                         | The Integration tab opens only with `AgentSecret:Read`.                                                                                                         |
| API read (`stripSensitiveFields`) | Every org-scoped user gets the agent with `allowedDomains` removed. This dates from February 2026, before RBAC, when a client could not open the editor at all. |
| API write (`PATCH /agents/:id`)   | Any user with `Agent:Update` can replace `allowedDomains`.                                                                                                      |

The results:

- An owner cannot see the Integration tab, but can change routing and the AI model through the API.
- A user with the Integrations add-on opens the tab and sees an empty domain list, because the API hid it. Adding one domain sends a one-item list, which deletes the client's real domains.
- A user with only `org.agent_editor` can overwrite the domain list through the API without seeing it.

## The four questions

- **Blast radius:** a wrong rule lets the wrong user change where the widget loads or which AI model answers. The dashboard, the agents API and the owner role are affected. The widget and its CORS check are not.
- **One-way or two-way door:** two-way. It is one role grant, one permission key in one service, and description strings. No data shape changes.
- **Couples us to:** nothing new. It uses the existing RBAC catalog.
- **Cost of waiting:** an integrations user can wipe a client's allow-list today.

## Decision

Integration is add-on only, and `Agent:UpdateIntegration` gates everything in it.

- **Owner role:** migration `20261009000000_integration_addon_only` removes `Agent:UpdateIntegration` from `org.owner`. Owners get Integration only if they are also given the add-on.
- **Write:** `allowedDomains` joins `aiConfig` in the `Agent:UpdateIntegration` field gate in `AgentsService.GATED_SECTIONS`.
- **Read:** an org-scoped user gets `allowedDomains` only with `Agent:UpdateIntegration`. Platform users still always get it.
- **Dashboard:** unchanged. The tab still opens with `AgentSecret:Read`, which only the add-on and platform staff hold.
- **Labels:** the same migration updates the permission and role descriptions, so whoever grants the add-on sees that it controls the allow-list.

The rule that follows: a user sees a field if and only if the user can write it. Never give a user a write path to a value they cannot read.

## Options rejected

### Give owners the Integration tab

**Good:** owners already held `Agent:UpdateIntegration`, so opening the tab for them was a one-line gate change. Owners could manage their own domains without asking.

**Rejected because:** Integration is a deliberate add-on. Routing, the AI model and the webhook are set up by our team, and the owner package should not include them.

### A separate `Agent:UpdateDomains` permission

**Good:** the most precise grant. A client could manage domains without touching routing or the AI model.

**Rejected because:** it adds a permission, a role and a new editor section for one list. Nobody has asked to split domains from routing.

**Revisit if:** clients want to manage their own domains without the Integrations add-on.

### Keep `Agent:Update` as the domain write gate and only fix the read

**Good:** the smallest change to existing grants.

**Rejected because:** `org.agent_editor` would keep a write path to a list it cannot see.

## Consequences

- Owners lose an API-only ability to change routing and the AI model. No dashboard flow used it, because the tab was hidden from them.
- `org.agent_editor` alone can no longer change allowed domains. No dashboard flow did that either.
- Users with the Integrations add-on see the real domain list, so adding a domain no longer deletes the others.
- The add-on alone still cannot save: `PATCH /agents/:id` requires `Agent:Update`. This is unchanged. Add-on roles are designed to sit on top of a base role such as `org.agent_editor`.
