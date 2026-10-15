import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: 'credentials.env', quiet: true });

const users = JSON.parse(readFileSync(path.resolve('.local/test-users.json'), 'utf8'));
const output = path.resolve('.local/ui');
mkdirSync(output, { recursive: true });
const audits: Record<string, unknown> = {};

test.beforeAll(async () => {
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword(users.moderator);
  if (error || !data.session) throw new Error('The dedicated Moderator test account could not sign in.');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
  const rootUrl = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';
  const snapshot = await fetch(`${rootUrl}/api/app`, { method: 'POST', headers, body: JSON.stringify({ action: 'bootstrap' }) });
  if (!snapshot.ok) throw new Error('Could not inspect previous UI test reports.');
  const { reports } = await snapshot.json();
  for (const report of reports.filter((r: { userId: string; note: string; status: string }) => r.userId === users.driver.id && r.note.startsWith('UI acceptance fixture:') && ['PENDING', 'VERIFIED'].includes(r.status))) {
    const response = await fetch(`${rootUrl}/api/app`, { method: 'POST', headers, body: JSON.stringify({ action: 'report.moderate', reportId: report.id, moderationAction: report.status === 'VERIFIED' ? 'RESOLVE' : 'EXPIRE', expectedRevision: report.revision, reason: 'Close disposable UI verification evidence before the next run.' }) });
    if (!response.ok) throw new Error('Could not close a previous disposable UI test report.');
  }
});

async function capture(page: Page, name: string) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''));
  audits[name] = { seriousOrCritical: violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), checkedRules: result.passes.length };
  writeFileSync(path.resolve('.local/accessibility.json'), JSON.stringify(audits, null, 2));
  expect(violations, `${name} serious/critical accessibility violations`).toEqual([]);
}

