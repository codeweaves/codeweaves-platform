#!/usr/bin/env node
// cw-verify: drive the local Codeweaves stack the way a user does.
// Usage: .claude/skills/verify/SKILL.md, or `--help`.
// Every command prints one JSON object on stdout and exits non-zero on failure.
//
// Modules (scripts/lib): core (paths, output), proc (processes, DB guard),
// stack (services, doctor, seed, SQL, host page), browser (Chrome, named tabs,
// generic actions), widget (the embeddable widget), dashboard (sign-in by role).

import { CliError, fail, need, out, parseArgs } from './lib/core.mjs';
import { browserAction, browserClose, browserOpen, connect, runBrowserDaemon, withPage } from './lib/browser.mjs';
import { ROLES, loginAs } from './lib/dashboard.mjs';
import { dbQuery, doctor, runHost, seed, stackDown, stackUp } from './lib/stack.mjs';
import { closeWidget, grantConsent, openWidget, readMessages, sendMessage, waitForMessage } from './lib/widget.mjs';
import { pageLoad, widgetLeak, widgetLoad, widgetReply } from './lib/perf.mjs';

const HELP = `cw-verify <group> <command> [--flags]   (all output is JSON)

stack up [--prod] [--only api,web,widget,host] [--reuse]   start Docker, API :3001, web :3000, widget :5173, host page :5180
                                                  --prod builds web + widget and serves the built output (use for perf)
stack down [--dry-run]                            stop only what this run started (pid + command line checked)
doctor                                            is this instance worth driving?
seed                                              idempotent tenants, agents and per-machine Clerk test users
db query "<SELECT ...>"                           read-only SQL (Postgres-enforced) against local Postgres

browser open [--headed] | close | pages
browser goto <url>
browser click|fill|wait|text  --role R --name N | --label L | --text T | --css C  [--value V] [--secret] [--gone] [--url /path] [--timeout ms]
browser press --key Enter
browser upload --css "input[type=file]" --file P   set files on a file input (the user's file picker path)
browser settle [--quiet ms]      wait until the DOM stops changing (streams, tables, charts)
browser snapshot [--path P]      ARIA snapshot (pierces the widget's open shadow root)
browser screenshot --path P [--full]
browser eval --js "<expr>"       inspect state only, never drive through it
browser events [--type console|pageerror|requestfailed|response|websocket] [--since ISO] [--limit N]
browser metrics                  JS heap, DOM nodes, listeners, layout and script time
browser heap --path P            GC then heap snapshot

widget open [--agent chat|voice|editor|<publicId>]   host page, launcher, dialog
widget consent                   accept the privacy notice when consent mode is on
widget send --text T [--timeout ms]   send; outcome replied | alert | no-reply | timeout
widget messages                  [{from: visitor|agent|human, text}]
widget wait-message --from agent|human|visitor [--contains T] [--new] [--timeout ms]   --new ignores messages already shown
widget close

dashboard login [--as ${ROLES.join('|')}]   real sign-in form, identity checked

browser trace --path P [--url U | --seconds N]   Chrome performance trace (open in DevTools > Performance)
perf page-load --url /dashboard [--as owner] [--runs 5] [--wait-text "Verify Chat Bot"]   content-ready time (use a text that needs data), vitals, API latency and counts
perf widget-load [--agent chat] [--runs 5]       launcher visible, open time, bundle and config fetch
perf widget-reply [--agent chat] [--runs 7]      time to first word and full reply (max 9: rate limit)
perf widget-leak [--agent chat] [--cycles 20]    heap, DOM nodes and listeners after GC, before vs after
Results are saved to .verify/artifacts/perf/. Measure with stack up --prod.

Every browser, widget and dashboard command takes --page <name> (default "main").
Two-sided flows use separate tabs, for example --page visitor and --page teammate.
`;

