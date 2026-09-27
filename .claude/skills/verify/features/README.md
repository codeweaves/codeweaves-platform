# Codeweaves verification map

Behavior-level inventory of the Klivo dashboard and the embeddable chat widget. Agents use this map to decide what to drive and what evidence counts. Humans use it as the regression checklist.

## Baseline preconditions

- `cw-verify stack up`, `cw-verify seed` and `cw-verify browser open` have run, and `cw-verify doctor` reports `healthy: true`. Run `doctor` again after anything surprising, and always after editing API code: `nest --watch` restarts the API and it is briefly unreachable.
- Call the CLI as `.claude/skills/verify/cw-verify`. Git Bash rewrites any argument that starts with `/`, and the wrapper turns that off.
- **Tenant `verify-sandbox`** (org name "Verify Sandbox") has four agents, and **tenant `verify-other`** ("Verify Other Org") has one. `.verify/state.json` holds their ids and publicIds:
  - `chat`: text chat, handover button on
  - `voice`: voice on
  - `editor`: the only agent recipes may change; `seed` resets its agent fields
  - `failing`: its model does not exist, for the LLM-error path
  - `otherOrg.agent` (in `verify-other`): sandbox users must never reach it
- **Users, one set per machine**, as `verify-<role>-<hostname>+clerk_test@example.com`:
  - `owner`: org.owner
  - `teammate`: org.inbox_agent
  - `superadmin`: platform.super_admin
- `cw-verify dashboard login --as <role>` signs in through the real form and checks the identity.
- The widget runs on the host page `http://localhost:5180/?agent=<publicId>`.
- Two-sided flows use named tabs: `--page visitor` for the widget, `--page teammate` for the dashboard.

## Driving conventions

- Prefer ARIA role plus accessible name. The widget is in an open shadow root, and role locators pierce it.
- Where a control still has no accessible name, target it by row and position, by placeholder, or by an adjacent label, as each file shows. Never by a styling class. When you meet an unnamed control, fixing the app (a linked label or an `aria-label`) beats adding another workaround here.
- Wait on observable end states (`browser wait`, `browser settle`, `widget wait-message --new`), never fixed sleeps.
- `browser eval` only reads state after the user path ran. It never drives the app.
- Restore after every mutation: `Reset to Defaults` for the editor agent's theme, then `cw-verify seed`.

## Proof and skip reporting

- For a change, the matching feature file defines the coverage set. Cover every entry point it lists, plus the success, error, empty and persistence paths the change touches.
- Capture the action and the end state: a screenshot and an ARIA snapshot under `.verify/artifacts/<feature-id>/`.
- Prove side effects with a second view: a `db query` row, the widget showing a dashboard change, or the dashboard showing a widget chat.
- A path you could not reach is named, with the blocker (account, external service, native input) and the closest real path covered.
- When the product misbehaves, record it with evidence. Do not patch around it in the harness or the docs.

## Full sweep

Walk this map top to bottom for a broad regression, then finish with `multi-surface-journeys.md`.

## Account and shell

| File                                    | Covers                                                           | Status            |
| --------------------------------------- | ---------------------------------------------------------------- | ----------------- |
| [sign-in](sign-in.md)                   | Gate and redirect, sign in with return, sign out, password reset | Proven 2026-09-27 |
| [dashboard-shell](dashboard-shell.md)   | Sidebar per role, collapse, account menu, notifications          | Proven 2026-09-27 |
| [profile-settings](profile-settings.md) | Change name, persistence, read-only fields                       | Proven 2026-09-27 |

## Widget

| File                                | Covers                                                                                      | Status            |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------- |
| [widget-chat](widget-chat.md)       | Open, send, streamed reply, persistence, LLM-error alert, rate limit, new session on reload | Proven 2026-09-27 |
| [widget-voice](widget-voice.md)     | Record, send, transcript, spoken reply, latency metrics                                     | Proven 2026-09-27 |
| [widget-consent](widget-consent.md) | Consent lock, grant, Chat options menu, opt out, consent records                            | Proven 2026-09-27 |

## Agents

| File                                              | Covers                                                                                                            | Status                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [agents-list](agents-list.md)                     | List, search, create (superadmin), delete denied (teammate), delete                                               | Proven 2026-09-27                                                                  |
| [agent-editor](agent-editor.md)                   | Nav per role, save, reset to defaults, status switch, theme vs agent fields                                       | Proven 2026-09-27                                                                  |
| [agent-editor-sections](agent-editor-sections.md) | Behavior, Chat Interface, Privacy Notice, Human Handover, Prompt and knowledge, Classification, Appearance, Voice | Proven 2026-09-27. Data Capture, Branding, Integration and WhatsApp not yet driven |

## Conversations and handover

| File                                        | Covers                                                       | Status                                                                  |
| ------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [inbox](inbox.md)                           | Live request, take over, reply, resolve, records             | Proven 2026-09-27                                                       |
| [conversations](conversations.md)           | List, search, transcript                                     | Mapped from source, not yet driven                                      |
| [dashboard-overview](dashboard-overview.md) | KPIs, attention, agents, recent conversations, per-role view | Sign-in and overview proven 2026-09-26; teammate view proven 2026-09-27 |

## Performance

| File                          | Covers                                                                                                                         | Status              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| [performance](performance.md) | Baselines for widget load, reply latency, widget memory, dashboard and inbox load, API latency, bundle size; how to re-measure | Baseline 2026-09-28 |

## Not yet mapped

These features exist and were read from source. They still need a live drive and a file:

- Analytics page and export
- Collected Data
- Organizations, Users, Team (invitations) and Email templates (super admin)

## Multi-surface journeys

- [multi-surface-journeys](multi-surface-journeys.md): handover end to end, widget chat in the dashboard, editor changes reaching the widget, knowledge in replies, role gates, and tenant isolation. All proven 2026-09-27.

## Entry contract

Each feature file has an H1, one paragraph of user-visible behavior, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with cw-verify` (starts with `Preconditions:`), and `Gotchas`.
