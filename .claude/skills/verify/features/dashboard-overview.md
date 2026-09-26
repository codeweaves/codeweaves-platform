# Dashboard sign-in and overview

A teammate signs in with email and password and lands on the overview. It shows KPIs for the chosen period, conversations needing attention, the org's agents, handover health and recent conversations.

## Sub-features

- `signin-password`: the custom email and password form signs in and redirects to `/dashboard`.
- `overview-kpis`: Conversations, Leads captured, Handover rate and Avg response, with 7D, 30D and 90D ranges.
- `overview-attention`: "Needs your attention" lists conversations waiting for a human, or "All clear."
- `overview-agents`: one card per agent with live status, a conversation count (only with `Analytics:Read`), and a "New agent" tile (only with `Agent:Create`, which is platform-only).
- `overview-by-role`: panels built on analytics (KPI row, Handover health, agent counts, the `Analytics` link) render only for users with `Analytics:Read`. Other users get no analytics calls at all.
- `overview-recent`: the latest conversations, each with agent, channel and message count.

## How to get to it (user POV)

- Open `http://localhost:3000/sign-in` and fill in `Email` and `Password`.
- After sign-in, choose `Dashboard` in the sidebar.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. For non-zero KPIs, run [widget-chat.md](./widget-chat.md) once first.

- **Sign in.** Run `cw-verify dashboard login`. Expect `status: "signed-in"` and `url` ending in `/dashboard`. If Clerk asks for an email code, the command enters `424242`, which Clerk dev accepts for `+clerk_test` addresses. It then reports `usedEmailCode: true`.
- **Overview loaded.** Run `cw-verify browser wait --role heading --name "Welcome back, Verify"`. The heading appears.
- **Agents.** Run `cw-verify browser text --text "Verify Chat Bot"`. Expect at least one match. The "Your agents" cards list "Verify Chat Bot" and "Verify Voice Bot" as Live.
- **Range switch.** Run `cw-verify browser click --role button --name "7D"`. The KPI values refresh for 7 days.
- **No errors.** Run `cw-verify browser events --type pageerror` (expect a count of 0), and check `--type response` for no 4xx or 5xx from `:3001`.
- **View per role.** For each role, run `dashboard login --as <role>`, `browser goto http://localhost:3000/dashboard`, wait for `heading "Your agents"`, then `browser settle --quiet 1500` and snapshot. Count the `/analytics/` calls in `browser events --type response --since <ISO before goto>`:

  | Role         | `/analytics/` calls | KPI row | Handover health | Agent counts | `Analytics` link | `New agent` |
  | ------------ | ------------------- | ------- | --------------- | ------------ | ---------------- | ----------- |
  | `teammate`   | none                | hidden  | hidden          | hidden       | hidden           | hidden      |
  | `owner`      | all 200             | shown   | shown           | shown        | shown            | hidden      |
  | `superadmin` | all 200             | shown   | shown           | shown        | shown            | shown       |

  Any 403 from `/analytics/` on this page, or "0 conversations" for a teammate, is a regression of F-01 to F-03 (fixed 2026-09-27).

- **Proof.** Run `cw-verify browser screenshot --path .verify/artifacts/dashboard-overview/overview.png` and `cw-verify browser snapshot --path .verify/artifacts/dashboard-overview/overview.aria.txt`.

## Gotchas

- The first `/sign-in` load compiles the Next.js route in dev mode, which can take 30 to 60 s. `dashboard login` waits up to 90 s.
- Sign-up is invitation-only. Never try to register a new user. Use the seeded one.
- `dashboard login` always starts signed out. It first leaves the app for `about:blank`, then clears cookies and site storage. An open dashboard tab re-creates Clerk's session from its in-memory dev-browser token, so a plain cookie clear is not enough. The command then fails unless Clerk reports the seeded email.
- **Not a bug: narrow screens scroll sideways by design.** Dashboard content has a 1080 px minimum width (`min-w-270` in `apps/web/components/layout/dashboard-shell.tsx`) and scrolls sideways inside the content area. At a 1280 px viewport the sidebar leaves 1016 px, so a screenshot clips the right 64 px. Use a viewport of at least 1340 px when a screenshot must show the full width.
- KPIs count every conversation in the org, including failed turns.
- Permission gating is client-side UX. The API still enforces `Analytics:Read` and `Agent:Create`. The page reads permissions from `usePermissions()` and keeps skeletons while they load, so the owner's view does not jump.
- The analytics hooks (`use-analytics.ts`) honor `enabled: false`. Before the F-01 fix, three of them ignored it and always fetched.
- With zero handovers, the Handover health ring shows 100% contained, not "no data".
