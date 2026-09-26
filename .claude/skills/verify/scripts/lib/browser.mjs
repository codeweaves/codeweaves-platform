// Chrome lifecycle, named tabs, and generic browser actions.
//
// One long-lived daemon owns Chrome (CDP on :9333) and records console and
// network events to JSONL. Every other call attaches, acts and detaches, so
// steps share one browser, one profile and one signed-in session.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CDP_PORT,
  CliError,
  ENTRY,
  EVENTS_FILE,
  LOG_DIR,
  PAGES_FILE,
  REPO,
  RUN_DIR,
  URLS,
  VOICE_FIXTURE,
  artifactPath,
  need,
  readJson,
  writeJson,
} from './core.mjs';
import { forgetPid, httpStatus, killTree, pids, startDetached, waitFor } from './proc.mjs';

// Event logs are printed by `browser events`, so no credential may reach them:
// Clerk's dev-browser token and other token-like query values, and the widget's
// public session id, which is a bearer credential in the poll path.
const SECRET_PARAM = /jwt|token|secret|session|key|code|password/i;
export function redactUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAM.test(name)) url.searchParams.set(name, 'REDACTED');
  }
  url.pathname = url.pathname.replace(/\/public\/chat\/[^/]+\/poll/, '/public/chat/REDACTED/poll');
  return url.toString();
}

// URLs inside free text (console messages, errors) get the same treatment.
function redactText(text) {
  return String(text).replace(/(?:https?|wss?):\/\/[^\s"')]+/g, (u) => redactUrl(u));
}

async function chromium() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    throw new CliError('playwright-core is not installed', 'run: bun install (it is a root devDependency)');
  }
}

export async function browserOpen({ headed = false } = {}) {
  if ((await httpStatus(`${URLS.cdp}/json/version`)) === 200) return { status: 'already-open', cdp: CDP_PORT };
  startDetached('browser', process.execPath, [ENTRY, '__browser', ...(headed ? ['--headed'] : [])], { cwd: REPO }, 'cw-verify');
  await waitFor(async () => (await httpStatus(`${URLS.cdp}/json/version`)) === 200, 60_000, 'browser');
  writeJson(PAGES_FILE, {});
  return { status: 'started', cdp: CDP_PORT, events: EVENTS_FILE };
}

export function browserClose() {
  const killed = killTree(pids().browser);
  forgetPid('browser');
  writeJson(PAGES_FILE, {});
  return { killed };
}

export async function runBrowserDaemon({ headed = false } = {}) {
  const pw = await chromium();
  mkdirSync(LOG_DIR, { recursive: true });
  const context = await pw.launchPersistentContext(join(RUN_DIR, 'chrome-profile'), {
    channel: 'chrome',
    headless: !headed,
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
    args: [
      `--remote-debugging-port=${CDP_PORT}`,
      // Two-sided flows keep one tab in the background (the visitor while the
      // teammate works). Its timers and sockets must keep running.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // Voice: a fake microphone. With .verify/fixtures/voice.wav present, Chrome
      // plays that file as mic input; without it the fake device sends a beep.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      // %noloop: play the clip once. Chrome loops it by default, which doubles the
      // transcript whenever a recording runs longer than the clip.
      ...(existsSync(VOICE_FIXTURE) ? [`--use-file-for-fake-audio-capture=${VOICE_FIXTURE}%noloop`] : []),
    ],
  });
  const record = (type, data) =>
    appendFileSync(EVENTS_FILE, `${JSON.stringify({ t: new Date().toISOString(), type, ...data })}\n`);
  const watch = (page) => {
    page.on('console', (m) => record('console', { level: m.type(), text: redactText(m.text()), url: redactUrl(page.url()) }));
    page.on('pageerror', (e) => record('pageerror', { text: redactText(e.message), url: redactUrl(page.url()) }));
    page.on('requestfailed', (r) => record('requestfailed', { method: r.method(), url: redactUrl(r.url()), failure: r.failure()?.errorText }));
    page.on('websocket', (ws) => {
      record('websocket', { event: 'open', url: redactUrl(ws.url()) });
      ws.on('close', () => record('websocket', { event: 'close', url: redactUrl(ws.url()) }));
    });
    page.on('response', (r) => {
      const req = r.request();
      // API traffic always; any other resource only when it failed, so a 4xx on
      // a script, image or socket poll can never hide from the proof.
      const tracked = ['fetch', 'xhr', 'eventsource', 'document'].includes(req.resourceType());
      if (!tracked && r.status() < 400) return;
      const timing = req.timing();
      record('response', {
        method: req.method(),
        url: redactUrl(r.url()),
        status: r.status(),
        resourceType: req.resourceType(),
        ms: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : null,
      });
    });
  };
  context.pages().forEach(watch);
  context.on('page', watch);
  context.on('close', () => process.exit(0));
}

