// k6 load test: the public widget path (config -> stream turn -> handover poll).
//
// Run (never against production):
//   k6 run -e BASE_URL=https://api-staging.example.com \
//          -e AGENT_PUBLIC_ID=abcd1234 \
//          -e ORIGIN=https://customer.example \
//          scripts/load/k6/widget-chat.js
//
// Every stream turn spends real LLM tokens. Use a test agent on a cheap model.
// Read scripts/load/README.md first: it explains the rate-limit env you must
// raise on the target for the numbers to mean anything.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const API = `${BASE_URL}/api/klivo/v1`;
const AGENT = __ENV.AGENT_PUBLIC_ID;
const ORIGIN = __ENV.ORIGIN || 'http://localhost:3000';
const MODE = __ENV.MODE || 'full'; // full | poll-only | config-only

if (!AGENT) {
  throw new Error('AGENT_PUBLIC_ID is required (the widget publicId of a TEST agent)');
}

// ---- custom metrics -------------------------------------------------------
const streamTurnMs = new Trend('stream_turn_ms', true);
const streamFailed = new Rate('stream_failed');
const streamRateLimited = new Counter('stream_rate_limited');
const pollMs = new Trend('poll_ms', true);
const configMs = new Trend('config_ms', true);

// ---- scenarios --------------------------------------------------------------
// Sized for the stated target: 10K customers/month is ~2 msg/s at a 50x peak.
// The interesting failure is concurrency (open SSE streams holding sockets),
// not raw RPS, so `chat` ramps concurrent VUs rather than iterations/s.
const scenarios = {};
if (MODE === 'full' || MODE === 'config-only') {
  scenarios.config = {
    executor: 'constant-arrival-rate',
    rate: 20, timeUnit: '1s', duration: '3m', preAllocatedVUs: 10, maxVUs: 40,
    exec: 'widgetConfig',
  };
}
if (MODE === 'full') {
  scenarios.chat = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m', target: 20 },
      { duration: '2m', target: 50 },
      { duration: '2m', target: 100 },   // ~100 concurrent open streams
      { duration: '1m', target: 0 },
    ],
    exec: 'chatTurn',
    gracefulRampDown: '30s',
  };
}
if (MODE === 'full' || MODE === 'poll-only') {
  scenarios.poll = {
    executor: 'constant-vus',
    vus: 50, duration: '3m',
    exec: 'handoverPoll',
  };
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ['rate<0.02'],
    config_ms: ['p(95)<800'],
    stream_turn_ms: ['p(95)<15000'],   // full LLM turn incl. persistence; LLM-bound
    stream_failed: ['rate<0.02'],
    poll_ms: ['p(95)<500'],
  },
};

// ---- helpers ----------------------------------------------------------------
function deviceId() {
  // One device per VU so the per-device limiter (10/min) sees realistic users.
  return `k6-${__VU}-${__ENV.RUN_ID || 'run'}`;
}

function widgetHeaders(extra = {}) {
  return Object.assign(
    {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId(),
      Accept: 'text/event-stream',
    },
    extra,
  );
}

const PROMPTS = [
  'What are your opening hours?',
  'How do I reset my password?',
  'Do you ship internationally?',
  'Can I talk to someone about pricing?',
  'What is your refund policy?',
];

// Per-VU session so multi-turn context and rotation are exercised.
let sessionId = null;

// ---- scenario functions -----------------------------------------------------
export function widgetConfig() {
  const res = http.get(`${API}/public/agents/${AGENT}/config`, {
    headers: { Origin: ORIGIN },
    tags: { name: 'GET /public/agents/:publicId/config' },
  });
  configMs.add(res.timings.duration);
  check(res, {
    'config 200': (r) => r.status === 200,
    'config has CORS for origin': (r) =>
      (r.headers['Access-Control-Allow-Origin'] || '') !== '' || ORIGIN === 'http://localhost:3000',
  });
}

export function chatTurn() {
  const body = JSON.stringify({
    agentId: AGENT,
    chatInput: PROMPTS[__ITER % PROMPTS.length],
    source: 'WIDGET',
    ...(sessionId ? { sessionId } : {}),
  });
  const res = http.post(`${API}/public/chat/stream`, body, {
    headers: widgetHeaders(),
    timeout: '40s',
    tags: { name: 'POST /public/chat/stream' },
  });
  streamTurnMs.add(res.timings.duration);

  const text = res.body || '';
  const gotDone = text.includes('"type":"done"');
  const gotError = text.includes('"type":"error"');
  const rateLimited = text.includes('too quickly') || text.includes('too many messages');
  if (rateLimited) streamRateLimited.add(1);
  streamFailed.add(!(res.status === 200 && gotDone && !gotError));

  check(res, {
    'stream 200': (r) => r.status === 200,
    'stream emitted done': () => gotDone,
    'stream no error event': () => !gotError,
  });

  const m = /"type":"session","sessionId":"([0-9a-f-]{36})"/.exec(text);
  if (m) sessionId = m[1];

  // Think time. Also keeps each device under the 10/min per-device limit.
  sleep(8 + Math.random() * 4);
}

export function handoverPoll() {
  // Needs a real session id: reuse one created by this VU, or create one first.
  if (!sessionId) {
    const res = http.post(
      `${API}/public/chat/request-human`,
      JSON.stringify({ agentId: AGENT, source: 'WIDGET' }),
      { headers: widgetHeaders(), tags: { name: 'POST /public/chat/request-human' } },
    );
    try {
      sessionId = JSON.parse(res.body).sessionId;
    } catch {
      sleep(2.5);
      return;
    }
  }
  const res = http.get(
    `${API}/public/chat/${sessionId}/poll?agentId=${encodeURIComponent(AGENT)}`,
    { headers: { Origin: ORIGIN }, tags: { name: 'GET /public/chat/:sessionId/poll' } },
  );
  pollMs.add(res.timings.duration);
  check(res, { 'poll 200': (r) => r.status === 200 });
  sleep(2.5); // widget fast-poll cadence
}

export function handleSummary(data) {
  const p = (m, k) => (data.metrics[m] && data.metrics[m].values[k] !== undefined ? Math.round(data.metrics[m].values[k]) : 'n/a');
  const lines = [
    '',
    '== widget-chat summary ==',
    `config      p50 ${p('config_ms', 'med')} ms  p95 ${p('config_ms', 'p(95)')} ms`,
    `stream turn p50 ${p('stream_turn_ms', 'med')} ms  p95 ${p('stream_turn_ms', 'p(95)')} ms  failed ${data.metrics.stream_failed ? (data.metrics.stream_failed.values.rate * 100).toFixed(2) : 'n/a'}%  rate-limited ${data.metrics.stream_rate_limited ? data.metrics.stream_rate_limited.values.count : 0}`,
    `poll        p50 ${p('poll_ms', 'med')} ms  p95 ${p('poll_ms', 'p(95)')} ms`,
    `http failed ${data.metrics.http_req_failed ? (data.metrics.http_req_failed.values.rate * 100).toFixed(2) : 'n/a'}%`,
    '',
  ];
  return { stdout: lines.join('\n') };
}
