# ADR-0020: Lead page URL

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Dhruv

## Context

Clients want to know which page of their website a lead came from (for example `/pricing` or a campaign landing page). Today we store nothing about the page.

Two facts shape the design:

- Lead values are not saved when the visitor types them. `DataExtractionService` runs about 60 seconds after the last message, reads the whole transcript, and writes one `collected_data` row per conversation. By then we do not know which page the visitor was on when they gave their details.
- The widget runs in the client's page (Shadow DOM, not an iframe), so `window.location` in the widget is the client's page. The client does not have to add anything.

A page address can carry private data in its query string or fragment (emails, tokens, password-reset links). We must not store that.

## The four questions

- **Blast radius:** small. If the page is wrong, one column in Collected Data shows the wrong page. Chat replies and lead capture are not affected; a bad `pageUrl` in a request is dropped, not rejected.
- **One-way or two-way door:** two-way. Three nullable or defaulted columns. Turning the switch off stops new writes; dropping the columns removes the data.
- **Couples us to:** nothing external. It adds one field to the public chat and voice request bodies.
- **Cost of waiting:** clients cannot attribute leads to pages or campaigns.

## Decision

1. **Per-agent switch.** `agents.capturePageUrl`, default off. It lives in the editor's Data Capture section, and changing it needs `AgentDataField:Update`, the same permission as editing the data fields.
2. **The widget sends the page only when the switch is on.** The public widget config carries `agent.capturePageUrl`. When it is true, text (`/chat/send`, `/chat/stream`) and voice (`/voice/conversation`) requests carry `pageUrl`, read from `window.location.href` at send time, so single-page-app navigation is handled. When it is false, the page never leaves the browser. The config ETag hashes the whole payload, so a switch change reaches the widget on its next load, and a page load starts a new conversation anyway.
3. **One cleaning function, run in the browser and again on the server.** We keep the origin, the path and the five `utm_*` campaign tags. We drop every other query parameter, the `#fragment` and any `user:pass@`. Only `http`/`https` is accepted. The cleaned result is capped at 2048 characters. The function is `sanitizePageUrl` in `packages/validation/src/page-url.ts`. The widget imports it through the zod-free `@repo/validation/page-url` entry, and the API through `@repo/validation`. A malformed or oversized value becomes "no page"; it never fails the message.
4. **The server also gates.** A request can come from anything, not only our widget, so the API stores the page only when the switch is on and the chat is a website widget chat, and cleans it again. Storage code takes the `CleanPageUrl` type, so a raw request value cannot reach the database.
5. **Per message.** Each visitor message stores its page in `chat_messages.pageUrl`, on every path that saves a visitor message (bot reply, streaming, voice, human handover).
6. **Lead page.** One page per lead: the page where the visitor gave their **first** detail. When the extractor captures values, `findLeadPageUrl` picks the page of the first visitor message that contains a captured value. Text values match as whole words, ignoring case. Number values (5+ digits) match on digits only, so spaces and dashes typed inside a phone number do not matter. Matching uses the tokenised values, because the stored messages hold the same PII tokens. If no message matches, it uses the visitor's latest page, marked as a guess. The result goes in `collected_data.pageUrl`. A match always wins: it is the earliest message holding a value, so it stays put as the chat grows, and it replaces an earlier guess. A guess only fills an empty slot, so a resumed chat never moves a stored page to wherever the visitor went later.
7. **Display.** Collected Data shows a "Page" column (the path, with the full address on hover) and the CSV export has a "Page URL" column. Both show while the switch is on, and after it is turned off if stored rows still have a page.
8. **Retention.** Both columns are deleted with their conversation through the existing cascades, so erasure and the retention sweep cover them.

## Options rejected

### One page per captured field

**Good:** exact: the name's page, the email's page and the phone's page each recorded.

**Rejected because:** Collected Data has one row per conversation; a page beside every field doubles the table and CSV width for little gain. The first page answers the real question (which page made them start sharing).

### The page of the last detail

**Good:** like a form's "submitted on" page.

**Rejected because:** the page that got the visitor to start sharing is the more useful one for marketing.

### Store one page per conversation on `chat_sessions`

**Good:** one column, one write per session, no matching logic.

**Rejected because:** a visitor often moves between pages in one conversation. The landing page or the last page is not the page where they gave their details.

### Ask the extraction model which message held the lead

**Good:** handles cases string matching misses, such as a value the model reworded.

**Rejected because:** it changes the extraction prompt and output shape for every agent, adds tokens to every extraction, and the answer is a model guess. String matching on the same tokenised text is exact in the common case and free.

**Revisit if:** clients report wrong pages often enough to matter.

### Keep the full URL, or drop the whole query string

**Good:** the full URL loses nothing; dropping the whole query string is the simplest safe rule.

**Rejected because:** the full URL can store emails and tokens that sites put in query strings. Dropping everything loses the `utm_*` tags, which are the main reason clients want the page (which ad brought the lead).

### Widget always sends the page; only the server gates

**Good:** the widget needs no new config field.

**Rejected because:** the page would leave the browser even for businesses that turned the switch off. Data we do not need should not be sent at all.

### A separate copy of the cleaning rules in the widget

**Good:** the widget needs no dependency on the shared package.

**Rejected because:** two copies drift. A tag added on one side would be silently dropped by the other. The shared entry has no dependencies, so the widget bundle does not grow by more than the function itself.

## Consequences

- Clients can see the page and campaign of each lead in the dashboard and CSV.
- One extra nullable column write per visitor message; no extra query on the chat path. The extractor already loads the messages, so finding the page adds no query.
- If a visitor types a value in a different form than the model returns (for example a spelled-out number), the lead page falls back to their latest page. That is close but not always exact.
- WhatsApp conversations have no page; the column shows `-`.
- The page path itself is stored as sent. A site that puts personal data in the path (not the query) would have that stored. This is rare and the value is shown only to the agent's own organization.
- `@repo/validation` now has a second entry, `@repo/validation/page-url`, with a `typesVersions` map so the API's older module resolution finds its types. Anything added to that file must stay free of dependencies, or the widget bundle grows.
