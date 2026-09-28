// Repeatable performance measurements (pstack perf-issue / hillclimb style):
// one command per metric, several samples, median and p90, raw samples saved.
// Run them against `stack up --prod`: dev-mode timings are not the product's.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS, CliError, URLS, artifactPath, resolveAgent } from './core.mjs';
import { connect, readEvents, settle } from './browser.mjs';
import { loginAs } from './dashboard.mjs';
import { closeWidget, openWidget, sendMessage } from './widget.mjs';
import { currentMode, modeInfo } from './stack.mjs';

// Percentiles by linear interpolation between ranks. Nearest-rank p90 of 5 to 9
// samples is always the maximum, which hides the difference between the two.
export function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const at = (q) => {
    const pos = (v.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  const round = (x) => Math.round(x * 100) / 100;
  return { n: v.length, median: round(at(0.5)), p90: round(at(0.9)), min: round(v[0]), max: round(v[v.length - 1]) };
}

function summarize(samples, keys) {
  return Object.fromEntries(keys.map((k) => [k, stats(samples.map((s) => s[k]))]));
}

function save(name, result) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = artifactPath(join(ARTIFACTS, 'perf', `${name}-${stamp}.json`));
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}

function modeNote() {
  const mode = currentMode();
  return mode === 'prod' ? null : 'measured in dev mode: numbers are not representative, use stack up --prod';
}

// Which code produced the numbers: every result carries it.
function buildInfo() {
  const info = modeInfo();
  return { mode: info.mode, builtFrom: info.builtFrom ?? null, builtAt: info.builtAt ?? null };
}

// Web vitals and navigation timing for the page's last hard navigation.
async function vitals(page) {
  return page.evaluate(async () => {
    const observe = (type, reduce, initial) =>
      new Promise((resolve) => {
        let acc = initial;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) acc = reduce(acc, e);
          }).observe({ type, buffered: true });
        } catch {
          // Entry type unsupported: report the initial value.
        }
        setTimeout(() => resolve(acc), 150);
      });
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const [lcp, shifts, longTasks] = await Promise.all([
      // Keep the element too: an LCP number is only meaningful next to what
      // was painted (a skeleton and the real content can both be "largest").
      observe(
        'largest-contentful-paint',
        (_, e) => ({
          t: e.startTime,
          size: e.size,
          element: `${e.element?.tagName ?? ''} ${(e.element?.textContent ?? '').trim().slice(0, 40)}`.trim(),
        }),
        null,
      ),
      observe('layout-shift', (list, e) => (e.hadRecentInput ? list : [...list, { t: e.startTime, v: e.value }]), []),
      observe('longtask', (a, e) => ({ count: a.count + 1, ms: a.ms + e.duration }), { count: 0, ms: 0 }),
    ]);
    // CLS as Chrome defines it: shifts group into session windows (under 1 s
    // apart, at most 5 s long) and CLS is the largest window, not the total.
    let cls = 0;
    let windowStart = -Infinity;
    let last = -Infinity;
    let sum = 0;
    for (const s of shifts.sort((a, b) => a.t - b.t)) {
      if (s.t - last > 1000 || s.t - windowStart > 5000) {
        windowStart = s.t;
        sum = 0;
      }
      sum += s.v;
      last = s.t;
      cls = Math.max(cls, sum);
    }
    const transfer = resources.reduce((s, r) => s + (r.transferSize || 0), nav?.transferSize || 0);
    return {
      ttfbMs: nav ? nav.responseStart : null,
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadMs: nav ? nav.loadEventEnd : null,
      fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      lcpMs: lcp ? lcp.t : null,
      lcpElement: lcp ? lcp.element : null,
      lcpSize: lcp ? lcp.size : null,
      cls: Math.round(cls * 1000) / 1000,
      longTasks: longTasks.count,
      longTaskMs: Math.round(longTasks.ms),
      transferKB: Math.round(transfer / 1024),
      requests: resources.length + 1,
    };
  });
}

