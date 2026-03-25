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
