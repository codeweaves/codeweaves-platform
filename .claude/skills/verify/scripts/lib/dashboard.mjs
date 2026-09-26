// Dashboard sign-in as one of the seeded roles, through the real sign-in form.

import { CliError, URLS, credentials } from './core.mjs';

export const ROLES = ['owner', 'teammate', 'superadmin'];

function userFor(role) {
  if (!ROLES.includes(role)) throw new CliError(`unknown role ${role}`, `one of: ${ROLES.join(', ')}`);
  const user = credentials().users?.[role];
  if (!user) throw new CliError(`no credentials for ${role}`, 'run: cw-verify seed');
  return user;
}

export async function loginAs(page, context, role = 'owner') {
  const user = userFor(role);
  // Start signed out. The persistent profile can hold another user's session,
  // and the sign-in page then redirects away after load. Leave the app first:
  // a still-open dashboard tab re-creates Clerk's cookies from its in-memory
  // dev-browser token, which undoes a plain cookie clear.
  await page.goto('about:blank');
  await context.clearCookies();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: URLS.web, storageTypes: 'all' });
  await cdp.detach().catch(() => {});

  await page.goto(`${URLS.web}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByLabel('Email').fill(user.email, { timeout: 60000 });
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: /sign in|log in|continue/i }).first().click();
  // Clerk dev instances may ask for an email code on a new device.
  // `+clerk_test` addresses accept the fixed code 424242 and send no email.
  const outcome = await Promise.race([
    page.waitForURL('**/dashboard**', { timeout: 60000 }).then(() => 'dashboard'),
    page
      .getByLabel(/code/i)
      .first()
      .waitFor({ timeout: 60000 })
      .then(() => 'code'),
  ]);
  if (outcome === 'code') {
    await page.getByLabel(/code/i).first().fill('424242');
    await page.getByRole('button', { name: /verify|continue|submit/i }).first().click();
    await page.waitForURL('**/dashboard**', { timeout: 60000 });
  }
  // Inspect only: confirm the session belongs to the seeded user.
  const signedInAs = await page
    .waitForFunction(() => window.Clerk?.user?.primaryEmailAddress?.emailAddress, null, { timeout: 15000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  if (signedInAs !== user.email) {
    throw new CliError(`signed in as ${signedInAs ?? 'unknown'}, expected ${user.email}`, 'run: cw-verify seed, then dashboard login again');
  }
  return { role, user: signedInAs, url: page.url(), usedEmailCode: outcome === 'code' };
}
