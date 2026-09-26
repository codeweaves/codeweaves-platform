// The local stack: start and stop services, doctor, seed, read-only SQL, host page.

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARTIFACTS,
  CREDS_FILE,
  CliError,
  ENTRY,
  HOST_PORT,
  LOG_DIR,
  PG_CONTAINER,
  PG_PORT,
  PIDS_FILE,
  REPO,
  STATE_FILE,
  URLS,
  readJson,
  writeJson,
} from './core.mjs';
import {
  httpStatus,
  killTree,
  localDatabaseUrl,
  owns,
  pids,
  requireExecutable,
  startDetached,
  waitFor,
} from './proc.mjs';

// Services `stack up` starts. Each is stopped by its recorded pid, never by name.
export const SERVICES = {
  api: {
    cwd: 'apps/api',
    cmd: ['bun', 'run', 'dev'],
    port: 3001,
    ready: `${URLS.apiRoot}/health`,
    // Keep verification off Upstash: the local Docker Redis serves this run.
    env: { REDIS_URL: 'redis://localhost:6379' },
  },
  web: { cwd: 'apps/web', cmd: ['bun', 'run', 'dev'], port: 3000, ready: `${URLS.web}/sign-in` },
  widget: { cwd: 'apps/widget', cmd: ['bun', 'run', 'dev'], port: 5173, ready: `${URLS.widget}/src/main.tsx` },
  host: { internal: true, port: HOST_PORT, ready: `${URLS.host}/health` },
};

export async function stackUp({ only = Object.keys(SERVICES), reuse = false } = {}) {
  const databaseUrl = localDatabaseUrl();
  requireExecutable('docker');
  requireExecutable('bun');
  execFileSync('docker', ['compose', 'up', '-d', '--wait'], { cwd: REPO, stdio: 'ignore' });
  const recorded = pids();
  const services = {};
  for (const name of only) {
    const svc = SERVICES[name];
    if (!svc) throw new CliError(`unknown service ${name}`, `one of: ${Object.keys(SERVICES).join(', ')}`);
    const ours = owns(recorded[name]);
    if (!ours && (await httpStatus(svc.ready)) > 0) {
      if (!reuse) {
        throw new CliError(
          `port ${svc.port} (${name}) is served by a process this run did not start`,
          'stop it, or pass --reuse to drive it as-is (doctor then reports it as foreign)',
        );
      }
      services[name] = 'foreign';
      continue;
    }
    if (!ours) {
      if (svc.internal) {
        startDetached(name, process.execPath, [ENTRY, '__host'], { cwd: REPO }, 'cw-verify');
      } else {
        // Pin the database the guard checked, so the API cannot pick up another.
        const env = { ...process.env, ...svc.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
        startDetached(name, svc.cmd[0], svc.cmd.slice(1), { cwd: join(REPO, svc.cwd), env }, svc.cmd[0]);
      }
    }
    const ms = await waitFor(async () => (await httpStatus(svc.ready, 5000)) === 200, 180_000, name);
    services[name] = ours ? 'already-running' : `started (${Math.round(ms / 1000)}s)`;
  }
  return { database: `localhost:${PG_PORT}`, services, logs: LOG_DIR };
}

export function stackDown({ dryRun = false } = {}) {
  const plan = Object.entries(pids()).map(([name, entry]) => ({ name, entry, ours: owns(entry) }));
  if (dryRun) {
    return { dryRun: true, wouldKill: plan.filter((p) => p.ours).map((p) => ({ name: p.name, pid: p.entry.pid })) };
  }
  const stopped = plan.map((p) => ({ name: p.name, pid: p.entry?.pid ?? null, killed: killTree(p.entry) }));
  writeJson(PIDS_FILE, {});
  return { stopped, evidenceKept: ARTIFACTS };
}

export async function doctor() {
  const checks = {};
  try {
    localDatabaseUrl();
    checks.database = { ok: true, target: `localhost:${PG_PORT}` };
  } catch (e) {
    checks.database = { ok: false, error: e.message };
  }
  try {
    const status = execFileSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', PG_CONTAINER], {
      encoding: 'utf8',
    }).trim();
    checks.postgres = { ok: status === 'healthy', status };
  } catch {
    checks.postgres = { ok: false, error: 'container not running', hint: 'start Docker Desktop, then cw-verify stack up' };
  }
  const recorded = pids();
  for (const [name, svc] of Object.entries(SERVICES)) {
    const status = await httpStatus(svc.ready);
    const owner = owns(recorded[name]) ? 'this-run' : status ? 'foreign' : 'none';
    checks[name] = { ok: status === 200 && owner === 'this-run', http: status, owner };
    if (owner === 'foreign') checks[name].hint = 'not started by this run; stop it or start the stack with --reuse on purpose';
  }
  if (checks.api.http === 200) {
    try {
      const health = await (await fetch(`${URLS.apiRoot}/health`)).json();
      checks.api.commit = health.commit ?? null;
      checks.api.headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
      const ready = await (await fetch(`${URLS.apiRoot}/health/ready`)).json();
      checks.api.ready = ready;
      if (ready.status !== 'ok') checks.api.ok = false;
    } catch (e) {
      checks.api.ok = false;
      checks.api.detail = e.message;
    }
  }
  checks.browser = { ok: (await httpStatus(`${URLS.cdp}/json/version`)) === 200 };
  const s = readJson(STATE_FILE, null);
  checks.seed = s
    ? { ok: true, org: s.org.slug, chat: s.agents.chat.publicId, voice: s.agents.voice.publicId, owner: s.owner.email }
    : { ok: false, hint: 'cw-verify seed' };
  checks.credentials = { ok: existsSync(CREDS_FILE) };
  return { healthy: Object.values(checks).every((c) => c.ok), checks };
}

