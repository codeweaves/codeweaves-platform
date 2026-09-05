# Privacy Policy

**Effective date:** [PLACEHOLDER — EFFECTIVE_DATE]
**Last updated:** [PLACEHOLDER — LAST_UPDATED_DATE]

> **DRAFT — requires legal review before publication.** Placeholders marked `[PLACEHOLDER — …]`
> must be filled with company specifics. This draft is aligned to India's Digital Personal Data
> Protection Act, 2023 ("DPDP Act") and the DPDP Rules, 2025.

## 1. Who we are

This Privacy Policy is issued by **[PLACEHOLDER — COMPANY_LEGAL_NAME]** ("Klivo", "we", "us"),
a company registered at **[PLACEHOLDER — REGISTERED_ADDRESS]**. Klivo provides an AI-powered
customer-conversation platform: businesses ("Clients") deploy AI chat and voice agents on their
websites and messaging channels (such as WhatsApp) to talk with their visitors and customers
("End Users").

Depending on who you are, our role differs:

- **If you are an End User** chatting with an AI agent on a Client's website or WhatsApp: the
  Client decides what data is collected and why (they are the **data fiduciary** under the DPDP
  Act); Klivo processes that data on the Client's behalf (as a **data processor**).
- **If you are a Client user** (a business team member with a Klivo dashboard account): Klivo is
  the data fiduciary for your account data.

## 2. What personal data we process

### 2.1 End Users (people chatting with an agent)
- **Conversation content** — the messages you type or speak to the agent, and the agent's replies.
  Voice messages are transcribed to text; the transcription is stored (audio is not retained as a
  stored recording).
- **Contact and lead details you choose to provide** — such as name, email address, phone number,
  and any custom fields the Client's agent asks for. These are stored **encrypted at rest**.
- **Technical identifiers** — a random device identifier stored in your browser; a **hashed**
  (non-reversible) form of your IP address used to distinguish visitors; on WhatsApp, your phone
  number as provided by the platform.
- **Operational records** — timestamps, channel (website widget / WhatsApp / voice), language,
  and technical logs of requests needed to run and secure the service.

### 2.2 Client users (dashboard accounts)
- Name, email address, authentication identifiers (via our authentication provider), role and
  organization membership, and an audit trail of administrative actions (e.g. sign-ins,
  invitations, configuration changes).

## 3. Why we process it (purposes)

- To operate the conversation service: generate AI responses, hand conversations over to human
  agents when needed, and keep conversation history available to the Client.
- To capture the lead/contact details an End User chooses to share with the Client.
- To secure the platform: fraud/abuse prevention, authentication, tenant isolation, audit trails.
- To operate, debug and improve reliability (time-limited technical logs and AI traces).
- To provide Clients with aggregated analytics about their agents (message volumes, response
  times, language distribution). Aggregated analytics do not identify End Users.

## 4. Consent and notice

Where processing is based on consent, notice is provided at or before the point of collection in
clear, plain language. You may withdraw consent at any time by contacting the Client you
interacted with, or us at the contact in Section 10; withdrawal does not affect processing already
lawfully performed.

## 5. Who we share data with (processors / sub-processors)

We do not sell personal data. We share it only with service providers needed to run the platform,
under contracts that restrict their use of the data. The current list is maintained in our
**Sub-processor List** (see `subprocessor-list.md` / [PLACEHOLDER — PUBLIC_SUBPROCESSOR_URL]).
Categories include: AI model providers (to generate responses), speech-to-text / text-to-speech
providers (for voice), cloud hosting and database providers, authentication, email delivery, and
messaging platforms (Meta/WhatsApp) where the Client has enabled that channel.

## 6. How long we keep data (retention)

| Data | Retention |
|---|---|
| Conversation content & collected lead details | Retained while the Client's account is active; deleted on verified erasure request (completed within 30 days) or on Client offboarding |
| AI debugging traces | 90 days, then automatically deleted |
| Operational/event logs | 12 months, then automatically deleted |
| Security & administrative audit logs | At least 12 months (accountability and legal defence) |

Retention windows are enforced by automated deletion jobs.

## 7. Your rights (DPDP Act)

You have the right to:
- **Access** — request a summary of the personal data we hold about you and how it is processed.
- **Correction** — ask that inaccurate or incomplete data be corrected or updated.
- **Erasure** — ask that your personal data be deleted. We honour verified requests within
  30 days, except where retention is required by law.
- **Grievance redressal** — raise a complaint using the contact in Section 10, and escalate to
  the **Data Protection Board of India** if unsatisfied with our response.
- **Nominate** — nominate another individual to exercise your rights in case of death or
  incapacity.

If you interacted with a Client's agent, we may redirect your request to that Client (the data
fiduciary) and will assist them in fulfilling it.

## 8. Security

We apply reasonable security safeguards appropriate to the data, including: encryption of
sensitive stored data (collected contact details, credentials and access tokens are encrypted at
rest with AES-256-GCM), one-way hashing of IP addresses, TLS encryption in transit,
organization-level tenant isolation and role-based access control, and security audit logging.

## 9. Data breaches

In the event of a personal data breach, we will notify affected individuals and the Data
Protection Board of India as required by the DPDP Act and its Rules, per our internal breach
response procedure.

## 10. Contact / Grievance Officer

- **Grievance contact:** [PLACEHOLDER — GRIEVANCE_EMAIL]
- **Postal address:** [PLACEHOLDER — REGISTERED_ADDRESS]
- We acknowledge grievances within [PLACEHOLDER — ACK_SLA, e.g. 72 hours] and aim to resolve them
  within [PLACEHOLDER — RESOLVE_SLA, e.g. 15 days].

## 11. Children

The service is not directed at children. Clients are responsible for ensuring their deployments
do not target users below 18 years of age without verifiable parental consent as required by the
DPDP Act.

## 12. Changes to this policy

We will post updates to this page and revise the "Last updated" date. Material changes will be
notified to Clients.
