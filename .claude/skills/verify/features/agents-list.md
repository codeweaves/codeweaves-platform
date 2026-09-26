# Agents list, create and delete

The Agents page lists the org's agents in a searchable, filterable table. Platform users create agents from it. Users with `Agent:Delete` soft-delete them, which takes the widget offline.

## Sub-features

- `agents-list`: DataTable with Name (link), Organization, Status, Created and Actions columns, page sizes 5/10/50/100.
- `agents-search`: `Search agents...` filters by name.
- `agents-filter-status`: the `Status` multi-select (Active, Inactive).
- `agent-create`: `Create New Agent` dialog. Platform roles only (`Agent:Create`).
- `agent-delete`: row trash icon, then an alertdialog asking the user to type `DELETE`.
- `agent-row-actions`: row icons Edit, Embed, Demo, Delete.

## How to get to it (user POV)

- Sidebar `Agents` (`/dashboard/agents`).
- Overview page: `Manage all` on "Your agents".

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Never delete a seeded agent. Create `Verify Temp Agent` first and delete only that.

- **List.** As `owner`, run `browser goto http://localhost:3000/dashboard/agents`, then `browser settle`. The snapshot shows `textbox "Search agents..."`, `button "Status"`, and links for the four seeded Verify agents. There is no `Create New Agent` button for the owner.
- **Search.** Run `browser fill --role textbox --name "Search agents..." --value "Editor"`, then `browser settle --quiet 900`. `browser text --css "tbody tr"` returns one row, "Verify Editor Bot".
- **Create (superadmin).**
  1. Run `dashboard login --as superadmin`, then `browser click --role button --name "Create New Agent"`, and wait for `--role dialog --name "Create Agent"`.
  2. Fill `--label "Agent Name"` with `Verify Temp Agent`. Click `--css "#agent-org"`, then `--role option --name "Verify Sandbox" --exact`, then `--role button --name "Create" --exact`.
  3. Expect toast "Agent created successfully" and a URL under `/dashboard/agents/<id>`.
  4. Cross-check: `db query "select a.status, o.slug from agents a join organizations o on o.id = a.\"organizationId\" where a.name = 'Verify Temp Agent' and a.\"deletedAt\" is null"` returns ACTIVE in `verify-sandbox`, and `audit_logs` has a new `AGENT_CREATED`.
- **Delete denied (teammate).** As `teammate`, click the row trash: `browser click --css 'tbody tr:has-text("Verify Temp Agent") >> button >> nth=3'`. Fill `--css 'input[placeholder="Type DELETE to confirm"]' --value DELETE`, then click `--role button --name "Delete" --exact`. Expect toast "Failed to delete agent", a `DELETE /agents/<id>` response of 403 in `browser events --type response`, and the agent still present.
- **Delete (superadmin).** Same steps. The dialog is `alertdialog "Delete Agent"`. Expect toast `Agent "Verify Temp Agent" deleted successfully`. The row has `deletedAt` set, and `GET /api/klivo/v1/public/agents/<publicId>/config` returns 404.
- **Proof.** Save screenshots under `.verify/artifacts/agents-list/`, `agent-create/` and `agent-delete/`.

## Gotchas

- The trash icon shows for every role. A role without `Agent:Delete` gets a 403 and a toast (open finding F-05). The server is correct.
- The row action icons have no accessible name (open finding F-06). Target them by row and position, as above.
- The org owner cannot create agents. `Agent:Create` is platform-only, yet the overview's `New agent` tile still shows.
- Delete is soft and has no undelete in the UI. The widget stops loading at once.
- The seed upserts agents by name. Renaming a seeded agent makes the next `seed` create a duplicate.
