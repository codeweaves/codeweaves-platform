# Story 4.17: Public Agent Demo Page

Status: done

## Story

As a **stakeholder or client**,
I want a shareable demo page to test an agent's chat interface,
so that I can preview the conversation experience without authentication.

## Acceptance Criteria

1. **AC1:** Public demo page at `/agents/demo/[agentId]` (no auth required)
2. **AC2:** Agent name, avatar initial, and online status in header
3. **AC3:** Welcome message shown as first bot message
4. **AC4:** Conversation starters from theme config displayed as clickable chip buttons
5. **AC5:** Clicking a starter sends it as a user message and triggers a simulated bot response
6. **AC6:** Users can type and send custom messages via input field
7. **AC7:** Typing indicator animation (bouncing dots) shown while bot is "responding"
8. **AC8:** "Agent not found" error page for inactive or non-existent agents
9. **AC9:** Backend `GET /public/agents/:id/demo` endpoint with `@Public()` decorator
10. **AC10:** Starters hidden after first message is sent
11. **AC11:** "Powered by CodeWeaves" footer

## Tasks / Subtasks

- [x] **Task 1: Backend Public Endpoint** (AC: 9)
  - [x] 1.1 Add `getDemoInfo(id)` to `AgentsService` — fetches active agent + theme (no user context)
  - [x] 1.2 Create `PublicAgentsController` at `public/agents` with `@Public()` decorator
  - [x] 1.3 Register in `AgentsModule`
  - [x] 1.4 Write unit tests (6 tests)

- [x] **Task 2: Demo Page Server Component** (AC: 1)
  - [x] 2.1 Create `apps/web/app/agents/demo/[agentId]/page.tsx` server component
  - [x] 2.2 Pass `agentId` param to client component

- [x] **Task 3: Demo Page Client Component** (AC: 2-8, 10, 11)
  - [x] 3.1 Fetch agent info via `fetch(apiUrl('/public/agents/:id/demo'))`
  - [x] 3.2 Loading state with spinner
  - [x] 3.3 Error state with Bot icon and "Go to homepage" link
  - [x] 3.4 Header with back arrow, avatar initial, name, online indicator
  - [x] 3.5 Welcome message as first bot bubble
  - [x] 3.6 Conversation starters as rounded chip buttons
  - [x] 3.7 Message bubbles (user: blue right-aligned, bot: white left-aligned)
  - [x] 3.8 Typing indicator with 3 bouncing dots
  - [x] 3.9 Input form with send button
  - [x] 3.10 Simulated bot response (1.2s delay) — webhook integration to be added later

## Dev Notes

- Uses plain `fetch` + `apiUrl()` instead of `useApiClient()` since the page has no auth context
- `crypto.randomUUID()` for message IDs
- Auto-scroll via `useEffect` watching `messages` and `isTyping`
- Starters hidden via `startersVisible` state set to `false` on first `sendMessage` call

## Branch & PR

- Branch: `feature/agent-editor-enhancements`
- PR: #42, #43