async function targetId(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    return (await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Attach to the daemon's Chrome. `page(name)` returns the tab recorded under that
// name, creating it on first use. Names survive across CLI calls via pages.json.
export async function connect() {
  const pw = await chromium();
  let browser;
  try {
    browser = await pw.connectOverCDP(URLS.cdp);
  } catch {
    throw new CliError('browser is not open', 'run: cw-verify browser open');
  }
  const context = browser.contexts()[0];
  return {
    context,
    async page(name = 'main') {
      const known = readJson(PAGES_FILE, {});
      if (known[name]) {
        for (const p of context.pages()) {
          if ((await targetId(context, p)) === known[name]) return p;
        }
      }
      // First use of the default name adopts the tab Chrome opened at launch.
      const adoptable = name === 'main' && !Object.keys(known).length ? context.pages()[0] : null;
      const page = adoptable ?? (await context.newPage());
      known[name] = await targetId(context, page);
      writeJson(PAGES_FILE, known);
      return page;
    },
    async close() {
      // Detach only. The daemon owns Chrome and keeps it running.
      await browser.close().catch(() => {});
    },
  };
}

export async function withPage(name, fn) {
  const session = await connect();
  try {
    return await fn(await session.page(name), session.context);
  } finally {
    await session.close();
  }
}

function locate(page, flags) {
  if (flags.role) {
    const opts = flags.name ? { name: String(flags.name), exact: Boolean(flags.exact) } : {};
    return page.getByRole(String(flags.role), opts);
  }
  if (flags.label) return page.getByLabel(String(flags.label));
  if (flags.text) return page.getByText(String(flags.text));
  if (flags.css) return page.locator(String(flags.css));
  throw new CliError('no target', 'pass --role <role> --name <name>, --label, --text or --css');
}

export function readEvents({ since, type, limit = 50 } = {}) {
  const from = since ? Date.parse(String(since)) : 0;
  if (Number.isNaN(from)) {
    throw new CliError(`--since is not a valid date: ${since}`, 'use an ISO timestamp, e.g. 2026-09-27T10:00:00Z');
  }
  const lines = existsSync(EVENTS_FILE) ? readFileSync(EVENTS_FILE, 'utf8').trim().split('\n') : [];
  const events = lines
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => Date.parse(e.t) >= from && (!type || e.type === type));
  return { count: events.length, events: events.slice(-Number(limit)) };
}

export async function metrics(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics: all } = await cdp.send('Performance.getMetrics');
  const pick = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'JSEventListeners', 'LayoutCount', 'ScriptDuration', 'TaskDuration'];
  return { url: page.url(), metrics: Object.fromEntries(all.filter((m) => pick.includes(m.name)).map((m) => [m.name, m.value])) };
}