export async function requireHealthy(services) {
  const report = await doctor();
  const relevant = ['database', 'postgres', 'browser', 'seed', 'credentials', ...services];
  const bad = relevant.filter((k) => !report.checks[k]?.ok);
  if (bad.length) {
    throw new CliError(`doctor: not healthy (${bad.join(', ')})`, 'run cw-verify doctor for details', { checks: report.checks });
  }
}

export function seed() {
  const databaseUrl = localDatabaseUrl();
  // bun runs TypeScript natively; no unpinned tsx download with secrets in env.
  const stdout = execFileSync('bun', ['run', 'prisma/seed-verify.ts'], {
    cwd: join(REPO, 'apps/api'),
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  });
  return { state: JSON.parse(stdout.trim().split(/\r?\n/).pop()), stateFile: STATE_FILE };
}

export function dbQuery(sql) {
  const trimmed = String(sql).trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(trimmed) || trimmed.includes(';')) {
    throw new CliError('db query is read-only: one SELECT or WITH statement', 'mutate state through the app, not the database');
  }
  // Query the database the API uses, not a hard-coded name.
  const target = new URL(localDatabaseUrl());
  const database = decodeURIComponent(target.pathname.slice(1)) || 'postgres';
  const user = decodeURIComponent(target.username) || 'postgres';
  const wrapped = `select coalesce(json_agg(t), '[]'::json) from (${trimmed}) t`;
  // The regex above is a courtesy. Postgres enforces read-only: a SELECT that
  // calls a writing function (setval, lo_import...) fails in a read-only transaction.
  const raw = execFileSync(
    'docker',
    [
      'exec',
      '-e',
      'PGOPTIONS=-c default_transaction_read_only=on',
      PG_CONTAINER,
      'psql',
      '-U',
      user,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
      '-c',
      wrapped,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw.trim() || '[]');
}

function hostPage(agent) {
  const safe = agent.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Verify host page (agent ${safe})</title></head>
<body style="font-family:system-ui;margin:40px">
<h1>Verify host page</h1><p>Agent <code>${safe}</code>. The widget loads from the Vite dev server.</p>
<script type="module" src="${URLS.widget}/src/main.tsx" data-agent-id="${safe}"></script>
</body></html>`;
}

export function runHost() {
  createServer((req, res) => {
    const url = new URL(req.url, URLS.host);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    const agent = url.searchParams.get('agent');
    if (!agent) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('missing ?agent=<publicId>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(hostPage(agent));
  }).listen(HOST_PORT);
}
