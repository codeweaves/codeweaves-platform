# Manual Test Guide — PII Redaction (PR #157) + Speed/Memory (PR: context-memory-latency)

How to verify both features by hand, written for testing from the dashboard + widget with a look at the DB where needed.

## Before you start

1. Merge order: **#157 (PII) first, then the context-memory-latency PR** (it's stacked on top).
2. Run the new migrations against your DB (two new ones: `pii_tokens` table, `chat_sessions.summaryMessageCount` column):
   ```bash
   cd apps/api && bunx prisma migrate deploy
   ```
3. No new env vars needed — PII encryption reuses `AGENT_SECRET_KEY` (already set).

Handy SQL (Supabase SQL editor) used below:

```sql
-- Last few messages as stored (what the DB/persistence saw)
SELECT role, content, "createdAt" FROM chat_messages ORDER BY "createdAt" DESC LIMIT 10;

-- Last few traces (what the LLM + logs saw)
SELECT "userMessage", response, "createdAt" FROM chat_traces ORDER BY "createdAt" DESC LIMIT 5;

-- The PII vault
SELECT category, token, "createdAt" FROM pii_tokens ORDER BY "createdAt" DESC LIMIT 10;

-- Conversation memory
SELECT summary, "summaryMessageCount" FROM chat_sessions ORDER BY "lastMessageAt" DESC LIMIT 5;

-- Per-step timings for the latest turns (knowledge.load speed check)
SELECT s->>'step' AS step, s->>'durationMs' AS ms, t."createdAt"
FROM chat_traces t, jsonb_array_elements(t.steps::jsonb) s
ORDER BY t."createdAt" DESC LIMIT 20;
```

---

## Part 1 — PII: the always-on floor (no toggle needed, any agent)

Type each of these into the widget chat, then check `chat_messages` **and** `chat_traces`:

| You type | Expected stored/logged form |
|---|---|
| `my aadhaar number is 234123412346` | `[AADHAAR REDACTED]` (test number with a valid checksum) |
| `card 4111 1111 1111 1111` | `[CARD REDACTED ****1111]` |
| `my pan is ABCDE1234F` | `[PAN REDACTED]` |
| `passport Z1234567` | `[PASSPORT REDACTED]` (the word "passport" nearby is required) |
| `promo code Z1234567` | **NOT redacted** — correct! Without ID context it's just a code. Context-gating prevents mangling order numbers etc. |
| `मेरा आधार २३४१२३४१२३४६ है` | `[AADHAAR REDACTED]` — works in Hindi/Devanagari digits |
| `random 12 digits 123456789012` | **NOT redacted as Aadhaar** (fails checksum) — correct |

Also check: the AI's reply never contains the original number, and `pii_tokens` stays **empty** for these (hard-dropped values are never stored anywhere, not even encrypted).

## Part 2 — PII: the toggle (reversible tokenization)

Setup: agent editor → **AI settings → Advanced → "PII protection" ON**. Save.

1. In the widget, type: `my account number is 123456789012` (the word *account* matters — that's the context gate).
2. Check the three views of the same message:
   - **`chat_traces.userMessage`** → `my account number is [BANK_ACCOUNT_1]` ← what the LLM and logs saw
   - **`chat_messages.content`** → real number ← what the DB stores
   - **Dashboard Conversations / Inbox** → real number ← what your team sees
   - **`pii_tokens`** → one row, `category = BANK_ACCOUNT`, value encrypted (not readable in SQL)
3. Same again with `my dob is 12/08/1994` → `[DOB_1]` in traces.
4. Ask the bot: *"can you repeat my account number back to me?"* — the visitor should see the **real** number in the reply (the model answers with the placeholder; we swap it back mid-stream). The `chat_traces.response` row keeps the placeholder.
5. **Handover check:** escalate to a human (`talk to a human`), take over from the Inbox — the human agent sees real values in the thread.
6. Flip the toggle OFF, send another account number → no tokenization (but Part 1's floor still applies).

## Part 3 — Speed (the ~200ms cache fix)

1. Open a widget chat and send **3-4 messages in a row** (within a minute).
2. Run the per-step timing SQL above and look at `knowledge.load`:
   - **First message** (cold): whatever Upstash costs — typically 100-400ms.
   - **Every following message**: **0-2ms**. That's the L1 cache absorbing the network hop.
3. Edit the agent (e.g. change the system prompt) and send a message — the change applies immediately on the pod that handled the save; other pods within 45s.

## Part 4 — Memory (long conversations)

Fastest way to see it without a 25-message chat: agent editor → AI settings → Advanced → set **"Past messages to remember" to 4**. Save.

1. Start a fresh widget conversation. First message: `hi, my name is Dhruv and my budget is 50,000 rupees`.
2. Chat 4-5 more exchanges about anything else (features, pricing, support...).
3. Now ask: `what was my name and budget again?`
   - **Expected:** the bot answers correctly — even though that info scrolled out of the 4-message window, the background summary carried it.
   - Check `chat_sessions.summary` — you'll see a short factual summary; `summaryMessageCount` matches the message count.
4. Timing note (expected behavior, not a bug): the summary is rebuilt **in the background after** each reply. So the very first message that overflows the window may not have the summary yet; from the next message on, it does.
5. Reply speed should be unchanged throughout — the summary work never runs during a reply.

Remember to set "Past messages to remember" back to 20 after testing.

## Part 5 — Nothing broke

- Normal chat on an agent with all defaults: replies stream fine, citations/steps unaffected.
- WhatsApp (if connected): send a message with a test card number → reply arrives, stored message shows `[CARD REDACTED ****1111]`.
- Voice: speak a normal query → works as before (transcripts go through the same pipeline).
