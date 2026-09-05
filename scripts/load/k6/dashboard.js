// k6 load test: authenticated dashboard reads (analytics + conversations).
//
//   k6 run -e BASE_URL=https://api-staging.example.com \
//          -e DASHBOARD_ORIGIN=https://app-staging.example.com \
//          -e CLERK_TOKEN=eyJ... \
//          scripts/load/k6/dashboard.js
//
// CLERK_TOKEN: a Clerk session JWT for a TEST user. Default session tokens live
// 60 s, so mint one from a JWT template with a longer lifetime for the run, or
// keep the run under a minute. See scripts/load/README.md.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const API = `${BASE_URL}/api/klivo/v1`;
const ORIGIN = __ENV.DASHBOARD_ORIGIN || 'http://localhost:3000';
const TOKEN = __ENV.CLERK_TOKEN;
if (!TOKEN) throw new Error('CLERK_TOKEN is required');

const analyticsMs = new Trend('analytics_ms', true);
const conversationsMs = new Trend('conversations_ms', true);

export const options = {
  scenarios: {
    dashboard: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 30 },  // 30 staff refreshing dashboards
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    analytics_ms: ['p(95)<2500'],      // SQL aggregates over 30 days
    conversations_ms: ['p(95)<1200'],
  },
};

function headers() {
  return { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN, Accept: 'application/json' };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default function () {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const range = `startDate=${isoDate(start)}&endDate=${isoDate(end)}&timezone=Asia/Kolkata`;

  // The overview page fires these in parallel; mirror that with a batch.
  const batch = http.batch([
    ['GET', `${API}/analytics/summary?${range}`, null, { headers: headers(), tags: { name: 'analytics/summary' } }],
    ['GET', `${API}/analytics/charts/conversations?${range}`, null, { headers: headers(), tags: { name: 'analytics/charts/conversations' } }],
    ['GET', `${API}/analytics/handover?${range}`, null, { headers: headers(), tags: { name: 'analytics/handover' } }],
    ['GET', `${API}/analytics/agents?${range}`, null, { headers: headers(), tags: { name: 'analytics/agents' } }],
  ]);
  for (const r of batch) {
    analyticsMs.add(r.timings.duration);
    check(r, { 'analytics 200': (x) => x.status === 200 });
  }

  const conv = http.get(`${API}/conversations?page=1&limit=20`, {
    headers: headers(),
    tags: { name: 'conversations list' },
  });
  conversationsMs.add(conv.timings.duration);
  check(conv, { 'conversations 200': (r) => r.status === 200 });

  sleep(5 + Math.random() * 5);
}
