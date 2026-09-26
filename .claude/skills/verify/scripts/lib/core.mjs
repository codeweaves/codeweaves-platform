// Paths, constants, JSON output and run state shared by every cw-verify module.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO = resolve(SKILL_DIR, '../../..');
export const ENTRY = join(SKILL_DIR, 'scripts', 'cw-verify.mjs');
export const FLOWS_DIR = join(SKILL_DIR, 'flows');

export const RUN_DIR = join(REPO, '.verify');
export const LOG_DIR = join(RUN_DIR, 'logs');
export const ARTIFACTS = join(RUN_DIR, 'artifacts');
export const PIDS_FILE = join(RUN_DIR, 'pids.json');
export const PAGES_FILE = join(RUN_DIR, 'pages.json');
export const STATE_FILE = join(RUN_DIR, 'state.json');
export const CREDS_FILE = join(RUN_DIR, 'credentials.json');
export const EVENTS_FILE = join(LOG_DIR, 'browser-events.jsonl');
export const VOICE_FIXTURE = join(RUN_DIR, 'fixtures', 'voice.wav');

export const CDP_PORT = 9333;
export const HOST_PORT = 5180;
export const PG_CONTAINER = 'codeweaves-postgres';
export const PG_PORT = 5433;

export const URLS = {
  api: 'http://localhost:3001/api/klivo/v1',
  // Health routes are excluded from the global prefix (apps/api/src/main.ts).
  apiRoot: 'http://localhost:3001',
  web: 'http://localhost:3000',
  widget: 'http://localhost:5173',
  host: `http://localhost:${HOST_PORT}`,
  cdp: `http://127.0.0.1:${CDP_PORT}`,
};

export class CliError extends Error {
  constructor(message, hint, body) {
    super(message);
    this.hint = hint;
    this.body = body;
  }
}

export function out(result) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

export function fail(err) {
  const body = { ok: false, error: err.message, ...err.body };
  if (err.hint) body.hint = err.hint;
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exit(1);
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { positional, flags };
}

export function need(flags, key, example) {
  if (flags[key] === undefined || flags[key] === true) {
    throw new CliError(`missing --${key}`, `example: ${example}`);
  }
  return flags[key];
}

export function readJson(file, fallback) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function artifactPath(p) {
  const full = resolve(REPO, p);
  mkdirSync(dirname(full), { recursive: true });
  return full;
}

export function state() {
  const s = readJson(STATE_FILE, null);
  if (!s) throw new CliError('no seeded tenant', 'run: cw-verify seed');
  return s;
}

export function credentials() {
  const c = readJson(CREDS_FILE, null);
  if (!c) throw new CliError('no test-user credentials', 'run: cw-verify seed');
  return c;
}

export function resolveAgent(ref = 'chat') {
  const s = state();
  return s.agents[ref] ?? { publicId: ref, name: ref };
}
