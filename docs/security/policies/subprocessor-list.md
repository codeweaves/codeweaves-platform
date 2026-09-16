# Sub-processor List

**Applies to:** Klivo [PLACEHOLDER - REGISTERED_LEGAL_NAME once the firm is registered]
**Last updated:** 2026-09-02
**Classification:** May be shared with clients and assessors.

> Draft for founder approval. Remove this note before sharing externally.

---

## What this list is

A sub-processor is a company that handles personal data on Klivo's behalf so the service can
work. Each one receives only the data its function needs. Klivo does not sell data, and no
sub-processor uses client or end-user data for its own purposes or to train models.

Entries marked *(when enabled)* receive data only if the client switches that feature or
channel on.

## Platform infrastructure

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| Managed PostgreSQL and object storage provider | The production database and storage for uploaded files | All service data. Sensitive fields carry a second layer of application encryption. | Mumbai, India |
| Cloudflare | Edge protection in front of the application programming interface: TLS termination, denial-of-service mitigation and a web application firewall | Data in transit through the application | Global edge network |
| Google Cloud | Hosting for the backend application | Data in transit through the application | Mumbai, India |
| Vercel | Hosting for the dashboard and the widget | Data in transit through the front end | Mumbai, India |
| Upstash | Managed cache for rate-limit counters | Short-lived counters keyed to a device or network address. No durable personal data. | Managed service |
| Clerk | Authentication for client dashboard users | Client-user name, email address, authentication identifiers | United States |
| Resend | Transactional email, such as team invitations | Recipient email address and subject | United States |
| Sentry | Application error reporting | Technical error context, scrubbed of credentials | United States and EU |

The specific vendor behind the managed database and storage is provided on request.

## AI reply generation

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| OpenRouter | Primary model gateway that generates agent replies | The conversation content needed for a reply, with sensitive identifiers already removed or tokenised | United States |
| OpenAI *(when configured)* | Direct model provider | As above | United States |
| Google, Gemini *(when configured)* | Direct model provider | As above | United States |
| Groq *(when configured)* | Direct model provider | As above | United States |

## Voice

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| Sarvam AI *(when voice enabled)* | Speech to text and text to speech | Voice audio, reply text | India |
| Deepgram *(when voice enabled)* | Speech to text | Voice audio | United States |
| ElevenLabs *(when voice enabled)* | Text to speech | Reply text, voice audio | United States |

## Messaging channels

| Sub-processor | Purpose | Data received | Location |
|---|---|---|---|
| Meta Platforms, WhatsApp Business *(when WhatsApp enabled)* | Message delivery on WhatsApp | Message content, end-user phone number | Global |

## Not sub-processors

GitHub holds Klivo's source code and documentation. It receives no client or end-user
personal data.

## Changes to this list

Klivo updates this page when a sub-processor is added, replaced or removed. Clients with a
Data Processing Agreement in place are notified of a material change **30 days** in advance
where practicable. No new sub-processor receives data until due diligence and a Data
Processing Agreement are complete.
