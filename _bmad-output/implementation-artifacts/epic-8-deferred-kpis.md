# Epic 8: Deferred KPIs & Future Features

> Documented: 2026-03-03
> Context: During Epic 8 story refinement, these KPIs were deferred because they require infrastructure or features not yet built.

## Deferred KPIs

### 1. Languages Used (FR88)

- **Original requirement:** Track and display language distribution across configured languages
- **Why deferred:** Requires language detection capability — not just for voice (Epic 10), but also for text messages (English, Hindi, Marathi, Hinglish, etc.)
- **Depends on:** Language detection implementation (to be scoped separately or with Epic 10)
- **Action:** Revisit when language detection is built. Should work for both text chat and voice.

### 2. Most Popular Topics / AI Categorization (FR89)

- **Original requirement:** Analyze and display categorized conversation themes
- **Why deferred:** Requires AI-powered topic categorization of conversations. This is a significant feature — needs LLM calls to classify conversations into topics, storage of categorizations, and aggregation.
- **Depends on:** New feature epic (not yet created)
- **Action:** Create a separate feature epic for "AI Conversation Categorization" that includes topic extraction, storage, and analytics integration. This is not a simple KPI — it's a full feature.

### 3. Unresolved Queries (FR93)

- **Original requirement:** Track failed/unhandled queries percentage
- **Why deferred:** Effectively the same concept as Fallback Rate. A query is "unresolved" when the bot cannot answer and falls back to a default response.
- **Action:** Merged with Fallback Rate below. No separate KPI needed.

### 4. Fallback Rate (FR94)

- **Original requirement:** Track percentage of fallback responses triggered
- **Why deferred:** Requires multiple changes across the stack:
  1. **Agent Editor:** Add a "Fallback response phrase" input field per bot (e.g., "Sorry, I don't have any idea about this, please contact the sales team")
  2. **n8n Integration:** Pass the fallback phrase into the n8n agent's system prompt so the AI uses it when it can't answer
  3. **Response Tracking:** Detect when the bot response contains/matches the configured fallback phrase
  4. **Analytics:** Track fallback occurrences per bot and calculate rate (fallback responses / total responses)
- **Depends on:** Agent editor changes (new field), n8n workflow structure changes, response matching logic
- **Action:** Create a dedicated feature story/epic: "Fallback Detection & Tracking" that spans agent config, n8n integration, and analytics.

### 5. User Satisfaction Score (FR — Story 8.12)

- **Original requirement:** Average user satisfaction rating (1-5 scale)
- **Why deferred:** Requires satisfaction rating events from Epic 9 (Event Tracking). No rating mechanism exists yet.
- **Depends on:** Epic 9 (rating_submitted event), or a simpler thumbs-up/down mechanism on the chat UI
- **Action:** Revisit when a rating/feedback mechanism is implemented.

### 6. Conversation Completion Rate (FR — Story 8.11)

- **Original requirement:** % of conversations that complete successfully
- **Why deferred:** Definition of "completed" relies on satisfaction ratings (Epic 9) OR a minimum exchange threshold. The rating-based approach needs Epic 9. The exchange-based approach (>3 messages = completed) could work but is a weak proxy.
- **Action:** Can be partially implemented with exchange-based heuristic, but full implementation needs satisfaction ratings.

## Role-Based Analytics Access

Confirmed access model for analytics:

| Role | Org Membership | Analytics Scope |
|------|---------------|-----------------|
| Super Admin / Admin | Not part of any org | Platform-wide — all orgs, all bots. Can filter by org and bot. |
| Client (Owner/Member) | Belongs to an org | Their org only — can filter by their org's bots |

## Seed Data Strategy

- Create a seed script that populates realistic dummy data across multiple orgs and bots
- Use `source: 'WIDGET'` for seeded data to simulate real widget interactions
- Vary data patterns: different volumes, response times, activity hours per bot
- This enables a fully functional analytics dashboard for client demos
