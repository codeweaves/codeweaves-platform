# Sprint Change Proposal — Epic 13 chatTriggerUrl Correction

**Date:** 2026-03-23
**Project:** codeweaves-platform
**Scope:** Minor (direct adjustment, no rollback needed)
**Status:** Approved

---

## 1. Issue Summary

Epic 13 was designed around a flawed assumption that agents need two separate URLs: `webhookUrl` (legacy, non-streaming) and `chatTriggerUrl` (streaming). In reality, the existing `webhookUrl` stored in `AgentSecret` already holds the n8n Chat Trigger URL. There is only one URL, and it supports streaming natively.

This created:
- 2 unnecessary stories (13-1, 13-2) for a field and UI that already exist
- if/else branching logic, fallback modes, and "legacy" paths in 5 stories that don't need them

**Discovered:** Pre-implementation, during sprint planning review with Dhruv.

---

## 2. Impact Analysis

| Artifact | Impact |
|----------|--------|
| **architecture.md** | Updated — ADR-013, Sections 12.1, 12.1.1, 12.3, 13.2, 20.1.1, 20.1.2, 20.14 |
| **epics.md** | Updated — Epic 13 header, stories 13-1/13-2 cancelled, 13-3/13-4/13-5/13-7 ACs rewritten, phasing updated |
| **sprint-status.yaml** | Updated — 13-1/13-2 marked cancelled, phase comments updated |
| **13-3 story file** | Rewritten — single `streamFromWebhookUrl()`, no fallback |
| **13-4 story file** | Rewritten — no branching, replaces simulated streaming entirely |
| **13-5 story file** | Updated — removed `streamingMode` dual distinction |
| **13-6 story file** | No change needed — no chatTriggerUrl references |
| **13-7 story file** | Rewritten — uses webhookUrl, no legacy fallback |
| **PRD** | No impact |
| **UI/UX specs** | No impact |

---

## 3. Recommended Approach

**Direct Adjustment** — text edits to epics, stories, and architecture. No code rollback needed (no code was written yet).

- Effort: Low
- Risk: Low
- Timeline: Saves time by eliminating 2 stories

---

## 4. Changes Made

### 4.1 Stories Cancelled
- **13-1** (Agent Chat Trigger URL Schema & API) — redundant, webhookUrl already exists
- **13-2** (Dashboard Chat Trigger URL Input) — redundant, UI input already exists

### 4.2 Stories Rewritten
- **13-3**: Renamed to "n8n Streaming Provider". Single `streamFromWebhookUrl()` method. No fallback. Added abort signal and partial chunk buffering.
- **13-4**: No if/else branching. Streaming replaces simulated chunking entirely. Uses `getEffectiveWebhookUrl()`.
- **13-5**: Removed `streamingMode: real|simulated` distinction. Single metadata shape.
- **13-7**: Uses `getEffectiveWebhookUrl()` instead of `chatTriggerUrl`. No legacy fallback path.

### 4.3 Phasing Updated
**Before (3 phases):**
- Phase 1: 13-1, 13-2 (foundations)
- Phase 2: 13-3, 13-4, 13-5 (core streaming)
- Phase 3: 13-6, 13-7 (voice)

**After (2 phases):**
- Phase 1 (Text Streaming): 13-3 → 13-4 (+ 13-5 parallel with 13-4)
- Phase 2 (Voice Streaming): 13-6 → 13-7

---

## 5. Handoff

All changes executed by SM (Bob). Architecture updated by Architect (Winston).

**Next steps:** Dev agent (Amelia) can begin Story 13-3 immediately — it is the first story in Phase 1 with no blockers.
