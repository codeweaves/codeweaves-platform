# ADR-0006: Agent verification skill

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Dhruv

## Context

Coding agents write most of our changes. Today the only proof a change works is lint, types, build and 134 API unit tests. Nothing drives the real dashboard or widget. No Playwright, Cypress or E2E spec exists. An agent can report "done" on a UI change that it never saw run.

We adopt the verification pattern from Lauren Tan's pstack (MIT): a project skill with a CLI that drives the real app, a Markdown feature map, and a proof bar. The agent attaches evidence (screenshots, ARIA snapshots, DB rows) to every UI change. pstack's `create-verification-skill` generates the skill; `maintain-verification-skill` keeps the map current.

Two facts shape the design:

- Sign-up is invitation-only, and the dashboard needs a Clerk session. An agent cannot register itself.
- The local database also holds data pulled from develop. A verification run needs a fixed tenant that it can rely on.

## The four questions

- **Blast radius:** dev tooling only. Nothing ships in `apps/*` runtime builds. If the skill is wrong, an agent gets bad evidence and a human notices in review.
- **One-way or two-way door:** two-way. Remove the skill, the seed and one devDependency.
- **Couples us to:** Playwright's CDP client, a local Chrome install, and a Clerk development-instance test user.
- **Cost of waiting:** every UI change until then ships unverified, and the later load and perf work has no driver to build on.

## Decision

- The skill lives at `.claude/skills/verify/`: `SKILL.md`, a CLI at `scripts/cw-verify.mjs`, and `features/*.md`.
- The CLI uses **`playwright-core`** (root devDependency) against the **system Chrome** (`channel: 'chrome'`). No bundled browser download.
- Chrome runs once per session with a CDP port. Each CLI call attaches, acts and detaches, so steps share one logged-in browser.
- Every CLI command prints JSON.
- `apps/api/prisma/seed-verify.ts` seeds fixed data:
  - Tenant `verify-sandbox` with agents `chat` (handover on), `voice`, `editor` (the only agent recipes may change; the seed resets it) and `failing` (its model does not exist, for the LLM-error path).
  - A second tenant `verify-other`, which sandbox users must never reach. It is used for isolation checks.
  - Three Clerk **development** users per machine: `owner` (org.owner), `teammate` (org.inbox_agent) and `superadmin` (platform.super_admin), as `verify-<role>-<hostname>+clerk_test@example.com`. There is one set per machine, because each seed sets random passwords and shared users would log the other machines out.
- The CLI is called through a shell wrapper, `.claude/skills/verify/cw-verify`. It disables Git Bash's rewriting of `/`-prefixed arguments.
- Named browser tabs (`--page visitor`, `--page teammate`) drive two-sided flows such as handover in one Chrome.
- The feature map is Markdown written by agents from live runs. It is not an executable test suite. Drift is caught by fixing the feature file in the same PR as a UI change, and by a weekly `/pstack:maintain-verification-skill` pass.
- The skill is committed so every machine gets it. `.gitignore` still keeps the rest of `.claude/` local.
- The seed refuses a non-local database (the `prisma.config.ts` guard) and any Clerk key that is not `sk_test_`.
- The password and run state live in `.verify/` at the repo root. That folder is gitignored, along with logs and proof artifacts.
- The agent signs in through the real sign-in form. We add no auth bypass to the API or the web app.
- Verification runs point Redis at the local Docker Redis, never Upstash.

## Options rejected

### `@playwright/test` with bundled browsers

**Good:** a full test runner, fixtures, trace viewer and built-in video. It is the standard for E2E suites.

**Rejected because:** we need an agent-driven CLI, not a spec suite. The bundled browsers add a large download per machine and per CI runner. `playwright-core` gives the same driver.

**Revisit if:** we add a CI E2E suite. The feature map then becomes its source.

### chrome-devtools MCP as the only driver

**Good:** already configured. It has strong trace, network and heap tools.

**Rejected because:** it failed to connect this session, and an MCP call is not a script a reviewer can rerun. We keep it for interactive perf diagnosis.

### `@clerk/testing` sign-in tokens

**Good:** sign-in with no password, plus a helper for bot protection.

**Rejected because:** it bypasses our custom sign-in form, which is a real user path worth proving. It also adds a dependency for something the form already does.

**Revisit if:** Clerk bot protection or device verification blocks form sign-in in dev.

### Executable flow files per feature (an E2E suite)

**Good:** a flow that fails when a button is renamed catches drift mechanically, with no agent tokens. It could run nightly and later in CI against fake providers.

**Rejected because:** it is a second, larger codebase to maintain beside the feature map, and it drifts too. pstack's model is an agent that reads the map and drives the app itself for the change at hand. Adding a suite now doubles the upkeep before we know which checks earn it.

**Revisit if:** the load-testing work adds provider fakes. A small nightly suite for the handful of critical journeys (widget chat, handover, sign-in) then becomes cheap to run in CI.

### Reuse the super admin or pulled develop data

**Good:** no seed to maintain.

**Rejected because:** the super admin is a real person's Clerk account, and pulled data changes with every `db:pull`. Proof needs a fixed, known tenant.

## Consequences

- Agents can prove UI changes with evidence. That is the base for the planned load and perf work.
- A Clerk dev test user exists in the development instance. Delete it there if the skill is removed.
- The feature map drifts as the UI changes. `/maintain-verification-skill` must run on a schedule, and that costs tokens.
- Local runs still call real LLM and voice providers at low volume. Provider fakes come with the load-test work.
- Verification needs Docker Desktop and Chrome on the machine.
