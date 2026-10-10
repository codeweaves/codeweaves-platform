# Provider cost research

How to calculate the cost of one provider call ourselves, from the usage each provider returns. This research is the basis for the price list and the formulas in [ADR-0012](../../adr/0012-usage-ledger-and-price-list.md) and the [usage cost plan](../../plans/usage-cost-and-ops-console-plan.md).

- **Retrieved:** 2026-10-10.
- **Sources:** every price and rule has its source URL beside it. Prices are public pay-as-you-go list prices, because every account was on a free trial at the time.
- **UNCONFIRMED:** anything not confirmed from a primary source is marked UNCONFIRMED. Check those items against a live call or an invoice before relying on them.

| File                         | Covers                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [llm.md](llm.md)             | OpenAI, Gemini, Sarvam, Anthropic (for later), and the retired Groq and Cerebras models. Prices, cache rules, usage fields, AI SDK pitfalls, reconciliation APIs |
| [voice.md](voice.md)         | Sarvam STT and TTS, Deepgram, ElevenLabs. Billing units, rounding, where to get the billable quantity, reconciliation APIs                                       |
| [messaging.md](messaging.md) | Meta WhatsApp (pass-through to the client), Resend, Clerk, Supabase and Upstash (platform overhead)                                                              |

Prices change. When one does, add a new effective-dated row to `provider_prices` with the source URL, and note the change here.
