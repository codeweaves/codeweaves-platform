# Sub-processor List

**Last updated:** [PLACEHOLDER — LAST_UPDATED_DATE]

> **DRAFT — verify before publication.** This list is generated from the verified integration
> inventory in the codebase (audit of 2026-07-24). Entries marked *(when enabled)* only receive
> data if the Client turns that feature/channel on. Before publishing: confirm each vendor's DPA
> is executed and links are current.

[PLACEHOLDER — COMPANY_LEGAL_NAME] ("Klivo") uses the following sub-processors to deliver the
service. Sub-processors receive only the data necessary for their function.

## AI response generation

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| OpenRouter | Primary LLM gateway — generates agent replies | Conversation messages and history needed for the reply | US |
| OpenAI *(when configured)* | Direct LLM provider | Conversation messages and history | US |
| Google (Gemini) *(when configured)* | Direct LLM provider | Conversation messages and history | US |
| Groq *(when configured)* | Direct LLM provider | Conversation messages and history | US |

## Voice (speech-to-text / text-to-speech)

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| Deepgram *(when voice enabled)* | Speech-to-text | Voice audio clips | US |
| Sarvam AI *(when voice enabled)* | Speech-to-text / text-to-speech | Voice audio clips, reply text | India |
| ElevenLabs *(when voice enabled)* | Text-to-speech (and STT fallback) | Reply text, voice audio clips | US |

## Platform infrastructure

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| Supabase | Managed PostgreSQL database and file storage | All service data (encrypted at rest at the infrastructure level; sensitive fields additionally app-encrypted) | [PLACEHOLDER — SUPABASE_REGION] |
| [PLACEHOLDER — HOSTING_PROVIDER, e.g. Render] | Application hosting | Data in transit through the application | [PLACEHOLDER — HOSTING_REGION] |
| Clerk | Authentication for Client dashboard users | Client-user name, email, authentication identifiers | US |
| Resend | Transactional email (e.g. team invitations) | Recipient email address, email subject | US |
| Sentry *(error monitoring)* | Application error reporting | Technical error context (scrubbed of credentials) | US/EU |

## Messaging channels

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| Meta Platforms (WhatsApp Business) *(when WhatsApp channel enabled)* | Message delivery on WhatsApp | Message content, End-User phone number | Global |

## Internal automation

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| n8n *(legacy/internal automation)* | Internal workflow automation | Message content routed through legacy workflows | [PLACEHOLDER — N8N_HOSTING: self-hosted or cloud region] |

## Changes to this list

We will update this page when sub-processors are added, replaced or removed. Clients with a DPA
in place will be notified of material changes [PLACEHOLDER — NOTICE_PERIOD, e.g. 30 days] in
advance where practicable.