// API latency seen by the browser during one load, grouped by endpoint.
function apiTimings(sinceIso) {
  const { events } = readEvents({ since: sinceIso, type: 'timing', limit: 500 });
  const rows = events.filter((e) => e.url.includes('/api/klivo/v1/') && typeof e.ms === 'number');
  const byPath = {};
  for (const e of rows) {
    const path = new URL(e.url).pathname.replace(/^\/api\/klivo\/v1/, '').replace(/[0-9a-f-]{36}/g, ':id');
    (byPath[`${e.method} ${path}`] ??= []).push(e.ms);
  }
  return byPath;
}

export async function pageLoad({ url, role = 'owner', runs = 5, waitText }) {
  if (!url) throw new CliError('missing --url', 'example: perf page-load --url /dashboard --wait-text "Verify Chat Bot"');
  const target = url.startsWith('http') ? url : `${URLS.web}${url}`;
  const session = await connect();
  try {
    const page = await session.page('perf');
    await loginAs(page, session.context, role);
    const samples = [];
    const api = {};
    for (let i = 0; i < runs; i++) {
      const since = new Date().toISOString();
      await page.goto(target, { waitUntil: 'commit', timeout: 90000 });
      // contentReadyMs: navigation start until the wait text is on screen. Pick
      // a text that needs data (an agent name, "All clear"), not a static
      // heading. LCP alone is not enough here: it can settle on the sidebar
      // logo long before the data-driven content paints.
      const contentReadyMs = waitText
        ? await page
            .waitForFunction(
              (text) => (document.body?.innerText.includes(text) ? Math.round(performance.now()) : false),
              String(waitText),
              { polling: 'raf', timeout: 60000 },
            )
            .then((h) => h.jsonValue())
        : null;
      await page.waitForLoadState('load', { timeout: 60000 });
      await settle(page, { quietMs: 800, timeout: 30000 });
      samples.push({ run: i + 1, contentReadyMs, ...(await vitals(page)) });
      for (const [k, v] of Object.entries(apiTimings(since))) (api[k] ??= []).push(...v);
    }
    const keys = ['contentReadyMs', 'ttfbMs', 'fcpMs', 'lcpMs', 'domContentLoadedMs', 'loadMs', 'cls', 'longTaskMs', 'transferKB'];
    const result = {
      metric: 'page-load',
      url: target,
      role,
      ...buildInfo(),
      note: modeNote(),
      summary: summarize(samples, keys),
      api: Object.fromEntries(Object.entries(api).map(([k, v]) => [k, stats(v)])),
      samples,
    };
    return { ...result, saved: save('page-load', result) };
  } finally {
    await session.close();
  }
}

export async function widgetLoad({ agent = 'chat', runs = 5 }) {
  const a = resolveAgent(agent);
  const session = await connect();
  try {
    const page = await session.page('perf');
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const since = new Date().toISOString();
      const start = Date.now();
      await page.goto(`${URLS.host}/?agent=${a.publicId}`, { waitUntil: 'domcontentloaded' });
      const launcher = page.getByRole('button', { name: 'Open chat widget' });
      await launcher.waitFor({ timeout: 30000 });
      const launcherMs = Date.now() - start;
      const openStart = Date.now();
      await launcher.click();
      await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
      const openMs = Date.now() - openStart;
      const res = await page.evaluate(() =>
        performance.getEntriesByType('resource').map((r) => ({ name: r.name, kb: (r.transferSize || 0) / 1024, ms: r.duration })),
      );
      const bundle = res.find((r) => /widget\.js|main\.tsx/.test(r.name));
      const config = res.find((r) => r.name.includes('/config'));
      samples.push({
        run: i + 1,
        launcherVisibleMs: launcherMs,
        openDialogMs: openMs,
        bundleKB: bundle ? Math.round(bundle.kb) : null,
        bundleMs: bundle ? Math.round(bundle.ms) : null,
        configMs: config ? Math.round(config.ms) : null,
        requestsFromWidget: readEvents({ since, type: 'response', limit: 200 }).count,
      });
      await closeWidget(page).catch(() => {});
    }
    const keys = ['launcherVisibleMs', 'openDialogMs', 'bundleKB', 'bundleMs', 'configMs'];
    const result = { metric: 'widget-load', agent: a.publicId, ...buildInfo(), note: modeNote(), summary: summarize(samples, keys), samples };
    return { ...result, saved: save('widget-load', result) };
  } finally {
    await session.close();
  }
}

