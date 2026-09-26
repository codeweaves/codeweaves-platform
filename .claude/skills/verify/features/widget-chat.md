# Widget text chat

A visitor opens the chat widget on a website, sends a message, and sees the agent's reply stream in. The turn is stored and appears in the dashboard. Failures and rate limits show a short-lived alert.

## Sub-features

- `chat-open`: the launcher (`Open chat widget`) opens `dialog "<header title> chat"` with the greeting. `Close chat` or Escape closes it.
- `chat-send`: Enter or `Send message` adds the visitor's message at once. The input is disabled while the reply streams.
- `chat-reply`: the agent's reply streams into `article "AI agent message"`, then the input re-enables.
- `chat-persist`: USER and ASSISTANT rows in `chat_messages`, and the conversation on the dashboard.
- `chat-llm-error`: a failed LLM call shows an alert for 5 s.
- `chat-rate-limit`: over 10 messages a minute per device shows an alert. Page-load warmup counts as one.
- `chat-new-session`: a reload starts a new session with only the greeting. A session is restored on reload only while a handover is active in the same tab.

## How to get to it (user POV)

- Click the round launcher on any page that embeds the widget. Type in the input and press Enter or `Send message`.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Use the `chat` agent (no consent mode). Use `failing` for the error path.

- **Open.** Run `widget open --agent chat --page visitor`. Expect `dialog: "Verify Chat Bot chat"`, `consentRequired: false`, and one `agent` message "Hi, I am the Verify Chat Bot."
- **Send and reply.** Run `widget send --page visitor --text "What is two plus two? Answer in one short sentence."`. Expect `outcome: "replied"`, a non-empty `reply`, and `firstTokenMs` of about 1200 to 2000 on gpt-4.1-mini.
- **Persistence.** Run `db query "select m.role, m.content from chat_messages m join chat_sessions s on s.id = m.\"chatSessionId\" where s.\"agentId\" = '<agents.chat.id>' order by m.\"createdAt\" desc limit 2"`. Expect ASSISTANT then USER, with the same texts.
- **Second view.** Run `dashboard login --as owner`. The overview's "Recent conversations" lists "Verify Chat Bot" with the message count.
- **LLM error.** Run `widget open --agent failing --page visitor`, then `widget send --page visitor --text "Hello"`. Expect `outcome: "alert"` and the alert "The assistant is temporarily unavailable. Please try again." Take the screenshot at once: the alert clears after 5 s.
- **Rate limit.** Send short messages in a loop to the `chat` agent. The 10th send in a minute returns `outcome: "alert"` with "You're sending messages too quickly. Please wait a moment." The input stays enabled and keeps its normal placeholder.
- **New session on reload.** After a chat, run `widget open --agent chat` again. `widget messages` shows only the greeting.
- **Proof.** Save screenshots and an ARIA snapshot under `.verify/artifacts/widget-chat/`: the reply, the LLM-error alert and the rate-limit alert.

## Gotchas

- Messages are `article`s inside `log "Conversation"`, labelled "Your message", "AI agent message" or "Team member message". Use `widget messages`, which reads them by role.
- Every error arrives as an SSE event over HTTP 201. Judge the result from `outcome` and the alert, not from the status code.
- The rate limit blocks this device for a minute. Run the rate-limit step last, or wait a minute before further sends.
- `firstTokenMs` measures from the click to the first rendered reply text. It includes the network and UI, not only the model.
- Closing the widget while a reply streams can leave the input disabled until a reload (source report; not yet reproduced).
