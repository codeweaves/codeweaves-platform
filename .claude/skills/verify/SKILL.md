---
name: verify
description: Drive the local Codeweaves stack (Klivo dashboard at localhost:3000, embeddable chat widget, NestJS API) the way a user does and capture proof. Use after any change to apps/web, apps/widget or a user-facing apps/api route, before saying a UI or chat change works, and when asked to verify, reproduce, or show a feature running.
---

# Verify Codeweaves

One CLI drives everything and prints JSON: `.claude/skills/verify/cw-verify`. It is a small shell wrapper around `scripts/cw-verify.mjs`. Below it is written `cw-verify`. Run `cw-verify --help` for every command.

Always call the wrapper from Git Bash, macOS or Linux. Git Bash rewrites any argument that starts with `/`, so `--url /dashboard` would arrive as a Windows path, and the wrapper turns that off. From PowerShell, `node .claude/skills/verify/scripts/cw-verify.mjs` is fine.

Read [features/README.md](features/README.md) before driving anything. Each feature file is the recipe for that feature.

## New machine

Do this once per machine. The skill comes with the repo, and the rest is local.

1. Install Docker Desktop, Google Chrome and bun. Then run `bun install` at the repo root. `playwright-core` is a root devDependency and drives the installed Chrome.
2. Set up `apps/api/.env`:
   - `DATABASE_URL` pointing at `localhost:5433`
   - a Clerk **development** `CLERK_SECRET_KEY` (`sk_test_...`)
   - `OPENAI_API_KEY` for the seeded agents' `gpt-4.1-mini`
   - voice provider keys for voice recipes
3. Run `bun db:setup`.
4. Run `cw-verify seed`. It creates the two tenants (four sandbox agents, one other-org agent) and this machine's three Clerk test users (`verify-<role>-<hostname>+clerk_test@example.com`). Machines never share users, because each seed sets its own passwords.

## Launch

```bash
cw-verify stack up          # Docker Postgres+Redis, API :3001, web :3000, widget :5173, host page :5180
cw-verify stack up --prod   # instead: builds web + widget, runs next start, host page serves the built bundle
cw-verify seed              # once per database, and after any mutation
cw-verify browser open      # Chrome with CDP on :9333; add --headed to watch
```

- **Which mode.** Use dev (the default) to drive features while code changes; it hot-reloads. Use `--prod` for performance numbers; the builds take about 3 minutes. The mode is recorded in `.verify/mode.json`. Stop one mode with `stack down` before starting the other.

- **Ready signal.** `stack up` returns only after each service answers HTTP 200. A cold start takes about 2 minutes, a warm start about 20 s. Services start without a shell, because on Windows a detached shell drops their logs. Logs are in `.verify/logs/*.log`.
- **Refusals.** `stack up` refuses when the database the API would use (an exported `DATABASE_URL` wins over `apps/api/.env`) is not `localhost:5433`. It pins that URL into the API process. It also refuses a port served by a process this run did not start, unless you pass `--reuse`.
- **One run per machine.** Two instances cannot run side by side: the ports (3000, 3001, 5173, 5180, 9333), the Docker database and the Chrome profile are fixed. A second agent must wait, or drive the running instance through the same `.verify/` state. Never start a second stack.
- **Redis.** The API runs with `REDIS_URL=redis://localhost:6379`, never Upstash.
- **LLM and voice.** Real providers, at low volume.
- **Voice fixture.** Add `.verify/fixtures/voice.wav` before `browser open` for voice recipes. Chrome reads it at launch and plays it once as the microphone.

## Doctor

Run `cw-verify doctor` before the first drive, after anything surprising, and after editing API code (`nest --watch` restarts the API, and it is unreachable for a while). It is read-only. Drive only when `healthy` is `true`. It checks:

- the database target is `localhost:5433` and the container is healthy
- the stack mode (`dev` or `prod`)
- API `/health` returns 200 and `/health/ready` reports db and Redis ok
- web, host page and browser each return 200, plus the Vite widget server in dev mode
- each service is owned by this run: pid alive and command line matching (`owner: this-run`)
- the seed state and the credentials exist

The API reports `commit: "unknown"` locally, so doctor cannot catch a stale build by commit. Check `.verify/logs/api.log` for "Found 0 errors" after an API edit.

## Drive

