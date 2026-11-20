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

const firmA = ['Firm A', 'Asha Singh', '12 Yamuna Road\nAgra, Uttar Pradesh', '09ABCDE1234F1Z5'];
const firmB = ['Firm B', 'Bina Shah', '84 Station Road\nNew Delhi, Delhi', '07FGHIJ6789K1Z2'];
const firmFields = ['Firm name', 'Owner', 'Address', 'GSTIN'];

async function pressButton(page, name) {
  await page.getByRole('button', { name, exact: true }).focus();
  await page.keyboard.press('Enter');
}

async function fillFirm(page, details) {
  for (const [index, label] of firmFields.entries()) {
    await page.getByLabel(label, { exact: true }).fill(details[index]);
  }
}

async function checkFirm(page, details) {
  const actual = await Promise.all(firmFields.map(label => page.getByLabel(label, { exact: true }).inputValue()));
  assert.deepEqual(actual, details);
}

async function activeFirm(page, name) {
  await page.waitForFunction(expected => {
    const select = document.querySelector('#active-firm');
    return select?.selectedOptions[0]?.textContent === expected && select.getAttribute('aria-disabled') === 'false';
  }, name);
}

async function trialTotals(page, amount) {
  const trial = page.getByRole('table', { name: 'Trial balance' });
  await trial.waitFor();
  assert.deepEqual(await trial.locator('tfoot td').allTextContents(), [amount, amount]);
}