export async function heapSnapshot(page, context, path) {
  const file = artifactPath(path);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  writeFileSync(file, '');
  cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => appendFileSync(file, chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  return { url: page.url(), path: file };
}

// Waits until the DOM (including open shadow roots) has not changed for
// `quietMs`. Streaming replies, data tables and charts settle this way; a
// fixed sleep would be either too short or wasted time.
export async function settle(page, { quietMs = 600, timeout = 20000 } = {}) {
  const start = Date.now();
  const settled = await page.evaluate(
    ({ quietMs, timeout }) =>
      new Promise((resolve) => {
        let timer;
        const observers = [];
        const done = (ok) => {
          observers.forEach((o) => o.disconnect());
          clearTimeout(timer);
          clearTimeout(deadline);
          resolve(ok);
        };
        const arm = () => {
          clearTimeout(timer);
          timer = setTimeout(() => done(true), quietMs);
        };
        const observe = (root) => {
          const o = new MutationObserver(arm);
          o.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
          observers.push(o);
        };
        observe(document);
        document.querySelectorAll('*').forEach((el) => el.shadowRoot && observe(el.shadowRoot));
        const deadline = setTimeout(() => done(false), timeout);
        arm();
      }),
    { quietMs, timeout },
  );
  if (!settled) throw new CliError(`page did not settle within ${timeout}ms`, 'something keeps re-rendering; take a screenshot to see what');
  return { url: page.url(), ms: Date.now() - start };
}

export async function screenshot(page, path, full = false) {
  const file = artifactPath(path);
  await page.screenshot({ path: file, fullPage: full });
  return { url: page.url(), path: file };
}

export async function ariaSnapshot(page, path) {
  const aria = await page.locator('body').ariaSnapshot({ timeout: 15000 });
  if (!path) return { url: page.url(), aria };
  const file = artifactPath(path);
  writeFileSync(file, aria);
  return { url: page.url(), path: file };
}

// Generic actions for `cw-verify browser <cmd>`. Each returns data.
export async function browserAction(cmd, flags, positional) {
  const timeout = Number(flags.timeout ?? 15000);
  const name = flags.page ? String(flags.page) : 'main';
  switch (cmd) {
    case 'goto':
      return withPage(name, async (page) => {
        const url = positional[0] ?? need(flags, 'url', 'browser goto http://localhost:3000/sign-in');
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        return { url: page.url(), status: res?.status() ?? null, title: await page.title() };
      });
    case 'click':
      return withPage(name, async (page) => {
        await locate(page, flags).first().click({ timeout });
        return { target: flags, url: page.url() };
      });
    case 'fill':
      return withPage(name, async (page) => {
        await locate(page, flags).first().fill(String(need(flags, 'value', 'browser fill --label Email --value a@b.c')), { timeout });
        return { target: { ...flags, value: flags.secret ? '***' : flags.value } };
      });
    case 'upload':
      // Sets files on an <input type=file>, the same path a user's file picker takes.
      return withPage(name, async (page) => {
        const file = artifactPath(String(need(flags, 'file', 'browser upload --css "input[type=file]" --file .verify/fixtures/faq.txt')));
        await locate(page, flags).first().setInputFiles(file, { timeout });
        return { target: flags, file };
      });
    case 'press':
      return withPage(name, async (page) => {
        await page.keyboard.press(String(need(flags, 'key', 'browser press --key Enter')));
        return { key: flags.key };
      });
    case 'wait':
      return withPage(name, async (page) => {
        const start = Date.now();
        if (flags.url) await page.waitForURL(`**${flags.url}**`, { timeout });
        else await locate(page, flags).first().waitFor({ state: flags.gone ? 'hidden' : 'visible', timeout });
        return { target: flags, ms: Date.now() - start, url: page.url() };
      });
    case 'text':
      return withPage(name, async (page) => ({ target: flags, text: await locate(page, flags).allInnerTexts() }));
    case 'eval':
      return withPage(name, async (page) => ({ value: await page.evaluate(String(need(flags, 'js', 'browser eval --js "document.title"'))) }));
    case 'snapshot':
      return withPage(name, (page) => ariaSnapshot(page, flags.path ? String(flags.path) : null));
    case 'screenshot':
      return withPage(name, (page) => screenshot(page, String(need(flags, 'path', 'browser screenshot --path .verify/artifacts/x/shot.png')), Boolean(flags.full)));
    case 'metrics':
      return withPage(name, (page, context) => metrics(page, context));
    case 'heap':
      return withPage(name, (page, context) => heapSnapshot(page, context, String(need(flags, 'path', 'browser heap --path .verify/artifacts/x/after.heapsnapshot'))));
    case 'settle':
      return withPage(name, (page) => settle(page, { quietMs: Number(flags.quiet ?? 600), timeout }));
    case 'events':
      return readEvents({ since: flags.since, type: flags.type, limit: flags.limit });
    case 'pages': {
      const session = await connect();
      try {
        const known = readJson(PAGES_FILE, {});
        const out = [];
        for (const [pageName] of Object.entries(known)) {
          const p = await session.page(pageName);
          out.push({ name: pageName, url: p.url() });
        }
        return { pages: out };
      } finally {
        await session.close();
      }
    }
    default:
      throw new CliError(`unknown browser command ${cmd}`, 'see --help');
  }
}
