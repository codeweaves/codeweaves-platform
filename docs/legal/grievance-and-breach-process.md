# Grievance Redressal & Data-Breach Response Process

**Internal document + public-facing grievance section.**
**Last updated:** [PLACEHOLDER — LAST_UPDATED_DATE]

> **DRAFT — review with legal counsel.** DPDP Act, 2023 requires a published grievance mechanism
> and breach notification to affected Data Principals and the Data Protection Board of India
> ("DPB") per the DPDP Rules, 2025.

## Part A — Grievance redressal (public)

**Contact:** [PLACEHOLDER — GRIEVANCE_EMAIL]
**Postal:** [PLACEHOLDER — REGISTERED_ADDRESS]

| Step | Action | Target time |
|---|---|---|
| 1 | Acknowledge receipt of the grievance | [PLACEHOLDER — e.g. 72 hours] |
| 2 | Verify the requester's identity (and, for End Users, identify the relevant Client) | 5 business days |
| 3 | Resolve: fulfil access/correction/erasure request, or explain refusal with reasons | [PLACEHOLDER — e.g. 15 days] |
| 4 | If unresolved, the Data Principal may escalate to the **Data Protection Board of India** | — |

**Fulfilment mechanics (internal):**
- **Access request** → generate the per-visitor data summary (S3 endpoint) and deliver it.
- **Correction** → update the relevant collected-data fields at the Client's confirmation.
- **Erasure** → run the erasure engine (S2) for the visitor (or org); record a minimal
  "erased subject X on date Y" audit entry as proof of fulfilment; confirm completion to the
  requester. Target: ≤ 30 days from verified request.
- Requests arriving from End Users of a Client deployment are forwarded to that Client
  (the Data Fiduciary) with our assistance offer, unless the Client has instructed us to fulfil
  directly.

## Part B — Data-breach response (internal runbook)

**Definition:** any unauthorised access, disclosure, alteration, loss or destruction of personal
data (e.g. compromised credentials, exposed database, malicious insider, vulnerable dependency
exploited).

### Phase 1 — Contain (immediately, target < 24h)
1. Triage severity; identify affected tables/orgs/subjects (use `event_logs` / `audit_logs`).
2. Contain: revoke credentials/keys, patch, isolate affected components.
3. Preserve evidence: snapshot relevant logs before any cleanup.
4. Open an incident record: timeline, scope, actions ([PLACEHOLDER — INCIDENT_TRACKER]).

### Phase 2 — Assess (target < 48h)
5. Determine categories of personal data and number of Data Principals affected.
6. Determine which Clients (Fiduciaries) are affected.

### Phase 3 — Notify
7. **Clients (per DPA):** without undue delay, within [PLACEHOLDER — BREACH_NOTICE, e.g. 48h] of
   awareness — scope, data categories, actions taken, recommended steps.
8. **Data Protection Board of India + affected Data Principals:** as and when required by the
   DPDP Rules, 2025 — description of the breach, likely consequences, mitigation, and safeguards
   Data Principals can take. [PLACEHOLDER — confirm current DPB filing mechanism with counsel.]

### Phase 4 — Remediate & review (target < 2 weeks)
9. Root-cause analysis; permanent fix; add regression tests/monitoring.
10. Post-incident review: update this runbook and security controls.

**Breach response owner:** [PLACEHOLDER — RESPONSE_OWNER_NAME/ROLE]
**Deputy:** [PLACEHOLDER — DEPUTY_NAME/ROLE]
