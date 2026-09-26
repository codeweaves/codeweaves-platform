# Inbox (human handover, teammate side)

Teammates see conversations where a visitor asked for a human, take one over (the AI pauses), reply in real time, and resolve it (the AI resumes). Updates arrive over Socket.io without a reload.

## Sub-features

- `inbox-tabs`: `Needs you` (REQUESTED) and `Handling` (ACTIVE_HUMAN), each with a count, for example `Needs you 1`.
- `inbox-row`: visitor label, last line, a `Wants human` chip, agent name and message count.
- `inbox-takeover`: `Take over` assigns the chat and pauses the AI. Toast "You're now handling this chat. The AI is paused."
- `inbox-reply`: textarea `Type your reply…` plus `Send`. The reply reaches the widget live.
- `inbox-resolve`: `Resolve` gives the chat back to the AI. Toast "Resolved. The AI takes over again."
- `inbox-badge`: the sidebar link shows the waiting count (`Inbox 1`).
- `inbox-override`: a super admin sees `Take over anyway` on a chat someone else holds.

## How to get to it (user POV)

- Sidebar `Inbox` (`/dashboard/inbox`). Or click a handover notification, which deep-links to `/dashboard/inbox?n=<id>`.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. The `chat` agent has human takeover and the button on. Use `teammate` (org.inbox_agent) or `owner`.
- The visitor side is in [multi-surface-journeys.md](./multi-surface-journeys.md). Run both tabs together.

- **Empty.** Run `dashboard login --as teammate --page teammate`, then `browser goto --page teammate http://localhost:3000/dashboard/inbox`. The page shows buttons `Needs you` and `Handling`, and the text "All clear". `browser events --type websocket` shows an open socket to `ws://localhost:3001/socket.io/`.
- **Live request.** After the visitor presses `Talk to a human`, run `browser wait --page teammate --text "Wants human"` with no reload. The snapshot shows `link "Inbox 1"`, `button "Needs you 1"`, and a row containing "Visitor asked for a human".
- **Take over.**
  1. `browser click --page teammate --text "Visitor asked for a human"`, then wait for the banner "This visitor asked for a human".
  2. `browser click --page teammate --role button --name "Take over"`, then wait for "You're now handling this chat".
- **Reply.** `browser fill --page teammate --css 'textarea[placeholder="Type your reply…"]' --value "<text>"`, then `browser click --page teammate --role button --name "Send" --exact`.
- **Visitor messages while paused.** A visitor message appears in the thread (`browser wait --page teammate --text "<visitor text>"`), and the AI does not answer.
- **Resolve.** `browser click --page teammate --role button --name "Resolve"`, then wait for "Resolved. The AI takes over again".
- **Records.** After resolving:
  - `chat_sessions` shows `handoverState` NONE, `handoverReason` USER_REQUESTED, and all three timestamps set.
  - `handover_events` has one row with `resolution` HUMAN.
  - `audit_logs` has `HANDOVER_TAKEN_OVER`, `HANDOVER_HUMAN_REPLY_SENT` and `HANDOVER_RESOLVED`.
  - `notifications` has one `HANDOVER_REQUESTED` row, severity URGENT.
  - `chat_messages` has SYSTEM lines "Visitor asked for a human", "<name> took over. AI paused" and "Resolved by <name>. AI resumed", with the reply in between.
- **Proof.** Save screenshots under `.verify/artifacts/inbox/` and `multi-surface/`, plus the query outputs.

## Gotchas

- Tabs are plain buttons, not `role=tab`, and their names include the count. Match with `--text` or a regex.
- The reply textarea has no label. Target it by placeholder, which uses the ellipsis character `…`, not three dots.
- Without a working socket, the page falls back to a 30 s poll. A live-update check must first confirm the websocket is open.
- Idle auto-resolve (`HANDOVER_IDLE_MINUTES`, default 20) runs only when the internal sweep endpoint is called. Locally nothing auto-resolves.
- The URL `?session=` value is the widget's bearer credential. Keep it out of reports.
- `org.analyst` and `org.viewer` have no Inbox.