- **Widget.**
  - `cw-verify widget open --agent chat|voice|editor|failing|<publicId>`
  - `widget send --text "..."` returns `outcome` (`replied`, `alert`, `no-reply` or `timeout`), plus `firstTokenMs`, `replyMs` and the messages. Anything but `replied` exits non-zero. `no-reply` is the right result while a human holds the chat.
  - `widget consent` accepts the privacy notice.
  - `widget messages` lists messages by role.
  - `widget wait-message --from human --new` waits for a message that was not on screen before.
- **Dashboard.** `cw-verify dashboard login --as owner|teammate|superadmin`, then `browser goto http://localhost:3000/dashboard/...`.
- **Generic.**
  - `browser click|fill|wait|text --role <role> --name "<accessible name>"`. Use `--label`, `--text` or `--css` only when no role fits.
  - `browser upload --css "input[type=file]" --file <path>` for file pickers.
  - `browser settle` waits until the DOM stops changing.
- **Two sides at once.** Every browser, widget and dashboard command takes `--page <name>`. Use `--page visitor` and `--page teammate` for handover. Tab names survive across calls.
- **Handles.** Prefer ARIA role plus name. Where the app gives a control no name, each feature file shows the fallback handle.
- **eval.** `browser eval` reads state after the user path ran. Never drive the app through it.

## Evidence

Put artifacts under `.verify/artifacts/<feature-id>/`. That folder is gitignored and survives cleanup.

- **UI proof.** `browser screenshot --path ...` plus `browser snapshot --path ....aria.txt`. Capture the action and the resulting state.
- **Side effects.** Use `cw-verify db query "<SELECT>"`. It allows one statement, and Postgres enforces read-only, so a writing function fails.
- **Network and errors.** `browser events --type response|pageerror|requestfailed|console|websocket --since <ISO>`. API calls are always recorded. Other resources are recorded when they return 400 or above. `requestfailed` entries with `net::ERR_ABORTED` right after a `widget open` or `goto` come from the navigation itself.
- **Performance.** Measure on `stack up --prod` and compare against [features/performance.md](features/performance.md). Each command runs several samples and reports median and p90:
  - `perf widget-load`, `perf widget-reply`, `perf widget-leak` and `perf page-load --url <path> --wait-text "<text>"`
  - `browser trace --url <url> --path <file>` records a Chrome trace to find the cause of a slow number
  - `browser metrics` and `browser heap --path ...` for one-off memory readings
  - `browser events --type timing` has the full latency of every API call
- **Proof standard.**
  - Drive the real user path.
  - Verify side effects alongside what is visible.
  - A reply or setting the user never sees is not a pass, even when the API returned 2xx.
  - Name every entry point you skipped, and why.
  - Before claiming isolation or absence, make sure the other side has data. An empty tenant proves nothing.
- **Report product bugs.** Record the exact outcome and evidence. Never patch around a product bug in the harness or the docs.

## Cleanup

```bash
cw-verify stack down --dry-run   # show what would stop
cw-verify stack down             # stops only recorded pids whose command line still matches
```

- Cleanup never kills by process name, never touches Docker volumes, and never deletes `.verify/artifacts/`.
- `browser close` stops only Chrome.
- Restore mutated data: in the editor for the `editor` agent, `Reset to Defaults` (theme). Then `cw-verify seed` resets its agent fields and knowledge, and each user's password.

## Helpers

- `cw-verify`: the wrapper to call.
- `scripts/cw-verify.mjs`: the entry point, which dispatches to `scripts/lib/`:
  - `core`: paths, output
  - `proc`: processes, the database guard
  - `stack`: services, doctor, seed, SQL, host page
  - `browser`: Chrome daemon, named tabs, actions
  - `widget`: the embeddable widget
  - `dashboard`: sign-in by role
  - `perf`: repeated measurements with median and p90, saved to `.verify/artifacts/perf/`
- `apps/api/prisma/seed-verify.ts`: the seed. `cw-verify seed` runs it. It refuses a non-local database and a non-`sk_test_` Clerk key.
- Run state lives in `.verify/`:
  - `state.json`: ids
  - `credentials.json`: passwords
  - `pids.json`, `pages.json` and `mode.json`
  - `logs/`
  - `fixtures/`
  - `findings.md`: local run notes
- Keep this skill honest with `/pstack:maintain-verification-skill` weekly, and fix the matching feature file in the same PR as any UI change.
