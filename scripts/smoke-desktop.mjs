import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';
import { utils, write } from 'xlsx';

const execFileAsync = promisify(execFile);
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

async function typeField(page, label, value, scope = page) {
  await scope.getByLabel(label, { exact: true }).focus();
  await page.keyboard.type(value);
}

async function chooseOption(page, label, option, scope = page) {
  const select = scope.getByLabel(label, { exact: true });
  await select.focus();
  const options = await select.locator('option').allTextContents();
  const destination = options.indexOf(option);
  assert.notEqual(destination, -1, option);
  const current = await select.evaluate(input => input.selectedIndex);
  const direction = destination > current ? 'ArrowDown' : 'ArrowUp';
  for (let step = 0; step < Math.abs(destination - current); step++) await page.keyboard.press(direction);
  assert.equal(await select.evaluate(input => input.selectedOptions[0]?.textContent), option);
}

async function contractorSummary(page, amounts) {
  await page.getByRole('heading', { name: 'Anuj ledger', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.books .balances dd').allTextContents(), amounts);
}

async function postedVoucher(page, kind) {
  await page.getByText('Voucher posted.', { exact: true }).waitFor();
  const title = await page.getByRole('heading', { name: new RegExp('^' + kind + ' #') }).innerText();
  return title.slice(kind.length + 1);
}

async function exerciseContractors(page, save, back, forward) {
  await choosePage(page, 'Contractors');
  await pressButton(page, 'New contractor');
  const name = page.getByLabel('Contractor name', { exact: true });
  assert.equal(await name.evaluate(input => input === document.activeElement), true);
  await page.keyboard.type('Anuj');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('New sites (comma-separated)').evaluate(input => input === document.activeElement), true);
  await page.keyboard.type('Yamuna, Bodla');
  await page.keyboard.press(save);
  await page.getByText('Contractor saved.', { exact: true }).waitFor();
  await pressButton(page, 'Pay contractor');
  await page.getByRole('heading', { name: 'Pay contractor · Anuj' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Anuj ledger' }).waitFor();
  await pressButton(page, 'Pay contractor');
  await chooseOption(page, 'Pay from', 'Firm A bank · Bank');
  await typeField(page, 'Narration', 'Anuj two-site payment');
  await page.keyboard.press('Enter');
  const first = page.getByRole('group', { name: 'Allocation 1', exact: true });
  const second = page.getByRole('group', { name: 'Allocation 2', exact: true });
  assert.equal(await first.getByLabel('Site', { exact: true }).evaluate(input => input === document.activeElement), true);
  await chooseOption(page, 'Site', 'Yamuna', first);
  await typeField(page, 'Amount (₹)', '30000', first);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Add site split' }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await second.getByLabel('Site', { exact: true }).evaluate(input => input === document.activeElement), true);
  await chooseOption(page, 'Site', 'Bodla', second);
  await typeField(page, 'Amount (₹)', '10000', second);
  await page.keyboard.press(save);
  const payment = await postedVoucher(page, 'Payment');
  const postings = page.getByRole('table', { name: 'Posting lines' });
  assert.deepEqual(await postings.locator('tbody tr').allTextContents(), [
    'AnujYamuna₹30,000—', 'AnujBodla₹10,000—', 'Firm A bank——₹40,000',
  ]);
  await pressButton(page, 'Firm A bank');
  const bank = page.getByRole('table', { name: 'Account ledger' });
  await bank.waitFor();
  assert.equal(await bank.getByRole('button', { name: payment, exact: true }).count(), 1);
  const bankAmounts = await bank.getByRole('row').filter({ hasText: 'Anuj two-site payment' }).locator('td.book-amount').allTextContents();
  assert.deepEqual(bankAmounts.slice(0, 2), ['—', '₹40,000']);
  await page.keyboard.press(back);
  await page.getByRole('heading', { name: 'Payment ' + payment, exact: true }).waitFor();
  await page.keyboard.press(back);
  await contractorSummary(page, ['₹40,000', '₹0', '₹40,000', '₹40,000']);

  await pressButton(page, 'Receive money');
  await chooseOption(page, 'Receive into', 'Firm A cash · Cash');
  await typeField(page, 'Narration', 'Bodla cash returned');
  await chooseOption(page, 'Site', 'Bodla', first);
  await typeField(page, 'Amount (₹)', '2000', first);
  await page.keyboard.press(save);
  const receipt = await postedVoucher(page, 'Receipt');
  await page.keyboard.press(back);
  const amounts = ['₹40,000', '₹2,000', '₹38,000', '₹38,000'];
  await contractorSummary(page, amounts);
  const movements = page.getByRole('table', { name: 'Contractor transactions' });
  const chronological = await movements.locator('tbody tr').allTextContents();
  assert.match(chronological[0], /YamunaBank₹30,000—₹30,000$/);
  assert.match(chronological[1], /BodlaBank₹10,000—₹40,000$/);
  assert.match(chronological[2], /BodlaCash—₹2,000₹38,000$/);

  await pressButton(page, 'By site');
  const siteTotals = page.getByRole('table', { name: 'Contractor sites' });
  await siteTotals.waitFor();
  const bySite = await siteTotals.locator('tbody tr').allTextContents();
  assert.deepEqual(bySite, ['Bodla₹10,000₹2,000₹8,000₹8,000', 'Yamuna₹30,000₹0₹30,000₹30,000']);
  await pressButton(page, 'Bodla');
  await page.getByRole('heading', { name: 'Bodla ledger', exact: true }).waitFor();
  assert.equal(await movements.locator('tbody tr').count(), 2);
  assert.match((await movements.locator('tbody tr').allTextContents())[1], /Cash—₹2,000₹8,000$/);
  await pressButton(page, receipt);
  await page.getByRole('heading', { name: 'Receipt ' + receipt, exact: true }).waitFor();
  await page.keyboard.press(back);
  await page.getByRole('heading', { name: 'Bodla ledger', exact: true }).waitFor();
  assert.equal(await movements.getByRole('button', { name: receipt, exact: true }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press(forward);
  await page.getByRole('heading', { name: 'Receipt ' + receipt, exact: true }).waitFor();
  await page.keyboard.press(back);
  await pressButton(page, payment);
  await page.getByRole('heading', { name: 'Payment ' + payment, exact: true }).waitFor();

  await choosePage(page, 'Contractors');
  await pressButton(page, 'New contractor');
  await typeField(page, 'Contractor name', 'Ravi');
  await page.getByRole('checkbox', { name: 'Yamuna', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press(save);
  await page.getByText('Contractor saved.', { exact: true }).waitFor();
  await choosePage(page, 'Contractors');
  const search = page.getByLabel('Search by contractor or site');
  await typeField(page, 'Search by contractor or site', 'Yamuna');
  const directory = page.getByRole('table', { name: 'Contractor directory' });
  assert.deepEqual(await directory.getByRole('button').allTextContents(), ['Anuj', 'Ravi']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await directory.getByRole('button', { name: 'Ravi' }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await contractorSummary(page, amounts);
  await pressButton(page, 'By site');
  await siteTotals.waitFor();
  assert.deepEqual(await siteTotals.locator('tbody tr').allTextContents(), bySite);
  await pressButton(page, 'Yamuna');
  await page.getByRole('heading', { name: 'Yamuna ledger', exact: true }).waitFor();
  await pressButton(page, payment);
  await page.getByRole('heading', { name: 'Payment ' + payment, exact: true }).waitFor();
  await page.keyboard.press(back);
  await page.keyboard.press(back);
  await page.keyboard.press(back);
  await page.keyboard.press(back);
  await directory.waitFor();
  assert.equal(await search.inputValue(), 'Yamuna');
  assert.equal(await directory.getByRole('button', { name: 'Anuj', exact: true }).evaluate(button => button === document.activeElement), true);
  await search.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type('ravi');
  assert.deepEqual(await directory.getByRole('button').allTextContents(), ['Ravi']);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Ravi ledger', exact: true }).waitFor();
  await pressButton(page, 'Edit contractor');
  await pressButton(page, 'Remove contractor');
  assert.equal(await page.getByRole('button', { name: 'Keep contractor' }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.getByText('Contractor deleted.', { exact: true }).waitFor();
  assert.equal(await directory.getByRole('button', { name: 'Ravi' }).count(), 0);

  await choosePage(page, 'Vouchers');
  await pressButton(page, 'Chart of accounts');
  await pressButton(page, 'New account');
  await typeField(page, 'Account name', 'Contract work');
  await chooseOption(page, 'Account type', 'Expense');
  await page.keyboard.press(save);
  await page.getByText('Account saved.', { exact: true }).waitFor();
  await choosePage(page, 'Contractors');
  await pressButton(page, 'Anuj');
  await pressButton(page, 'Record settlement');
  await chooseOption(page, 'Offset account', 'Contract work · Expense');
  await typeField(page, 'Narration', 'Agreed Yamuna work');
  await chooseOption(page, 'Site', 'Yamuna', first);
  await typeField(page, 'Amount (₹)', '30000', first);
  await page.keyboard.press(save);
  const settlement = await postedVoucher(page, 'Journal');
  assert.deepEqual(await postings.locator('tbody tr').allTextContents(), ['AnujYamuna—₹30,000', 'Contract work—₹30,000—']);
  await page.keyboard.press(back);
  await contractorSummary(page, ['₹40,000', '₹2,000', '₹38,000', '₹8,000']);
  assert.match((await movements.locator('tbody tr').allTextContents()).at(-1), /YamunaNoncash——₹8,000$/);

  await pressButton(page, 'Edit contractor');
  await name.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' Kumar');
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Anuj Kumar ledger', exact: true }).waitFor();
  await pressButton(page, 'Edit contractor');
  await pressButton(page, 'Remove contractor');
  await pressButton(page, 'Confirm removal');
  await page.getByText('Contractor archived. Its ledger is still available.', { exact: true }).waitFor();
  await pressButton(page, 'Anuj Kumar');
  await page.getByText('Archived records', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pay contractor' }).count(), 0);
  return settlement;
}

async function exerciseCashbooks(page, save, back, forward) {
  await choosePage(page, 'Firms');
  await pressButton(page, 'New firm');
  await fillFirm(page, ['Vikram Enterprises', 'Vikram', '', '']);
  await page.keyboard.press(save);
  await page.getByText('Firm saved.', { exact: true }).waitFor();
  await activeFirm(page, 'Firm A');

  await choosePage(page, 'Vouchers');
  await pressButton(page, 'Chart of accounts');
  await pressButton(page, 'New account');
  await typeField(page, 'Account name', 'Site supplies');
  await chooseOption(page, 'Account type', 'Expense');
  await page.keyboard.press(save);
  await page.getByText('Account saved.', { exact: true }).waitFor();

  const bookHeading = name => page.getByRole('heading', { name, exact: true }).waitFor();
  const history = page.getByRole('table', { name: 'Cashbook history' });
  const balances = () => page.locator('.book-balances dd').allTextContents();
  for (const [name, custodian, amount] of [['Office cash', 'Office accountant', '20000'], ['Site cash', 'Vikram', '0']]) {
    await choosePage(page, 'Cashbooks');
    await pressButton(page, 'New cashbook');
    const field = page.getByLabel('Cashbook name', { exact: true });
    assert.equal(await field.evaluate(input => input === document.activeElement), true);
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Custodian', { exact: true }).evaluate(input => input === document.activeElement), true);
    await page.keyboard.type(custodian);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await field.evaluate(input => input === document.activeElement), true);
    await page.getByLabel('Opening date', { exact: true }).fill('2026-11-17');
    await page.getByLabel('Opening cash (₹)', { exact: true }).fill(amount);
    await page.keyboard.press(save);
    await bookHeading(name);
    await page.getByText('Funding firm Firm A', { exact: true }).waitFor();
    assert.deepEqual(await balances(), [amount === '0' ? '₹0' : '₹20,000', '₹20,000']);
    if (amount === '0') await page.getByText('No transactions for this date range.', { exact: true }).waitFor();
    else assert.match(await history.locator('tbody').innerText(), /Opening balance[\s\S]*2026-11-17[\s\S]*₹20,000/);
  }

  await pressButton(page, 'Record handover');
  await bookHeading('Record handover · Site cash');
  await page.keyboard.press('Escape');
  await bookHeading('Site cash');
  await pressButton(page, 'Record handover');
  const date = page.getByLabel('Voucher date', { exact: true });
  assert.equal(await date.evaluate(input => input === document.activeElement), true);
  await date.fill('2026-11-18');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Cash from', { exact: true }).evaluate(input => input === document.activeElement), true);
  await chooseOption(page, 'Cash from', 'Office cash');
  await typeField(page, 'Amount (₹)', '10000');
  await typeField(page, 'Purpose', 'Cash handed to Vikram');
  await page.keyboard.press(save);
  const handover = await postedVoucher(page, 'Contra');
  await page.keyboard.press(back);
  await bookHeading('Site cash');
  assert.deepEqual(await balances(), ['₹10,000', '₹20,000']);

  await pressButton(page, 'Record payment');
  await date.fill('2026-11-19');
  await chooseOption(page, 'Payment type', 'Pay a firm');
  await chooseOption(page, 'Payee firm', 'Vikram Enterprises (owner: Vikram)');
  await chooseOption(page, 'Debit account', 'Site supplies · Expense');
  await typeField(page, 'Amount (₹)', '6500');
  await typeField(page, 'Purpose', 'Site materials');
  await page.keyboard.press(save);
  const payment = await postedVoucher(page, 'Payment');
  const payee = 'Payee Vikram Enterprises (owner: Vikram)';
  await page.getByText(payee, { exact: true }).waitFor();
  const postings = page.getByRole('table', { name: 'Posting lines' });
  assert.deepEqual(await postings.locator('tbody tr').allTextContents(), ['Site cash——₹6,500', 'Site supplies—₹6,500—']);
  await page.keyboard.press(back);
  await bookHeading('Site cash');
  assert.deepEqual(await balances(), ['₹3,500', '₹13,500']);

  await pressButton(page, 'Record return');
  await date.fill('2026-11-20');
  await chooseOption(page, 'Return to', 'Office cash');
  await typeField(page, 'Amount (₹)', '1000');
  await typeField(page, 'Purpose', 'Unused site cash returned');
  await page.keyboard.press(save);
  const returned = await postedVoucher(page, 'Contra');
  await page.keyboard.press(back);
  await bookHeading('Site cash');
  assert.deepEqual(await balances(), ['₹2,500', '₹13,500']);
  assert.equal(await page.locator('.books dd').first().innerText(), 'Vikram');
  assert.deepEqual(await history.getByRole('button').allTextContents(), [handover, payment, returned]);
  await history.getByRole('cell', { name: 'Vikram Enterprises (owner: Vikram)', exact: true }).waitFor();

  const asOf = page.getByLabel('As of', { exact: true });
  await asOf.fill('2026-11-19');
  await pressButton(page, 'Apply filters');
  await bookHeading('Site cash');
  assert.deepEqual(await balances(), ['₹3,500', '₹13,500']);
  assert.deepEqual(await history.getByRole('button').allTextContents(), [handover, payment]);
  await pressButton(page, payment);
  await bookHeading('Payment ' + payment);
  await page.keyboard.press(back);
  await bookHeading('Site cash');
  assert.equal(await asOf.inputValue(), '2026-11-19');
  assert.equal(await history.getByRole('button', { name: payment, exact: true }).evaluate(button => button === document.activeElement), true);
  await page.keyboard.press(forward);
  await page.getByText(payee, { exact: true }).waitFor();
  await choosePage(page, 'Cashbooks');
  await pressButton(page, 'Office cash');
  await bookHeading('Office cash');
  assert.deepEqual(await balances(), ['₹11,000', '₹13,500']);
  assert.deepEqual((await history.getByRole('button').allTextContents()).slice(1), [handover, returned]);
  await pressButton(page, handover);
  await bookHeading('Contra ' + handover);
  return payment;
}

async function exerciseEmployees(page, save, back) {
  await choosePage(page, 'Vouchers');
  await pressButton(page, 'Day book');
  await pressButton(page, 'New voucher');
  await chooseOption(page, 'Voucher type', 'Opening balance');
  await page.getByLabel('Voucher date').fill('2026-11-17');
  await chooseOption(page, 'Account', 'Firm A bank · Bank');
  await typeField(page, 'Amount (₹)', '30000');
  await page.keyboard.press(save);
  await postedVoucher(page, 'Opening balance');

  await choosePage(page, 'Employees');
  await pressButton(page, 'New employee');
  await page.getByLabel('Employee name').waitFor();
  await page.keyboard.type('Vikram');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Role').evaluate(input => input === document.activeElement), true);
  await page.keyboard.type('Site supervisor');
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Vikram', exact: true }).waitFor();

  await choosePage(page, 'Cashbooks');
  await pressButton(page, 'Site cash');
  await pressButton(page, 'Change custodian');
  await chooseOption(page, 'Employee custodian', 'Vikram');
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Site cash', exact: true }).waitFor();
  assert.equal(await page.locator('.book-balances dd').first().innerText(), '₹2,500');
  await choosePage(page, 'Employees');
  await pressButton(page, 'Vikram');
  await pressButton(page, 'Company cash held');
  await page.getByRole('table', { name: 'Company cash held' }).waitFor();
  assert.equal(await page.locator('.book-balances dd').innerText(), '₹2,500');
  await pressButton(page, 'Site cash');
  await page.getByRole('heading', { name: 'Site cash', exact: true }).waitFor();
  await page.keyboard.press(back);
  const cashLink = page.getByRole('table', { name: 'Company cash held' }).getByRole('button', { name: 'Site cash' });
  await cashLink.waitFor();
  assert.equal(await cashLink.evaluate(button => button === document.activeElement), true);
  await pressButton(page, 'Personal transactions');

  async function entry(action, day, amount, funding, expense) {
    await pressButton(page, 'New employee entry');
    const type = page.getByLabel('Transaction type', { exact: true });
    await type.waitFor();
    assert.equal(await type.evaluate(input => input === document.activeElement), true);
    await chooseOption(page, 'Transaction type', action);
    await page.keyboard.press('Enter');
    const date = page.getByLabel('Voucher date');
    assert.equal(await date.evaluate(input => input === document.activeElement), true);
    await date.fill(day);
    await page.keyboard.press('Enter');
    if (funding) {
      await chooseOption(page, action === 'Advance repayment' ? 'Received into' : 'Paid from', funding);
      await page.keyboard.press('Enter');
    }
    if (expense) {
      await chooseOption(page, 'Expense account', expense);
      await page.keyboard.press('Enter');
    }
    assert.equal(await page.getByLabel('Amount (₹)').evaluate(input => input === document.activeElement), true);
    await page.keyboard.type(amount);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Pilot ' + action.toLowerCase());
    await page.keyboard.press(save);
    const id = await postedVoucher(page, action);
    assert.deepEqual(await page.getByRole('table', { name: 'Posting lines' }).locator('tfoot td').allTextContents(),
      Array(2).fill('₹' + Number(amount).toLocaleString('en-IN')));
    await page.keyboard.press(back);
    await page.getByRole('heading', { name: 'Vikram', exact: true }).waitFor();
    return id;
  }
  await entry('Salary advance', '2026-11-18', '2000', 'Firm A bank');
  assert.deepEqual(await page.locator('.book-balances dd').allTextContents(), ['₹0', '₹2,000']);
  await entry('Salary earned', '2026-11-20', '24000');
  await entry('Apply advance', '2026-11-20', '2000');
  assert.deepEqual(await page.locator('.book-balances dd').allTextContents(), ['₹22,000', '₹0']);
  await entry('Salary payment', '2026-11-20', '22000', 'Firm A bank');
  await entry('Salary advance', '2026-11-20', '300', 'Firm A bank');
  const repayment = await entry('Advance repayment', '2026-11-20', '300', 'Office cash');
  const reimbursement = await entry('Reimbursement', '2026-11-20', '500', 'Firm A bank', 'Site supplies');
  assert.deepEqual(await page.locator('.book-balances dd').allTextContents(), ['₹0', '₹0']);
  const advances = page.getByRole('table', { name: 'Salary advance ledger' });
  await advances.getByRole('row').filter({ hasText: 'Pilot advance repayment' }).getByText('₹300').waitFor();
  await page.getByRole('table', { name: 'Salary and reimbursements' }).getByRole('row')
    .filter({ hasText: 'Pilot reimbursement' }).getByText('₹500').waitFor();
  await pressButton(page, repayment);
  await page.getByRole('heading', { name: 'Advance repayment ' + repayment, exact: true }).waitFor();
  await page.keyboard.press(back);
  await pressButton(page, 'Company cash held');
  assert.equal(await page.locator('.book-balances dd').innerText(), '₹2,500');
  await choosePage(page, 'Reports');
  const salary = page.getByRole('table', { name: 'Trial balance' }).getByRole('row').filter({ hasText: /^Salaries/ });
  await salary.getByText('₹24,000', { exact: true }).waitFor();
  return reimbursement;
}

async function exerciseBank(page, save, back) {
  await choosePage(page, 'Bank');
  await pressButton(page, 'New bank account');
  await page.getByLabel('Bank account name').waitFor();
  await page.keyboard.type('Pilot bank');
  await page.keyboard.press('Enter');
  await page.keyboard.type('004821');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Current');
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Pilot bank', exact: true }).waitFor();
  await pressButton(page, 'Edit bank account');
  assert.equal(await page.getByLabel('Account number').inputValue(), '004821');
  await page.keyboard.press('Escape');

  const pay = async (day, narration) => {
    await pressButton(page, 'New bank entry');
    await page.getByLabel('Voucher date').fill(day);
    await page.keyboard.press('Enter');
    assert.equal(await page.getByLabel('Direction').evaluate(input => input === document.activeElement), true);
    await page.keyboard.press('Enter');
    const to = page.getByLabel('To', { exact: true });
    assert.equal(await to.evaluate(input => input === document.activeElement), true);
    await chooseOption(page, 'To', 'Anuj Kumar · Contractor');
    await page.keyboard.press('Enter');
    await chooseOption(page, 'Site', 'Yamuna');
    await page.keyboard.press('Enter');
    await page.keyboard.type('5000');
    await page.keyboard.press('Enter');
    await page.keyboard.type(narration);
    await page.keyboard.press(save);
    const id = await postedVoucher(page, 'Payment');
    await page.keyboard.press(back);
    await page.getByRole('table', { name: 'Bank book' }).waitFor();
    return id;
  };
  const manual = await pay('2026-11-20', 'Pilot manually entered payment');
  await pay('2026-11-22', 'Pilot possible match A');
  await pay('2026-11-22', 'Pilot possible match B');
  assert.equal(await page.locator('.book-balances dd').last().innerText(), '−₹15,000');
  await pressButton(page, 'Statement rows');

  const header = 'Date,Description,Reference,Amount\n';
  const original = '20/11/2026,Anuj at Yamuna,0001,-5000\n';
  const csv = value => ({ name: 'pilot.csv', mimeType: 'text/csv', buffer: Buffer.from(value) });
  const importFile = async (file, split = false) => {
    await pressButton(page, 'Import statement');
    await page.getByLabel('CSV or XLSX file').setInputFiles(file);
    await pressButton(page, 'Preview statement');
    await page.getByRole('table', { name: 'Statement preview' }).waitFor();
    if (split) await chooseOption(page, 'Amount layout', 'Debit and credit');
    await chooseOption(page, 'Date column', 'Date · Column 1');
    await chooseOption(page, 'Description column', 'Description · Column 2');
    await chooseOption(page, 'Reference column', 'Reference · Column 3');
    if (split) {
      await chooseOption(page, 'Debit column', 'Debit · Column 4');
      await chooseOption(page, 'Credit column', 'Credit · Column 5');
    } else await chooseOption(page, 'Signed amount column', 'Amount · Column 4');
    await page.keyboard.press(save);
  };
  await importFile(csv(header + original + '2026-11-31,Wrong date,BAD,50\n'));
  await page.getByRole('alert').getByText('Row 3: Enter a valid date.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('No statement rows.', { exact: true }).waitFor();
  await importFile(csv(header + original));
  await page.getByText('Added 1 pending rows. 0 already imported.', { exact: true }).waitFor();
  await importFile(csv(header + original));
  await page.getByText('Added 0 pending rows. 1 already imported.', { exact: true }).waitFor();
  const xlsx = utils.book_new();
  utils.book_append_sheet(xlsx, utils.aoa_to_sheet([
    ['Date', 'Description', 'Reference', 'Debit', 'Credit'],
    ['2026-11-20', 'Anuj at Yamuna', '0001', 5000],
    ['2026-11-20', 'Anuj at Yamuna', '0001', 5000],
    ['2026-11-22', 'Needs accountant review', '0002', 5000],
    ['2026-11-23', 'Pending deposit', '0003', null, 250],
  ]), 'Movements');
  const workbook = { name: 'pilot-overlap.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(write(xlsx, { type: 'buffer', bookType: 'xlsx' })) };
  await importFile(workbook, true);
  await page.getByText('Added 3 pending rows. 1 already imported.', { exact: true }).waitFor();
  const statement = page.getByRole('table', { name: 'Statement rows' });
  assert.equal(await statement.getByText('Anuj at Yamuna', { exact: true }).count(), 2);
  await pressButton(page, 'Bank book');
  await page.getByRole('table', { name: 'Bank book' }).waitFor();
  assert.equal(await page.locator('.book-balances dd').last().innerText(), '−₹15,000');
  await pressButton(page, 'Statement rows');

  async function review(n) {
    await pressButton(page, 'Review row ' + n);
    await chooseOption(page, 'To', 'Anuj Kumar · Contractor');
    await page.keyboard.press('Enter');
    await chooseOption(page, 'Site', 'Yamuna');
    await page.keyboard.press(save);
    await page.getByLabel('Review action').waitFor();
  }
  await review(2);
  const candidate = page.getByRole('table', { name: 'Matching vouchers' }).getByRole('button', { name: manual, exact: true });
  await candidate.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Payment ' + manual, exact: true }).waitFor();
  await page.keyboard.press(back);
  await candidate.waitFor();
  assert.equal(await candidate.evaluate(button => button === document.activeElement), true);
  await chooseOption(page, 'Review action', 'Match voucher ' + manual);
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Payment ' + manual, exact: true }).waitFor();
  await page.keyboard.press(back);
  await page.getByRole('button', { name: 'Open voucher ' + manual, exact: true }).waitFor();
  await page.keyboard.press(back);
  await statement.waitFor();

  await review(3);
  await page.getByText('No matching vouchers for the confirmed account and site.').waitFor();
  await chooseOption(page, 'Review action', 'Post a new voucher');
  await page.keyboard.press(save);
  const posted = await postedVoucher(page, 'Payment');
  assert.notEqual(posted, manual);
  await page.keyboard.press(back);
  await statement.waitFor();
  await review(4);
  await page.getByText('Multiple vouchers match.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('table', { name: 'Matching vouchers' }).locator('tbody tr').count(), 2);
  assert.equal(await page.getByLabel('Review action').inputValue(), '');
  await page.keyboard.press('Escape');
  await statement.waitFor();
  await pressButton(page, 'Pending only');
  await statement.getByText('Pending deposit', { exact: true }).waitFor();
  assert.equal(await statement.locator('tbody tr').count(), 2);
  await pressButton(page, 'Bank book');
  const ledger = page.getByRole('table', { name: 'Bank book' });
  await ledger.waitFor();
  assert.equal(await page.locator('.book-balances dd').last().innerText(), '−₹20,000');
  for (const id of [manual, posted]) {
    await pressButton(page, id);
    await page.getByRole('heading', { name: 'Payment ' + id, exact: true }).waitFor();
    await page.keyboard.press(back);
    await ledger.waitFor();
  }
  await choosePage(page, 'Contractors');
  await pressButton(page, 'Anuj Kumar');
  await pressButton(page, 'By site');
  await pressButton(page, 'Yamuna');
  for (const id of [manual, posted]) {
    await pressButton(page, id);
    await page.getByRole('heading', { name: 'Payment ' + id, exact: true }).waitFor();
    await page.keyboard.press(back);
    await page.getByRole('heading', { name: 'Yamuna ledger', exact: true }).waitFor();
  }
}

async function report(page, name, { from, to, firm, combined } = {}) {
  const filters = page.locator('.report-view form');
  await filters.getByLabel('Report', { exact: true }).selectOption({ label: name });
  if (combined !== undefined) await filters.getByLabel('Allocation scope').selectOption(combined ? 'all' : 'one');
  if (firm) await filters.locator('#report-firm').selectOption({ label: firm });
  if (from) await filters.getByLabel('From', { exact: true }).fill(from);
  if (to) await filters.locator('#report-to').fill(to);
  await pressButton(page, 'Apply filters');
  await page.getByRole('heading', { name, exact: true, level: 2 }).waitFor();
}

async function outputFiles(page) {
  const filenames = await app.evaluate(({ dialog, BrowserWindow }, directory) => {
    const current = BrowserWindow.getAllWindows()[0].webContents;
    const path = (name) => directory + '/' + name;
    dialog.showSaveDialog = async (_window, options) => ({
      canceled: false, filePath: path(options.defaultPath.endsWith('.csv') ? 'report.csv' : 'export.pdf'),
    });
    current.print = (options, callback) => {
      if (options.pageSize !== 'A4') { callback(false, 'Unexpected print size.'); return; }
      current.printToPDF({ pageSize: 'A4', preferCSSPageSize: true }).then(async pdf => {
        const fs = process.getBuiltinModule('node:fs/promises');
        await fs.writeFile(path('printed.pdf'), pdf);
        callback(true, '');
      }).catch(error => callback(false, error.message));
    };
    return { pdf: path('export.pdf'), print: path('printed.pdf'), csv: path('report.csv') };
  }, profile);
  const pdf = page.getByRole('button', { name: 'Save PDF', exact: true });
  await pdf.click();
  await page.getByText('PDF saved.', { exact: true }).waitFor();
  for (const key of ['pdf', 'print']) {
    if (key === 'print') {
      await pressButton(page, 'Print');
      const status = page.locator('.print-control').getByRole('status').or(page.locator('.print-control').getByRole('alert'));
      await status.waitFor();
      assert.equal(await status.textContent(), 'Document sent to the printer.');
    }
    assert.equal((await readFile(filenames[key])).subarray(0, 5).toString(), '%PDF-');
  }
  return filenames;
}

async function pdfText(filename) {
  if (process.platform !== 'darwin') return undefined;
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', `
    ObjC.import('PDFKit');
    function run(argv) {
      const document = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
      const pages = [];
      for (let i = 0; i < document.pageCount; i++) pages.push(ObjC.unwrap(document.pageAtIndex(i).string));
      return pages.join('\\n');
    }
  `, filename]);
  return stdout.replace(/\s+/g, ' ');
}

async function exerciseInvoicesAndReports(page, save, back) {
  const day = '2026-11-20';
  await choosePage(page, 'Cashbooks');
  await pressButton(page, 'New cashbook');
  await page.getByLabel('Cashbook name').fill('Invoice cash');
  await page.getByLabel('Custodian', { exact: true }).fill('Vikram');
  await page.getByLabel('Opening date').fill('2026-11-17');
  await page.getByLabel('Opening cash (₹)').fill('10000');
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Invoice cash', exact: true }).waitFor();

  await choosePage(page, 'Sale & Purchase');
  await pressButton(page, 'New purchase');
  const form = page.locator('#invoice-form');
  await form.getByLabel('Invoice or note number').waitFor();
  const fieldInOrder = async (label, value, next) => {
    const field = form.getByLabel(label, { exact: true });
    assert.equal(await field.evaluate(node => node === document.activeElement), true, label);
    if (value !== null) await field.fill(value);
    await page.keyboard.press('Enter');
    if (next) assert.equal(await form.getByLabel(next, { exact: true }).evaluate(node => node === document.activeElement), true, next);
  };
  await fieldInOrder('Invoice or note number', 'VE-2026-8', 'Invoice date');
  await fieldInOrder('Invoice date', day, 'Issuer');
  await fieldInOrder('Issuer', null, 'Supplier');
  await fieldInOrder('Supplier', 'Vikram Enterprises', 'Party address');
  await fieldInOrder('Party address', 'Vendor Lane, Agra', 'Party GSTIN');
  await fieldInOrder('Party GSTIN', '09ABCDE1234F1Z5', 'Consumer details');
  await fieldInOrder('Consumer details', 'Yamuna site office', 'Description');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await form.getByLabel('Consumer details').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await fieldInOrder('Description', 'Steel supply', 'Quantity');
  await fieldInOrder('Quantity', '2.5', 'Unit');
  await fieldInOrder('Unit', 't', 'Rate (₹)');
  await fieldInOrder('Rate (₹)', '40000', 'GST (%)');
  await fieldInOrder('GST (%)', '18', 'GST treatment');
  await fieldInOrder('GST treatment', null, 'Place of supply');
  await fieldInOrder('Place of supply', 'Agra', 'Booking firm');
  assert.equal(await form.getByLabel('Booking firm').locator('option:checked').textContent(), 'Firm A');
  await fieldInOrder('Booking firm', null, 'Management allocation');
  await page.keyboard.press('ArrowDown');
  assert.equal(await form.getByLabel('Management allocation').inputValue(), 'amount');
  await page.keyboard.press('Enter');
  assert.equal(await form.locator('#beneficiary-0').evaluate(node => node === document.activeElement), true);
  await form.locator('#share-0').fill('60000');
  await pressButton(page, 'Add allocation');
  await form.locator('#beneficiary-1').selectOption({ label: 'Firm B' });
  await form.locator('#share-1').fill('40000');
  await form.getByText('₹1,18,000', { exact: true }).waitFor();
  await page.keyboard.press(save);
  await page.getByText('Issued copy saved.').waitFor();
  const invoice = page.getByRole('table', { name: 'Invoice line items' });
  assert.deepEqual(await invoice.locator('tfoot td').allTextContents(), ['₹1,00,000', '₹9,000', '₹9,000', '₹1,18,000']);
  assert.deepEqual(await page.getByRole('table', { name: 'Management allocation' }).locator('tbody td').allTextContents(),
    ['₹60,000', '₹40,000']);
  await pressButton(page, 'Open posting voucher');
  const posting = page.getByRole('table', { name: 'Posting lines' });
  await posting.waitFor();
  assert.deepEqual(await posting.locator('tbody th').allTextContents(), ['Vikram Enterprises', 'Purchases', 'Input CGST', 'Input SGST']);
  assert.deepEqual(await posting.locator('tfoot td').allTextContents(), ['₹1,18,000', '₹1,18,000']);

  await choosePage(page, 'Cashbooks');
  await pressButton(page, 'Invoice cash');
  await pressButton(page, 'Pay supplier bill');
  await pressButton(page, 'VE-2026-8');
  await page.getByRole('heading', { name: 'Apply bill payment · VE-2026-8', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Cashbook or bank account').locator('option:checked').textContent(), 'Invoice cash');
  await page.getByLabel('Voucher date').fill(day);
  await page.getByLabel('Amount (₹)', { exact: true }).fill('6500');
  await page.getByLabel('Narration').fill('Invoice instalment');
  await page.keyboard.press(save);
  await posting.waitFor();
  assert.deepEqual(await posting.locator('tbody th').allTextContents(), ['Invoice cash', 'Vikram Enterprises']);
  await pressButton(page, 'Open linked invoice');
  await page.getByText('₹1,11,500', { exact: true }).waitFor();

  await choosePage(page, 'Sale & Purchase');
  await pressButton(page, 'New sale');
  await form.getByLabel('Invoice or note number').fill('A-2026-8');
  await form.getByLabel('Invoice date').fill(day);
  await form.getByLabel('Customer', { exact: true }).fill('Aarav Projects');
  await form.getByLabel('Description', { exact: true }).fill('Survey services');
  await form.getByLabel('Quantity', { exact: true }).fill('2');
  await form.getByLabel('Unit', { exact: true }).fill('visit');
  await form.getByLabel('Rate (₹)', { exact: true }).fill('5000');
  await form.getByLabel('GST (%)', { exact: true }).fill('18');
  await form.getByLabel('GST treatment').selectOption('igst');
  await page.keyboard.press(save);
  await page.getByText('Issued copy saved.').waitFor();
  const issued = page.getByRole('article', { name: 'Issued document' });
  const original = await issued.innerText();
  assert.match(original, /12 Yamuna Road/);
  assert.deepEqual(await invoice.locator('tfoot td').allTextContents(), ['₹10,000', '₹1,800', '₹11,800']);
  await choosePage(page, 'Firms');
  await pressButton(page, 'Edit Firm A');
  await page.getByLabel('Address', { exact: true }).fill('99 New Address, Agra');
  await page.keyboard.press(save);
  await page.getByText('Firm saved.', { exact: true }).waitFor();
  await choosePage(page, 'Sale & Purchase');
  await pressButton(page, 'A-2026-8');
  await issued.waitFor();
  assert.equal(await issued.innerText(), original);

  let files = await outputFiles(page);
  const firstPrint = await pdfText(files.print);
  const firstPDF = await pdfText(files.pdf);
  if (firstPDF !== undefined) {
    assert.equal(firstPrint, firstPDF);
    assert.ok(firstPDF.replace(/\s+/g, '').includes('12YamunaRoad'));
    assert.match(firstPDF.replace(/\s+/g, ''), /₹11,800/);
    assert.doesNotMatch(firstPDF, /99 New Address|Management allocation|Save PDF/);
  }

  await choosePage(page, 'Reports');
  await report(page, 'Outstanding bills', { to: day });
  const payables = page.getByRole('table', { name: 'Payables' });
  assert.deepEqual(await payables.locator('tfoot td').allTextContents(),
    ['—', '—', '₹1,18,000', '₹0', '₹6,500', '₹1,11,500']);
  await report(page, 'Balance sheet', { to: day });
  const balance = await page.getByRole('table', { name: 'Balance check' }).locator('tfoot td').allTextContents();
  assert.equal(balance[0], balance[1]);
  assert.equal(balance[2], '₹0');
  await report(page, 'Profit and loss', { from: day, to: day });
  await page.getByRole('table', { name: 'Expenses' }).getByRole('row').filter({ hasText: /^Purchases/ })
    .getByText('₹1,00,000', { exact: true }).waitFor();
  await report(page, 'GST summary', { from: day, to: day });
  assert.deepEqual(await page.getByRole('table', { name: 'GST totals' }).locator('tfoot td').allTextContents(),
    ['−₹9,000', '−₹9,000', '₹1,800']);
  await report(page, 'Trial balance', { to: day });
  const trial = page.getByRole('table', { name: 'Trial balance' });
  const trialTotal = await trial.locator('tfoot td').allTextContents();
  assert.equal(trialTotal[0], trialTotal[1]);
  const purchases = trial.getByRole('row').filter({ hasText: /^Purchases/ });
  await purchases.getByRole('button', { name: 'Purchases', exact: true }).click();
  await page.getByRole('heading', { name: 'Account ledger', exact: true }).waitFor();
  const ledger = page.getByRole('table', { name: 'Purchases ledger' });
  await ledger.waitFor();
  assert.equal(await ledger.locator('tfoot tr').last().locator('td').last().textContent(), '₹1,00,000');
  await page.keyboard.press(back);
  await trial.waitFor();
  assert.equal(await purchases.getByRole('button').evaluate(node => node === document.activeElement), true);

  await report(page, 'Purchase register', { from: day, to: day });
  assert.deepEqual((await page.getByRole('table', { name: 'Purchase register' }).locator('tfoot td').allTextContents()).slice(3, 8),
    ['₹1,00,000', '₹9,000', '₹9,000', '₹0', '₹1,18,000']);
  await report(page, 'Sales register', { from: day, to: day });
  assert.deepEqual((await page.getByRole('table', { name: 'Sales register' }).locator('tfoot td').allTextContents()).slice(3, 8),
    ['₹10,000', '₹0', '₹0', '₹1,800', '₹11,800']);

  await report(page, 'Firm allocations', { from: day, to: day, combined: true });
  const allAllocations = page.getByRole('table', { name: 'Allocated by beneficiary' });
  assert.deepEqual(await allAllocations.locator('tfoot td').allTextContents(), ['₹10,000', '₹1,00,000', '₹1,10,000']);
  const allocations = page.getByRole('table', { name: 'Allocation sources' });
  assert.equal(await allocations.getByRole('button', { name: 'VE-2026-8', exact: true }).count(), 2);
  await allocations.getByRole('row').filter({ hasText: 'Firm B' }).getByRole('button', { name: 'VE-2026-8' }).click();
  await page.getByRole('heading', { name: 'Purchase invoice VE-2026-8', exact: true }).waitFor();
  await page.keyboard.press(back);
  await allAllocations.waitFor();
  files = await outputFiles(page);
  await pressButton(page, 'Export CSV');
  await page.getByText('CSV exported.', { exact: true }).waitFor();
  const csv = await readFile(files.csv, 'utf8');
  assert.match(csv, /"Total allocated",10000\.00,100000\.00,110000\.00/);
  assert.match(csv, /"Firm B",40000\.00/);
  const print = await pdfText(files.print);
  const pdf = await pdfText(files.pdf);
  if (pdf !== undefined) {
    assert.equal(print, pdf);
    for (const text of ['₹10,000', '₹1,00,000', '₹1,10,000', '₹40,000', 'VE-2026-8']) assert.ok(pdf.replace(/\s+/g, '').includes(text), text);
    assert.doesNotMatch(pdf, /Apply filters|Export CSV/);
  }
  await report(page, 'Firm allocations', { from: day, to: day, combined: false, firm: 'Firm B' });
  assert.deepEqual(await allAllocations.locator('tfoot td').allTextContents(), ['₹0', '₹40,000', '₹40,000']);
  await allocations.getByRole('button', { name: 'VE-2026-8', exact: true }).click();
  await page.getByRole('heading', { name: 'Purchase invoice VE-2026-8', exact: true }).waitFor();

  await choosePage(page, 'Reports');
  await report(page, 'Bank reconciliation', { from: day, to: '2026-11-23', firm: 'SP & Company (archived)' });
  const statement = page.getByRole('table', { name: 'Statement rows' });
  await statement.getByText('Pending deposit', { exact: true }).waitFor();
  const matched = statement.getByRole('button', { name: /^#/ }).first();
  const matchedNumber = await matched.textContent();
  await matched.click();
  await page.getByRole('heading', { name: new RegExp(matchedNumber + '$') }).waitFor();

  await choosePage(page, 'Sale & Purchase');
  await pressButton(page, 'A-2026-8');
  await pressButton(page, 'Create credit note');
  await form.getByLabel('Invoice or note number').fill('A-CN-8');
  await form.getByLabel('Invoice date').fill('2026-11-21');
  await form.getByLabel('Description', { exact: true }).fill('Survey price adjustment');
  await form.getByLabel('Quantity', { exact: true }).fill('1');
  await form.getByLabel('Unit', { exact: true }).fill('visit');
  await form.getByLabel('Rate (₹)', { exact: true }).fill('1000');
  await form.getByLabel('GST (%)', { exact: true }).fill('18');
  await page.keyboard.press(save);
  await page.getByRole('heading', { name: 'Credit note · Sale A-CN-8', exact: true }).waitFor();
  await pressButton(page, 'Open original invoice');
  await page.getByText('₹10,620', { exact: true }).waitFor();

  await app.close();
  app = undefined;
  const reopened = await launch();
  await reopened.getByRole('button', { name: 'Demo', exact: true }).click();
  await activeFirm(reopened, 'Firm A');
  await choosePage(reopened, 'Sale & Purchase');
  await pressButton(reopened, 'A-2026-8');
  assert.equal(await reopened.getByRole('article', { name: 'Issued document' }).innerText(), original);
  await reopened.getByText('₹10,620', { exact: true }).waitFor();
  await choosePage(reopened, 'Sale & Purchase');
  await pressButton(reopened, 'VE-2026-8');
  await reopened.getByText('₹1,11,500', { exact: true }).waitFor();

  console.log('Desktop sample: trial balance ' + trialTotal.join(' / ') + ', assets and funding ' + balance.slice(0, 2).join(' / ') + '.');
  console.log('Phases 8 and 9 passed: keyboard invoice entry, cashbook bill payment, issued address reprint, reconciled reports and source links, and PDF/CSV output.');
}

try {
  let page = await launch();
  await heading(page, 'SP & Company');
  assert.match(await page.locator('footer').innerText(), /Offline/);
  assert.deepEqual(await page.evaluate(() => ({ bridge: Object.keys(window.workspaces).sort(), require: typeof window.require })),
    { bridge: ['applyBillPayment', 'confirmStatement', 'createAccount', 'createCashbook', 'getCashbookLedger', 'getCashbooks',
      'getChart', 'getContractorLedger', 'getContractors', 'getDayBook', 'getEmployeeLedger', 'getInvoice', 'getInvoices', 'getLedger',
      'getNamedAccounts', 'getReport', 'getStatement', 'getStatementMatches', 'getStatements', 'getTrialBalance', 'getVoucher',
      'importStatement', 'isMac', 'output', 'postBank', 'postEmployee', 'postInvoice', 'postVoucher', 'previewStatement', 'read', 'removeCashbook',
      'removeContractor', 'removeFirm', 'removeNamedAccount', 'reverseVoucher', 'saveCashbookCustodian', 'saveContractor',
      'saveFirm', 'saveName', 'saveNamedAccount', 'selectFirm'], require: 'undefined' });
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
  await exerciseBank(page, save, back);
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
  const cashPayment = await exerciseCashbooks(page, save, back, forward);
  const reimbursement = await exerciseEmployees(page, save, back);
  const settlement = await exerciseContractors(page, save, back, forward);
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
  assert.deepEqual(await firmSwitcher.getByRole('option').allTextContents(), ['Firm A', 'Firm B', 'Vikram Enterprises']);
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
  await pressButton(page, 'Archived bank accounts');
  await pressButton(page, 'Pilot bank');
  await pressButton(page, 'Statement rows');
  await pressButton(page, 'Pending only');
  const pending = page.getByRole('table', { name: 'Statement rows' });
  await pending.getByText('Pending deposit', { exact: true }).waitFor();
  assert.deepEqual(await pending.getByRole('button').allTextContents(), ['Review row 5', 'Review row 4']);
  for (let count = 0; count < 3; count++) await page.keyboard.press(back);
  await page.getByText('SP & Company · Archived books').waitFor();
  assert.equal(await page.getByRole('button', { name: 'New voucher', exact: true }).count(), 0);
  await pressButton(page, '#42');
  await page.getByRole('heading', { name: 'Reversal #42', exact: true }).waitFor();
  await pressButton(page, 'voucher #41');
  await page.getByText('2026-11-20 · Phase 3 sample payment', { exact: true }).waitFor();
  await page.getByLabel('Active firm', { exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await activeFirm(page, 'Firm A');
  await choosePage(page, 'Contractors');
  await pressButton(page, 'Anuj Kumar');
  await page.getByText('Archived records', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.books .balances dd').allTextContents(), ['₹40,000', '₹2,000', '₹38,000', '₹8,000']);
  await pressButton(page, settlement);
  await page.getByRole('heading', { name: 'Journal ' + settlement, exact: true }).waitFor();
  await choosePage(page, 'Cashbooks');
  await pressButton(page, 'Site cash');
  await page.getByRole('heading', { name: 'Site cash', exact: true }).waitFor();
  assert.equal(await page.locator('.book-balances dd').first().innerText(), '₹2,500');
  await pressButton(page, cashPayment);
  await page.getByText('Payee Vikram Enterprises (owner: Vikram)', { exact: true }).waitFor();
  await choosePage(page, 'Employees');
  await pressButton(page, 'Vikram');
  await page.getByRole('table', { name: 'Salary and reimbursements' }).waitFor();
  assert.deepEqual(await page.locator('.book-balances dd').allTextContents(), ['₹0', '₹0']);
  await pressButton(page, reimbursement);
  await page.getByRole('heading', { name: 'Reimbursement ' + reimbursement, exact: true }).waitFor();
  await page.keyboard.press(back);
  await pressButton(page, 'Company cash held');
  assert.equal(await page.locator('.book-balances dd').innerText(), '₹2,500');
  assert.deepEqual((await readdir(join(profile, 'workspaces'))).filter(name => name.endsWith('.sqlite3')).sort(), ['demo.sqlite3', 'live.sqlite3']);
  await exerciseInvoicesAndReports(page, save, back);
  console.log('Desktop smoke passed: offline workspaces and firms, vouchers and reversals, contractors, cashbooks, employees, CSV/XLSX bank review and source drill-down after restart.');
} finally {
  try {
    if (app) await app.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