export async function widgetReply({ agent = 'chat', runs = 7, text = 'Reply with one short sentence about the weather.' }) {
  // The per-device limit is 10 messages a minute and page-load warmup uses one.
  if (runs > 9) throw new CliError('at most 9 runs per minute per device', 'run it again after a minute for more samples');
  const a = resolveAgent(agent);
  const session = await connect();
  try {
    const page = await session.page('perf');
    // Start as a new visitor device. The rate limit is per device, and earlier
    // runs (every widget page load spends one slot on warmup) would otherwise
    // use up this run's budget. Clearing the host origin's storage gives a new
    // device id; the per-IP limit (MSG_IP_MINUTE_LIMIT) still applies.
    await page.goto('about:blank');
    const cdp = await session.context.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin: URLS.host, storageTypes: 'all' });
    await cdp.detach().catch(() => {});
    await openWidget(page, agent);
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const r = await sendMessage(page, text, { timeout: 60000 });
      if (r.outcome !== 'replied') {
        throw new CliError(`run ${i + 1} ended with ${r.outcome}`, 'check the LLM provider and rate limits', {
          alert: r.alert,
          samples,
        });
      }
      samples.push({ run: i + 1, firstTokenMs: r.firstTokenMs, replyMs: r.replyMs, replyChars: r.reply?.length ?? 0 });
    }
    const result = {
      metric: 'widget-reply',
      agent: a.publicId,
      ...buildInfo(),
      note: 'includes the real LLM call (gpt-4.1-mini); model latency dominates and varies by provider load',
      summary: summarize(samples, ['firstTokenMs', 'replyMs']),
      samples,
    };
    return { ...result, saved: save('widget-reply', result) };
  } finally {
    await session.close();
  }
}

async function heapReading(page, context) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (n) => metrics.find((m) => m.name === n)?.value ?? null;
    return {
      heapMB: Math.round((get('JSHeapUsedSize') / 1048576) * 100) / 100,
      nodes: get('Nodes'),
      listeners: get('JSEventListeners'),
    };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Opens and closes the widget repeatedly and compares memory after GC. Steady
// growth per cycle points at a leak (listeners, nodes or closures kept alive).
export async function widgetLeak({ agent = 'chat', cycles = 20 }) {
  const a = resolveAgent(agent);
  const session = await connect();
  try {
    const page = await session.page('perf');
    await openWidget(page, agent);
    await closeWidget(page);
    const before = await heapReading(page, session.context);
    const launcher = page.getByRole('button', { name: 'Open chat widget' });
    for (let i = 0; i < cycles; i++) {
      await launcher.click();
      await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
      await closeWidget(page);
      await launcher.waitFor({ timeout: 15000 });
    }
    const after = await heapReading(page, session.context);
    const delta = {
      heapMB: Math.round((after.heapMB - before.heapMB) * 100) / 100,
      nodes: after.nodes - before.nodes,
      listeners: after.listeners - before.listeners,
    };
    const perCycle = {
      heapKB: Math.round(((delta.heapMB * 1024) / cycles) * 10) / 10,
      nodes: Math.round((delta.nodes / cycles) * 10) / 10,
      listeners: Math.round((delta.listeners / cycles) * 10) / 10,
    };
    const result = { metric: 'widget-leak', agent: a.publicId, ...buildInfo(), note: modeNote(), cycles, before, after, delta, perCycle };
    return { ...result, saved: save('widget-leak', result) };
  } finally {
    await session.close();
  }
}