async function signIn(page: Page, account = users.driver) {
  await page.goto('/');
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

async function setupVehicle(page: Page) {
  await page.getByRole('button', { name: 'Your vehicle', exact: true }).click();
  await page.getByLabel('Vehicle name', { exact: true }).fill('Journey EV');
  await page.getByLabel('Usable battery capacity (kWh)', { exact: true }).fill('60');
  await page.getByLabel('Energy consumption (kWh per 100 km)', { exact: true }).fill('17.5');
  await page.getByLabel('Reserve state of charge (%)', { exact: true }).fill('20');
  await page.getByLabel('Maximum AC charging power (kW)', { exact: true }).fill('11');
  await page.getByLabel('Maximum DC charging power (kW)', { exact: true }).fill('120');
  await page.getByLabel('Default maximum detour (minutes)', { exact: true }).fill('15');
  await page.getByLabel('Minimum charger power (kW)', { exact: true }).fill('0');
  await page.getByLabel('Maximum walk to destination (metres)', { exact: true }).fill('0');
  await page.getByRole('checkbox', { name: 'CCS2 / Combo 2', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Type 2', exact: true }).check();
  await capture(page, 'D-01-vehicle');
  await page.getByRole('button', { name: 'Save vehicle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan your journey', exact: true })).toBeVisible();
}

async function createExample(page: Page) {
  await page.getByRole('button', { name: 'Demo fixtures', exact: true }).click();
  await page.getByRole('button', { name: 'Use example journey', exact: true }).click();
  await page.getByLabel('Current battery (%)', { exact: true }).fill('18');
  await capture(page, 'D-02-plan');
  await page.getByRole('button', { name: 'Find charging options', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your charging options', exact: true })).toBeVisible();
  await expect(page.locator('.recommendation-card')).toHaveCount(3);
}

test('D-00 account access and keyboard navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await capture(page, 'D-00-account');
  await page.getByLabel('Email address', { exact: true }).focus();
  await page.keyboard.type(users.driver.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(users.driver.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('email registration enters the Driver workspace directly', async ({ page }) => {
  const account = { email: `signup-${Date.now()}@plugplan.test`, password: `Demo1-${randomBytes(18).toString('base64url')}`, role: 'DRIVER', id: '' };
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create Driver account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your vehicle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report review', exact: true })).toHaveCount(0);
  const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: account.email, password: account.password });
  expect(error?.message).toBeUndefined();
  expect(data.user?.id).toBeTruthy();
  account.id = data.user!.id;
  const response = await page.request.post('/api/app', { headers: { Authorization: `Bearer ${data.session!.access_token}` }, data: { action: 'bootstrap' } });
  expect(response.status()).toBe(200);
  expect((await response.json()).user.role).toBe('DRIVER');
  const privateUsers = JSON.parse(readFileSync(path.resolve('.local/test-users.json'), 'utf8'));
  writeFileSync(path.resolve('.local/test-users.json'), JSON.stringify({ ...privateUsers, signupUser: account, reliabilityUser: account }, null, 2));
});

test('D-01 through D-05: vehicle, plan, compare, version, selection and image report', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await signIn(page);
  await setupVehicle(page);
  await createExample(page);
  await capture(page, 'D-03-recommendations');
  await page.getByRole('button', { name: 'Compare options', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Charging recommendations using the same metrics' })).toBeVisible();
  await capture(page, 'D-04-compare');
  await expect(page.getByRole('columnheader')).toHaveCount(4);
  await page.getByRole('button', { name: 'Back to options', exact: true }).click();
  await page.getByRole('button', { name: 'Choose this stop' }).first().click();
  await expect(page.getByRole('button', { name: 'Selected', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cheapest charging', exact: true }).click();
  await expect(page.getByLabel('Plan version')).toContainText('Version 2');
  await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
  await expect(page.getByLabel('Plan version')).toContainText('Version 3');
  await page.getByRole('button', { name: 'Report an issue at this charger', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Report a charger issue', exact: true })).toBeVisible();
  await page.getByLabel('Issue category', { exact: true }).selectOption('BLOCKED_BAY');
  await page.getByLabel('Issue details', { exact: true }).fill('UI acceptance fixture: a cone is blocking the bay. No real-world issue is asserted.');
  await page.locator('#report-photo').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') });
  await capture(page, 'D-05-report');
  await page.getByRole('button', { name: 'Confirm & submit report', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Report a charger issue', exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your reports', exact: true })).toBeVisible();
  await expect(page.locator('.reports-table tbody tr').first()).toContainText('Pending');
  await page.getByRole('button', { name: /^View.*report/ }).first().click();
  await expect(page.getByText('UI acceptance fixture: a cone is blocking the bay. No real-world issue is asserted.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View evidence image', exact: true }).click();
  await expect(page.getByAltText('Photo submitted as evidence for this charger issue')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Saved plans', exact: true }).click();
  await expect(page.locator('.saved-card').first()).toContainText('3 saved versions');
  await page.locator('.saved-card').first().getByRole('button', { name: 'Open plan' }).click();
  await page.getByRole('button', { name: 'Report an issue at this charger', exact: true }).first().click();
  await page.getByLabel('Issue category', { exact: true }).selectOption('BLOCKED_BAY');
  await page.getByLabel('Issue details', { exact: true }).fill('Duplicate UI acceptance fixture; no real issue is asserted.');
  await page.getByRole('button', { name: 'Confirm & submit report', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'An active report already exists', exact: true });
  await expect(duplicate).toBeVisible();
  await expect(duplicate).toContainText('No duplicate was created');
  await expect(duplicate).toContainText('Other reporters’ identities, notes and photos remain private.');
  await duplicate.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Saved plans', exact: true }).click();
  await page.locator('.saved-card').first().getByRole('button', { name: 'Open plan' }).click();
  await page.getByRole('button', { name: 'Report an issue at this charger', exact: true }).first().click();
  await page.getByLabel('Issue details', { exact: true }).fill('Rate-limit acceptance fixture: preserve this note.');
  await page.route('**/api/app', async route => {
    if (route.request().postDataJSON()?.action === 'report.create') await route.fulfill({ status: 429, json: { error: 'Too many issue reports were submitted.', retryAfter: 120 } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Confirm & submit report', exact: true }).click();
  const reportDialog = page.getByRole('dialog', { name: 'Report a charger issue', exact: true });
  await expect(reportDialog).toBeVisible();
  await expect(reportDialog.getByText(/You can submit again at .* SGT\./)).toBeVisible();
  await expect(page.getByLabel('Issue details', { exact: true })).toHaveValue('Rate-limit acceptance fixture: preserve this note.');
  await page.locator('#report-photo').setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg></svg>') });
  await expect(reportDialog.getByText('Choose a JPEG, PNG or WebP image no larger than 5 MB.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Issue details', { exact: true })).toHaveValue('Rate-limit acceptance fixture: preserve this note.');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
});

test('D-06 moderator review and reasoned decision', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await signIn(page, users.moderator);
  await expect(page.getByRole('heading', { name: 'Report review', exact: true })).toBeVisible();
  const row = page.locator('.reports-table tbody tr').filter({ hasText: 'Blocked charging bay' }).filter({ hasText: 'Pending' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Review/ }).click();
  await page.getByLabel('Decision reason', { exact: true }).fill('Acceptance verification: synthetic blocked-bay evidence reviewed.');
  await capture(page, 'D-06-moderator');
  await page.getByRole('button', { name: 'Record decision', exact: true }).click();
  await expect(page.locator('.report-detail-head .status-badge')).toHaveText('Verified');
  await expect(page.locator('.audit-timeline')).toContainText('Acceptance verification');
});

test('M-01 and M-02 responsive planning and recommendations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole('button', { name: 'Plan a journey', exact: true }).click();
  await page.getByRole('button', { name: 'Demo fixtures', exact: true }).click();
  await page.getByRole('button', { name: 'Use example journey', exact: true }).click();
  await capture(page, 'M-01-plan');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Find charging options', exact: true }).click();
  await expect(page.locator('.recommendation-card')).toHaveCount(3);
  await capture(page, 'M-02-recommendations');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('unsaved changes confirm and logout invalidates the API session', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Your vehicle', exact: true }).click();
  await page.getByLabel('Vehicle name', { exact: true }).fill('Unsaved name');
  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: 'Saved plans', exact: true }).click();
  await expect(page.getByLabel('Vehicle name', { exact: true })).toHaveValue('Unsaved name');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Saved plans', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved plans', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('keyboard-only plan search, comparison and issue dialog', async ({ page }) => {
  await signIn(page);
  async function tabTo(target: ReturnType<Page['getByRole']>, key = 'Tab') {
    for (let step = 0; step < 90; step++) {
      if (await target.evaluate(el => el === document.activeElement)) return;
      await page.keyboard.press(key);
    }
    throw new Error('Keyboard focus could not reach the requested control.');
  }
  await tabTo(page.getByRole('button', { name: 'Demo fixtures', exact: true }));
  await page.keyboard.press('Enter');
  await tabTo(page.getByLabel('Starting from', { exact: true }));
  await page.keyboard.type('Marina');
  await expect(page.getByRole('option').filter({ hasText: 'Marina Bay' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Going to', { exact: true })).toBeFocused();
  await page.keyboard.type('Orchard');
  await expect(page.getByRole('option').filter({ hasText: 'Orchard' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await tabTo(page.getByRole('button', { name: 'Find charging options', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.locator('.recommendation-card')).toHaveCount(3);
  await tabTo(page.getByRole('button', { name: 'Compare options', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table', { name: 'Charging recommendations using the same metrics' })).toBeVisible();
  await tabTo(page.getByRole('button', { name: 'Back to options', exact: true }));
  await page.keyboard.press('Enter');
  await tabTo(page.getByRole('button', { name: 'Report an issue at this charger', exact: true }).first());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Report a charger issue' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Report an issue at this charger', exact: true }).first()).toBeFocused();
});

test('unsaved locations are cleared on reload', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Starting from', { exact: true }).fill('Unsaved private location 71429');
  const retained = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('Unsaved private location 71429')));
  expect(retained).toBe(false);
  page.once('dialog', d => d.accept());
  await page.reload();
  await expect(page.getByLabel('Starting from', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Going to', { exact: true })).toHaveValue('');
});
