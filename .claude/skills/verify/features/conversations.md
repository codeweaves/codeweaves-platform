# Conversations

A teammate browses every conversation for their org's agents, filters and searches the list, and opens one to read the full transcript.

## Sub-features

- `conv-list`: a paginated list of conversations for the org.
- `conv-open`: selecting a row opens `/dashboard/conversations/<sessionId>` with the transcript.
- `conv-transcript`: visitor and agent messages appear in order, with any human-teammate messages marked.

## How to get to it (user POV)

- Choose `Conversations` in the dashboard sidebar.
- Choose `View all` on the overview's "Recent conversations" card.

## Driving it with cw-verify

Preconditions:

- Baseline from the index, signed in with `cw-verify dashboard login`.
- At least one conversation exists: run [widget-chat.md](./widget-chat.md) first.

- **List.** Run `cw-verify browser goto http://localhost:3000/dashboard/conversations`, then `cw-verify browser wait --text "Verify Chat Bot"`. The row for the widget chat is listed.
- **Open.** Click the row: `cw-verify browser click --text "Verify Chat Bot"`, then `cw-verify browser wait --url /dashboard/conversations/`. The transcript page loads.
- **Transcript.** Run `cw-verify browser text --text "What is two plus two"`. The visitor message from the widget-chat recipe appears, followed by the bot reply.
- **Proof.** Run `cw-verify browser screenshot --path .verify/artifacts/conversations/transcript.png` and `cw-verify browser snapshot --path .verify/artifacts/conversations/transcript.aria.txt`.

## Gotchas

- Not yet driven. The list uses the shared DataTable (`apps/web/components/ui/data-table/`), which has debounced search and page sizes 5, 10, 50 and 100. Wait for the row, not a fixed sleep.
- The URL segment is the public `sessionId`, which is a bearer credential for the widget. Do not paste it into reports or logs outside `.verify/`.