async function exercisePayment(page, save, back, forward) {
  await choosePage(page, 'Reports');
  await trialTotals(page, '₹21,98,000');
  await choosePage(page, 'Vouchers');
  await pressButton(page, 'New voucher');
  const type = page.getByLabel('Voucher type', { exact: true });
  await type.waitFor();
  assert.equal(await type.evaluate(input => input === document.activeElement), true);
  assert.equal(await type.inputValue(), 'Payment');
  await page.getByLabel('Voucher date').fill('2026-11-20');
  await page.getByLabel('Narration', { exact: true }).focus();
  await page.keyboard.type('Phase 3 sample payment');
  await page.keyboard.press('Enter');
  const debit = page.getByRole('group', { name: 'Line 1', exact: true });
  const credit = page.getByRole('group', { name: 'Line 2', exact: true });
  assert.equal(await debit.getByLabel('Account', { exact: true }).evaluate(input => input === document.activeElement), true);
  await debit.getByLabel('Account', { exact: true }).selectOption({ label: 'Anuj Kumar · Contractor' });
  await credit.getByLabel('Account', { exact: true }).selectOption({ label: 'HDFC Bank · Bank' });
  for (const row of [debit, credit]) {
    await row.getByLabel('Amount (₹)').fill('5000.25');
    await row.getByLabel('Site', { exact: true }).selectOption({ label: 'Yamuna' });
  }
  await page.keyboard.press(save);
  await page.getByText('Voucher posted.', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Payment #41', exact: true }).waitFor();
  assert.deepEqual(await page.getByRole('table', { name: 'Posting lines' }).locator('tfoot td').allTextContents(), ['₹5,000.25', '₹5,000.25']);

  await pressButton(page, 'Day book');
  await pressButton(page, '#41');
  await page.getByRole('heading', { name: 'Payment #41', exact: true }).waitFor();
  await pressButton(page, 'Trial balance');
  await trialTotals(page, '₹21,92,999.75');
  await pressButton(page, 'Anuj Kumar');
  await page.getByRole('heading', { name: 'Anuj Kumar ledger', exact: true }).waitFor();
  await page.getByLabel('Site', { exact: true }).selectOption({ label: 'Yamuna' });
  await pressButton(page, 'Apply filters');
  await page.getByText('−₹12,999.75', { exact: true }).first().waitFor();
  await pressButton(page, '#41');
  await page.getByRole('heading', { name: 'Payment #41', exact: true }).waitFor();
  await page.keyboard.press(back);
  await page.getByRole('heading', { name: 'Anuj Kumar ledger', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Site', { exact: true }).inputValue(), '1');
  assert.equal(await page.getByRole('button', { name: '#41', exact: true }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press(forward);
  await page.getByRole('heading', { name: 'Payment #41', exact: true }).waitFor();

  await pressButton(page, 'Reverse voucher');
  await page.getByLabel('Reversal date').fill('2026-11-21');
  await page.getByLabel('Reversal reason').fill('Sample correction');
  await page.keyboard.press(save);
  await page.getByText('Reversal posted.', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Reversal #42', exact: true }).waitFor();
  await pressButton(page, 'voucher #41');
  await pressButton(page, 'voucher #42');
  await page.getByRole('heading', { name: 'Reversal #42', exact: true }).waitFor();
  await pressButton(page, 'Trial balance');
  await trialTotals(page, '₹21,98,000');
}

async function exerciseOpening(page, save) {
  await choosePage(page, 'Vouchers');
  await page.getByText('No vouchers for this period.').waitFor();
  await pressButton(page, 'Chart of accounts');
  for (const [name, kind] of [['Firm A bank', 'bank'], ['Firm A cash', 'cash']]) {
    await pressButton(page, 'New account');
    const field = page.getByLabel('Account name', { exact: true });
    await field.waitFor();
    assert.equal(await field.evaluate(input => input === document.activeElement), true);
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.getByLabel('Account type', { exact: true }).selectOption(kind);
    await page.keyboard.press(save);
    await page.getByText('Account saved.', { exact: true }).waitFor();
  }
  await pressButton(page, 'Day book');
  await pressButton(page, 'New voucher');
  await page.getByLabel('Voucher type').selectOption('Opening balance');
  await page.getByLabel('Voucher date').fill('2026-11-20');
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Firm A bank · Bank' });
  await page.getByLabel('Amount (₹)').fill('75.10');
  await page.keyboard.press(save);
  await page.getByText('Voucher posted.', { exact: true }).waitFor();
  await pressButton(page, 'Trial balance');
  await trialTotals(page, '₹75.10');
}

try {
  let page = await launch();
  await heading(page, 'SP & Company');
  assert.match(await page.locator('footer').innerText(), /Offline/);
  assert.deepEqual(await page.evaluate(() => ({ bridge: Object.keys(window.workspaces).sort(), require: typeof window.require })),
    { bridge: ['createAccount', 'getChart', 'getDayBook', 'getLedger', 'getTrialBalance', 'getVoucher', 'isMac',
      'postVoucher', 'read', 'removeFirm', 'reverseVoucher', 'saveFirm', 'saveName', 'selectFirm'], require: 'undefined' });
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
  await exercisePayment(page, save, back, forward);
  const demoName = await settings(page, 'SP & Company Demo');
  await demoName.fill('Training books');
  await page.keyboard.press(save);
  await page.getByText('Workspace settings saved.').waitFor();
  await choosePage(page, 'Firms');
  await heading(page, 'Firms');
  await pressButton(page, 'New firm');
  const nameField = page.getByLabel('Firm name', { exact: true });
  assert.equal(await nameField.evaluate(input => input === document.activeElement), true);
  await page.keyboard.type(firmA[0]);
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Owner', { exact: true }).evaluate(input => input === document.activeElement), true);
  await fillFirm(page, firmA);
  await page.keyboard.press(save);
  await page.getByText('Firm saved.', { exact: true }).waitFor();
  await pressButton(page, 'New firm');
  await fillFirm(page, firmB);
  await page.keyboard.press(save);
  await page.getByText('Firm saved.', { exact: true }).waitFor();

  await pressButton(page, 'Edit Firm A');
  await checkFirm(page, firmA);
  firmA[1] = 'Asha Mehta';
  await page.getByLabel('Owner', { exact: true }).fill(firmA[1]);
  await page.keyboard.press(save);
  await page.getByText('Firm saved.', { exact: true }).waitFor();
  await pressButton(page, 'Edit Firm A');
  await checkFirm(page, firmA);
  await page.keyboard.press('Escape');

  await pressButton(page, 'New firm');
  await page.getByLabel('Firm name', { exact: true }).fill('Unused firm');
  await page.keyboard.press(save);
  await page.getByText('Firm saved.', { exact: true }).waitFor();
  await pressButton(page, 'Edit Unused firm');
  await pressButton(page, 'Remove firm');
  assert.equal(await page.getByRole('button', { name: 'Keep firm' }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.getByText('Firm deleted.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Edit Unused firm' }).count(), 0);

  await choosePage(page, 'Overview');
  await heading(page, 'Training books');
  await activeFirm(page, 'SP & Company');
  await page.keyboard.press('Shift+Tab');
  const firmSwitcher = page.getByLabel('Active firm', { exact: true });
  assert.equal(await firmSwitcher.evaluate(select => select === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  await activeFirm(page, 'Firm A');
  await exerciseOpening(page, save);
  await firmSwitcher.focus();
  await page.keyboard.press('ArrowDown');
  await activeFirm(page, 'Firm B');
  await page.getByText('Prototype vouchers').waitFor({ state: 'hidden' });

  await choosePage(page, 'Firms');
  await pressButton(page, 'Edit SP & Company');
  await pressButton(page, 'Remove firm');
  await pressButton(page, 'Confirm removal');
  await page.getByText('Firm archived. Its records are still available.').waitFor();
  await activeFirm(page, 'Firm B');
  assert.deepEqual(await firmSwitcher.getByRole('option').allTextContents(), ['Firm A', 'Firm B']);
  await pressButton(page, 'Edit SP & Company');
  const history = page.getByRole('region', { name: 'Archived firm history' });
  assert.deepEqual(await history.locator('.balances dd').allTextContents(), ['40', '₹21,98,000', '₹21,98,000']);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await heading(page, 'Office books');
  await activeFirm(page, 'No firm selected');
  assert.equal(await page.getByText('Prototype vouchers').count(), 0);
  await app.close();
  app = undefined;

  page = await launch();
  await heading(page, 'Office books');
  await settings(page, 'Office books');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await heading(page, 'Training books');
  await activeFirm(page, 'Firm B');
  await settings(page, 'Training books');
  await choosePage(page, 'Firms');
  await pressButton(page, 'Edit Firm B');
  await checkFirm(page, firmB);
  await page.keyboard.press('Escape');
  await pressButton(page, 'Edit Firm A');
  await checkFirm(page, firmA);
  await page.keyboard.press('Escape');
  await pressButton(page, 'Edit SP & Company');
  await pressButton(page, 'Open archived books');
  await page.getByText('SP & Company · Archived books').waitFor();
  assert.equal(await page.getByRole('button', { name: 'New voucher', exact: true }).count(), 0);
  await pressButton(page, '#42');
  await page.getByRole('heading', { name: 'Reversal #42', exact: true }).waitFor();
  await pressButton(page, 'voucher #41');
  await page.getByText('2026-11-20 · Phase 3 sample payment', { exact: true }).waitFor();
  assert.deepEqual((await readdir(join(profile, 'workspaces'))).filter(name => name.endsWith('.sqlite3')).sort(), ['demo.sqlite3', 'live.sqlite3']);
  console.log('Desktop smoke passed: offline workspace and firm persistence, keyboard account setup, opening balance, payment, day book and trial balance drill-down, ledger filter and focus restoration, and linked reversal after restart.');
} finally {
  try {
    if (app) await app.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
