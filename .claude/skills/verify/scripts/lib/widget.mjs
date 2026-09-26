// The embeddable widget, driven through its accessible roles.
//
// The widget renders in an open shadow root (ADR-0003). Playwright role
// locators pierce it. Messages are role="article" inside role="log", labelled
// by author, so nothing here depends on styling classes.

import { CliError, URLS, resolveAgent } from './core.mjs';

const AUTHORS = {
  'Your message': 'visitor',
  'AI agent message': 'agent',
  'Team member message': 'human',
};

function dialog(page) {
  return page.getByRole('dialog').first();
}

export async function readMessages(page) {
  const items = dialog(page).getByRole('log', { name: 'Conversation' }).getByRole('article');
  const count = await items.count();
  const messages = [];
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const label = await item.getAttribute('aria-label');
    // The bubble text is the first paragraph-level text; meta lines (author,
    // timestamp) follow it. `.cw-message-text` is the widget's own theming hook.
    const text = (await item.locator('.cw-message-text').first().textContent())?.trim() ?? '';
    messages.push({ from: AUTHORS[label] ?? label, text });
  }
  return messages;
}

async function inputState(page) {
  const box = dialog(page).getByRole('textbox');
  const disabled = (await box.count()) ? await box.first().isDisabled() : true;
  const alerts = await dialog(page).getByRole('alert').allInnerTexts();
  return { disabled, alert: alerts.find((a) => a.trim())?.trim() ?? null };
}

export async function openWidget(page, agentRef = 'chat') {
  const agent = resolveAgent(agentRef);
  await page.goto(`${URLS.host}/?agent=${agent.publicId}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.getByRole('button', { name: 'Open chat widget' }).click({ timeout: 30000 });
  } catch {
    // The widget renders nothing when its config cannot load. Say why.
    const url = `${URLS.api}/public/agents/${agent.publicId}/config`;
    const status = await fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.status)
      .catch(() => 0);
    const reason = status === 0 ? 'the API is unreachable' : `the config endpoint returned HTTP ${status}`;
    throw new CliError(`widget launcher never appeared: ${reason}`, status === 0 ? 'run: cw-verify doctor' : `GET ${url}`, { agent, configStatus: status });
  }
  await dialog(page).waitFor({ timeout: 15000 });
  const consentRequired = await dialog(page).getByRole('region', { name: 'Privacy notice' }).isVisible().catch(() => false);
  return {
    agent,
    dialog: await dialog(page).getAttribute('aria-label'),
    consentRequired,
    messages: await readMessages(page),
  };
}

export async function grantConsent(page) {
  await dialog(page).getByRole('region', { name: 'Privacy notice' }).getByRole('button').click({ timeout: 10000 });
  await dialog(page).getByRole('textbox').waitFor({ timeout: 10000 });
  return { granted: true };
}

// Sends a message and waits for one of three end states: a bot reply that
// stopped growing, a visible alert, or the input re-enabled with no reply. The
// last one is a real product outcome (a failed LLM call renders nothing), so
// it is returned as `no-reply` instead of waiting out the timeout.
export async function sendMessage(page, text, { timeout = 60000 } = {}) {
  const before = (await readMessages(page)).length;
  const start = Date.now();
  await dialog(page).getByRole('textbox').fill(text, { timeout: 15000 });
  await page.getByRole('button', { name: 'Send message' }).click();
  let firstTokenMs = null;
  let idleSince = null;
  let previous = null;
  let outcome = 'timeout';
  let alert = null;
  while (Date.now() - start < timeout) {
    const messages = await readMessages(page);
    const last = messages[messages.length - 1];
    const state = await inputState(page);
    const replied = messages.length >= before + 2 && last && last.from !== 'visitor' && last.text !== '';
    if (replied && firstTokenMs === null) firstTokenMs = Date.now() - start;
    if (state.alert) {
      outcome = 'alert';
      alert = state.alert;
      break;
    }
    if (replied && !state.disabled && last.text === previous) {
      outcome = 'replied';
      break;
    }
    if (!replied && !state.disabled && messages.length >= before + 1) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 4000) {
        outcome = 'no-reply';
        break;
      }
    } else idleSince = null;
    previous = last?.text ?? null;
    await page.waitForTimeout(250);
  }
  const messages = await readMessages(page);
  const reply = outcome === 'replied' ? messages[messages.length - 1].text : null;
  return { sent: text, outcome, firstTokenMs, replyMs: Date.now() - start, reply, alert, messages };
}

// `onlyNew` ignores messages already on screen when the wait starts, so an
// existing greeting or earlier reply can never satisfy it.
export async function waitForMessage(page, { from, contains, onlyNew = false, timeout = 15000 }) {
  const start = Date.now();
  const skip = onlyNew ? (await readMessages(page)).length : 0;
  while (Date.now() - start < timeout) {
    const messages = await readMessages(page);
    const hit = messages.slice(skip).find((m) => (!from || m.from === from) && (!contains || m.text.includes(contains)));
    if (hit) return { ms: Date.now() - start, message: hit, messages };
    await page.waitForTimeout(250);
  }
  throw new CliError(`no ${from ?? 'any'} message containing "${contains ?? ''}" within ${timeout}ms`, 'check browser events for websocket and poll traffic', {
    messages: await readMessages(page),
  });
}

export async function closeWidget(page) {
  await page.getByRole('button', { name: 'Close chat' }).click({ timeout: 10000 });
  return { closed: true };
}
