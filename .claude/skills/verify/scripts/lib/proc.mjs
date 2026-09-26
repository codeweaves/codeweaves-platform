// Process ownership, detached spawning, readiness polling and the local-DB guard.

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError, LOG_DIR, PG_PORT, PIDS_FILE, REPO, readJson, writeJson } from './core.mjs';

export async function httpStatus(url, timeoutMs = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status;
  } catch {
    return 0;
  }
}

export async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return Date.now() - start;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new CliError(`${label} not ready after ${timeoutMs / 1000}s`, `check ${LOG_DIR}`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Start time plus command line identify one process instance. A pid alone can
// be reused after the process exits or the machine reboots.
function pidIdentity(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') + '|' + $p.CommandLine }`,
        ],
        { encoding: 'utf8', windowsHide: true },
      ).trim();
      const cut = out.indexOf('|');
      return cut < 0 ? null : { started: out.slice(0, cut), command: out.slice(cut + 1) };
    }
    const out = execFileSync('ps', ['-o', 'lstart=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    // lstart is a fixed 24-character timestamp, then the command line.
    return out ? { started: out.slice(0, 24), command: out.slice(24).trim() } : null;
  } catch {
    return null;
  }
}

// A recorded pid is ours only while the same process instance still runs:
// alive, same start time, and the command we started.
export function owns(entry) {
  if (!entry || typeof entry !== 'object' || !entry.started) return false;
  if (!pidAlive(entry.pid)) return false;
  const now = pidIdentity(entry.pid);
  return Boolean(now && now.started === entry.started && now.command.includes(entry.marker));
}

export function killTree(entry) {
  if (!owns(entry)) return false;
  const { pid } = entry;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      return false;
    }
    return true;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
  return true;
}

export function pids() {
  return readJson(PIDS_FILE, {});
}

export function forgetPid(name) {
  const all = pids();
  delete all[name];
  writeJson(PIDS_FILE, all);
}

// Spawns without a shell: on Windows a detached cmd.exe drops all child output.
export function startDetached(name, command, args, opts, marker) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${name}.log`);
  const log = openSync(logFile, 'a');
  const child = spawn(command, args, {
    ...opts,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  child.on('error', (err) => appendFileSync(logFile, `[cw-verify] spawn failed: ${err.message}\n`));
  child.unref();
  const identity = pidIdentity(child.pid);
  const all = pids();
  all[name] = { pid: child.pid, marker, started: identity?.started ?? null };
  writeJson(PIDS_FILE, all);
  return child.pid;
}

export function requireExecutable(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
  } catch {
    throw new CliError(`${command} is not runnable from PATH`, `install ${command}, or open a shell where \`${command} --version\` works`);
  }
}

// The value the API will actually use: an exported DATABASE_URL wins over .env,
// and within .env the last assignment wins. Only the Docker database qualifies.
export function localDatabaseUrl() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const envFile = join(REPO, 'apps/api/.env');
    const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
    const line = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith('DATABASE_URL='))
      .pop();
    url = line ? line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '') : '';
  }
  const host = url.match(/@([^:/?]+)(?::(\d+))?/);
  if (!host || !['localhost', '127.0.0.1'].includes(host[1]) || host[2] !== String(PG_PORT)) {
    throw new CliError(
      `DATABASE_URL does not point at the Docker database (localhost:${PG_PORT})`,
      'check apps/api/.env and any exported DATABASE_URL in this shell',
    );
  }
  return url;
}