async function widgetCommand(cmd, flags) {
  const name = flags.page ? String(flags.page) : 'main';
  const timeout = Number(flags.timeout ?? 60000);
  switch (cmd) {
    case 'open':
      return withPage(name, (page) => openWidget(page, flags.agent ? String(flags.agent) : 'chat'));
    case 'consent':
      return withPage(name, (page) => grantConsent(page));
    case 'send':
      return withPage(name, async (page) => {
        const result = await sendMessage(page, String(need(flags, 'text', 'widget send --text "What can you do?"')), { timeout });
        if (result.outcome !== 'replied') {
          throw new CliError(`widget send ended with ${result.outcome}`, 'check: browser events --type response, and apps/api/logs/ai-trace.*.log', result);
        }
        return result;
      });
    case 'messages':
      return withPage(name, async (page) => ({ messages: await readMessages(page) }));
    case 'wait-message':
      return withPage(name, (page) =>
        waitForMessage(page, {
          from: flags.from ? String(flags.from) : undefined,
          contains: flags.contains ? String(flags.contains) : undefined,
          onlyNew: Boolean(flags.new),
          timeout: Number(flags.timeout ?? 15000),
        }),
      );
    case 'close':
      return withPage(name, (page) => closeWidget(page));
    default:
      throw new CliError(`unknown widget command ${cmd}`, 'see --help');
  }
}

async function run(group, cmd, positional, flags) {
  switch (group) {
    case 'doctor':
      return doctor();
    case 'seed':
      return seed();
    case 'stack':
      if (cmd === 'up') {
        return stackUp({
          only: flags.only ? String(flags.only).split(',') : undefined,
          reuse: Boolean(flags.reuse),
          prod: Boolean(flags.prod),
        });
      }
      if (cmd === 'down') return stackDown({ dryRun: Boolean(flags['dry-run']) });
      break;
    case 'db':
      if (cmd === 'query') {
        const rows = dbQuery(positional[0] ?? need(flags, 'sql', 'db query "select 1"'));
        return { count: rows.length, rows };
      }
      break;
    case 'browser':
      if (cmd === 'open') return browserOpen({ headed: Boolean(flags.headed) });
      if (cmd === 'close') return browserClose();
      return browserAction(cmd, flags, positional);
    case 'widget':
      return widgetCommand(cmd, flags);
    case 'perf': {
      const runs = flags.runs ? Number(flags.runs) : undefined;
      const agent = flags.agent ? String(flags.agent) : undefined;
      if (cmd === 'page-load') {
        return pageLoad({
          url: flags.url ? String(flags.url) : undefined,
          role: flags.as ? String(flags.as) : undefined,
          runs,
          waitText: flags['wait-text'] ? String(flags['wait-text']) : undefined,
        });
      }
      if (cmd === 'widget-load') return widgetLoad({ agent, runs });
      if (cmd === 'widget-reply') return widgetReply({ agent, runs });
      if (cmd === 'widget-leak') return widgetLeak({ agent, cycles: flags.cycles ? Number(flags.cycles) : undefined });
      break;
    }
    case 'dashboard':
      if (cmd === 'login') {
        const session = await connect();
        try {
          const page = await session.page(flags.page ? String(flags.page) : 'main');
          return await loginAs(page, session.context, flags.as ? String(flags.as) : 'owner');
        } finally {
          await session.close();
        }
      }
      break;
    default:
      break;
  }
  throw new CliError(`unknown command: ${group} ${cmd ?? ''}`.trim(), 'run with --help');
}

async function main() {
  const [group, cmd, ...rest] = process.argv.slice(2);
  // Internal long-lived processes started by `stack up` and `browser open`.
  if (group === '__host') return runHost({ prod: process.argv.includes('--prod') });
  if (group === '__browser') return runBrowserDaemon({ headed: process.argv.includes('--headed') });
  const { positional, flags } = parseArgs(rest);
  if (!group || group === '--help' || flags.help) return process.stdout.write(HELP);
  const result = await run(group, cmd, positional, flags);
  out({ command: [group, cmd].filter(Boolean).join(' '), ...result });
}

main().catch((err) => fail(err instanceof CliError ? err : new CliError(err.message)));
