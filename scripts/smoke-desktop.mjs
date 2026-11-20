import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const target = process.argv[2];
if (!target) throw new Error('Pass the path to the packaged executable, or . for the development build.');
const profile = await mkdtemp(join(tmpdir(), 'sp-accounts-desktop-'));
const args = [`--user-data-dir=${profile}`, '--proxy-server=http://127.0.0.1:9'];
let app;

async function launch() {
  app = await electron.launch(target === '.'
    ? { args: ['.', ...args], timeout: 20_000 }
    : { executablePath: resolve(target), args, timeout: 20_000 });
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(7_000);
  await page.context().setOffline(true);
  return page;
}

async function heading(page, name) {
  await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
}

async function choosePage(page, name) {
  const button = page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
}

async function settings(page, name) {
  await choosePage(page, 'Workspace settings');
  const field = page.getByLabel('Workspace name', { exact: true });
  await field.waitFor();
  assert.equal(await field.inputValue(), name);
  return field;
}

try {
  let page = await launch();
  await heading(page, 'SP & Company');
  assert.match(await page.locator('footer').innerText(), /Offline/);
  assert.deepEqual(await page.evaluate(() => ({ bridge: Object.keys(window.workspaces).sort(), require: typeof window.require })),
    { bridge: ['isMac', 'read', 'saveName'], require: 'undefined' });
  assert.equal(await page.evaluate(() => window.workspaces.read('../live').then(() => false, () => true)), true);
  assert.equal(await page.evaluate(() => window.workspaces.saveName('live', '   ').then(() => false, () => true)), true);
  assert.equal(await page.getByText('Prototype vouchers').count(), 0);

  const mac = process.platform === 'darwin';
  const back = mac ? 'Meta+BracketLeft' : 'Alt+ArrowLeft';
  const forward = mac ? 'Meta+BracketRight' : 'Alt+ArrowRight';
  const save = mac ? 'Meta+s' : 'Control+s';
  const liveName = await settings(page, 'SP & Company');
  await page.keyboard.press('Tab');
  assert.equal(await liveName.evaluate(input => input === document.activeElement), true);
  await liveName.fill('Office books');
  await liveName.evaluate(input => input.setSelectionRange(1, 5));
  await choosePage(page, 'Firms');
  await heading(page, 'Firms');
  await page.keyboard.press(back);
  await heading(page, 'Workspace settings');
  assert.deepEqual(await liveName.evaluate(input => [input === document.activeElement, input.selectionStart, input.selectionEnd]), [true, 1, 5]);
  await page.keyboard.press(forward);
  await heading(page, 'Firms');
  assert.equal(await page.locator('#page-title').evaluate(title => title === document.activeElement), true);
  await page.getByRole('button', { name: /^Back / }).click();
  assert.equal(await liveName.evaluate(input => input === document.activeElement), true);
  await page.keyboard.press(save);
  await page.getByText('Workspace settings saved.').waitFor();

  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await heading(page, 'SP & Company Demo');
  await page.getByText('Prototype vouchers').waitFor();
  assert.deepEqual(await page.locator('.balances dd').allTextContents(), ['40', '₹21,98,000', '₹21,98,000']);
  const demoName = await settings(page, 'SP & Company Demo');
  await demoName.fill('Training books');
  await page.keyboard.press(save);
  await page.getByText('Workspace settings saved.').waitFor();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await heading(page, 'Office books');
  assert.equal(await page.getByText('Prototype vouchers').count(), 0);
  await app.close();
  app = undefined;

  page = await launch();
  await heading(page, 'Office books');
  await settings(page, 'Office books');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await heading(page, 'Training books');
  await page.getByText('Prototype vouchers').waitFor();
  await settings(page, 'Training books');
  assert.deepEqual((await readdir(join(profile, 'workspaces'))).filter(name => name.endsWith('.sqlite3')).sort(), ['demo.sqlite3', 'live.sqlite3']);
  console.log('Desktop smoke passed: keyboard history and focus, restricted bridge, offline restart, separate live and seeded demo files.');
} finally {
  try {
    if (app) await app.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
