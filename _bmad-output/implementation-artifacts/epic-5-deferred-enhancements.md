# Epic 5: Deferred Enhancements

Enhancements identified during Epic 5 implementation that are deferred to a future sprint.

## 1. Mobile Device Preview in Theme Editor

**Source:** Story 5-8 (Expanded Chat Window State)
**Date:** 2026-03-25

**Description:** Add a desktop/mobile viewport toggle to the agent theme editor's live preview panel, so users can see how the widget looks on mobile devices (fullscreen mode) without leaving the dashboard.

**Implementation Notes:**
- Add a desktop/mobile toggle button to the preview toolbar
- Wrap the preview iframe in a phone-sized container (~375x667px) when mobile mode is active
- Show the fullscreen chat behavior within the simulated mobile viewport
- Could be a new story under Epic 4 (Theme Editor) or Epic 5 (Widget)

## 2. Session TTL Expiration (Time-Based Session Reset)

**Source:** Story 5-18 (Chat Input API Integration)
**Date:** 2026-03-27

**Description:** Currently sessions persist indefinitely within a tab. If a visitor keeps a tab open for hours/days, the same session is reused forever. Need time-based session expiry (e.g., 6 hours) so stale sessions auto-reset.

**Current State:**
- Tab close: Handled (sessionStorage is tab-scoped, cleared by browser)
- Time-based expiry: NOT implemented — no TTL check on widget or backend

**Implementation Notes:**
- **Widget side:** Store a timestamp alongside sessionId in sessionStorage. On each `getSessionId()` call, check if age exceeds TTL (e.g., 6h). If expired, clear session and let backend create a new one.
- **Backend side (optional):** Add a check in `resolveOrCreateSession()` that compares `createdAt` or `lastMessageAt` against a TTL threshold. Return 410 if expired, triggering widget-side cleanup via `handleSessionError()`.
- Consider making TTL configurable per-agent (some use cases may want longer/shorter sessions)
- No cron job needed — lazy expiry on next message send is sufficient
