# Dashboard shell

The authenticated frame around every dashboard page: a sidebar filtered by the user's permissions, a header with the page title, a notifications bell and an account menu.

## Sub-features

- `shell-nav`: sidebar links, each shown only when the user holds its permission.
- `shell-collapse`: the `Toggle Sidebar` button, or Ctrl/Cmd+B, collapses the sidebar to icons.
- `shell-account-menu`: the `Account menu` button shows name, email and role label, with `Profile Settings` and `Log Out`.
- `shell-notifications`: the `Notifications` bell opens the panel, marks items seen and deep-links to the inbox.
- `shell-inbox-badge`: the Inbox link shows the count of chats waiting for a human.

## How to get to it (user POV)

- Sign in. The shell is on every `/dashboard/*` page.

## Driving it with cw-verify

Preconditions:

- Baseline from the index.

- **Nav per role.** For each role, run `cw-verify dashboard login --as <role>`, `browser settle`, then `browser snapshot --path .verify/artifacts/dashboard-shell/sidebar-<role>.aria.txt`. The sidebar links must be exactly:
  - `owner`: Dashboard, Agents, Conversations, Inbox, Collected Data, Analytics
  - `teammate`: Dashboard, Agents, Conversations, Inbox
  - `superadmin`: Dashboard, Organizations, Agents, Conversations, Inbox, Collected Data, Analytics, Team, Users, Utilities
- **Account menu.** Run `browser click --role button --name "Account menu"`. The snapshot shows `menu "Account menu"` with `menuitem "Profile Settings"` and `menuitem "Log Out"`. Close it with `browser press --key Escape`.
- **Notifications.** Run `browser click --role button --name "Notifications"`. The panel shows the text `Notifications` and a `Mute notification sound` button. With no handovers, it shows "Nothing yet. You'll be notified here when a visitor asks for a human." A handover request (see [multi-surface-journeys.md](./multi-surface-journeys.md)) makes the bell's name `Notifications: 1 new`.
- **Collapse.** Run `browser click --css "header [data-slot=sidebar-trigger]"`. This is the header `Toggle Sidebar` button; see Gotchas for why not by name. Read the state with `browser eval --js "document.querySelector('[data-collapsible]')?.closest('[data-state]')?.getAttribute('data-state')"`. It goes from `expanded` to `collapsed`. Then `browser press --key Control+b` returns it to `expanded`.
- **Proof.** Save the three sidebar snapshots and a screenshot of each role's shell.

## Gotchas

- Hiding a nav item is UX only. The API still enforces each permission. Typing a hidden URL gives a redirect or 403s. Isolation checks are in [multi-surface-journeys.md](./multi-surface-journeys.md).
- Two buttons share the name `Toggle Sidebar`. The second is the rail (tabIndex -1). Click the first one in the header.
- Collapse does not survive a reload. The `sidebar_state` cookie is written but never read.
- The Inbox link's accessible name includes the count (for example `Inbox 3`). Match it with `--text Inbox`, not an exact name.
- The org owner has no Team, Users or Utilities. Those are super-admin only since migration `20260810010000`.
