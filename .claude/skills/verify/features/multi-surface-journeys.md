# Multi-surface journeys

Journeys that cross the widget, the dashboard and the database. Per-surface handles live in the linked files. Read those first, then sequence the journey here. Baseline preconditions in [the feature-map README](README.md) apply.

## Human handover, end to end

Two tabs at once: `--page visitor` (the widget) and `--page teammate` (the dashboard). Proven 2026-09-27.

1. **Teammate ready.** Run `dashboard login --as teammate --page teammate` and open the inbox. It shows "All clear", and the Socket.io websocket is open. See [inbox.md](./inbox.md).
2. **Visitor asks.**
   - Run `widget open --agent chat --page visitor`, then `widget send --page visitor --text "I need help with my order."`.
   - Run `browser click --page visitor --role button --name "Talk to a human"`.
   - The widget shows "Connecting you with our team…".
3. **Live arrival.** Without a reload, `browser wait --page teammate --text "Wants human"` passes within a second. The sidebar reads `Inbox 1` and the tab `Needs you 1`.
4. **Take over and reply.** The teammate opens the row, clicks `Take over` and sends a reply.
5. **Live delivery.** Run `widget wait-message --page visitor --from human --contains "<reply text>"`. It passes within a second, as `article "Team member message"`, with no reload.
6. **AI paused.** A visitor `widget send` returns `outcome: "no-reply"`, which is correct while a human holds the chat. The teammate sees the message live.
7. **Resolve.** The teammate clicks `Resolve`. The visitor sees "You're back with our assistant" live. The next `widget send` returns `outcome: "replied"` from the AI.
8. **Records.** Run the checks in [inbox.md](./inbox.md): session state, `handover_events` with resolution HUMAN, three audit events, the URGENT notification and the SYSTEM lines.

## Widget chat appears in the dashboard

Send a message in the widget ([widget-chat.md](./widget-chat.md)). As `owner`, the overview's "Recent conversations" lists the agent with the message count. The same turn is in `chat_messages`.

## Editor change reaches the widget

- **Every saved field reaches visitors.** The public config ETag is a hash of the whole payload, so any save changes it: theme fields (header title, colors, launcher position, handover button label, consent) and agent fields (greeting, name, voice, handover switches). The next widget load gets 200 and shows the change, with no cache clearing. A load with nothing changed still gets 304.
- F-07, fixed 2026-09-27: the tag used to be the theme version only, and agent-field saves stayed stale in the widget's localStorage and the browser HTTP cache.
- "Next load" holds because the widget's config cache time is 0 (`apps/widget/src/services/config-loader.ts`), so it asks the server on every load. If that time is ever raised, a change appears only after it expires.
- Proof steps are in [agent-editor.md](./agent-editor.md) and [widget-voice.md](./widget-voice.md).

## Knowledge reaches replies

Upload `.verify/fixtures/faq.txt` in the editor's Prompt section and save ([agent-editor-sections.md](./agent-editor-sections.md)). Then ask the widget a question only that file answers ("What are your opening hours?"). The reply quotes the file.

## Role gates

Each role sees only its own sidebar ([dashboard-shell.md](./dashboard-shell.md)) and editor sections ([agent-editor.md](./agent-editor.md)). The server enforces the same rules: a teammate's agent delete returns 403 ([agents-list.md](./agents-list.md)).

## Tenant isolation

Proven 2026-09-27. The sandbox owner must never see the other org ("Verify Other Org") or platform-only data.

1. **Give the other side data first.** An empty tenant proves nothing. Run `widget open --agent <otherOrg.agent.publicId> --page visitor`, then `widget send --page visitor --text "Isolation probe from another tenant."`. `chat_sessions` for that agent now has at least one row.
2. **Take the owner's own token.** Run `dashboard login --as owner --page teammate`, then `browser eval --page teammate --js "(async()=>await window.Clerk.session.getToken({template:'klivo-api'}))()"`. Keep it in a shell variable and never print it. Never use a super admin token here.
3. **Call the API directly** with `Authorization: Bearer <token>` on `http://localhost:3001/api/klivo/v1`:

   | Request                                                                                      | Expect                                            |
   | -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
   | `GET /agents/<agents.chat.id>` (control)                                                     | 200                                               |
   | `GET /agents/<otherOrg.agent.id>`                                                            | 404                                               |
   | `GET /agents/<otherOrg.agent.id>/editor-config`                                              | 404                                               |
   | `GET /agents/<otherOrg.agent.id>/data-fields/collected`                                      | 404                                               |
   | `GET /organizations/<otherOrg.id>`                                                           | 404                                               |
   | `GET /organizations`                                                                         | 403                                               |
   | `GET /users` and `GET /users/<users.teammate.id>`                                            | 403                                               |
   | `GET /email-templates`                                                                       | 403                                               |
   | `GET /conversations?agentIds=<otherOrg.agent.id>`, `?limit=100`, `?search=Isolation%20probe` | 200 with zero rows whose agent is the other org's |

4. **UI redirects.** As `owner`, open `/dashboard/organizations`, `/dashboard/users`, `/dashboard/team` and `/dashboard/utilities/email`. Each lands on `/dashboard`. Wait for `heading "Welcome back, Verify"` before reading the URL: the redirect runs on the client after permissions load, so an immediate read still shows the old path.
