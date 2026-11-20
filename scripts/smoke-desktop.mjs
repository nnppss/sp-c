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
  return title.split(' ')[1];
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

try {
  let page = await launch();
  await heading(page, 'SP & Company');
  assert.match(await page.locator('footer').innerText(), /Offline/);
  assert.deepEqual(await page.evaluate(() => ({ bridge: Object.keys(window.workspaces).sort(), require: typeof window.require })),
    { bridge: ['createAccount', 'createCashbook', 'getCashbookLedger', 'getCashbooks', 'getChart', 'getContractorLedger',
      'getContractors', 'getDayBook', 'getLedger', 'getTrialBalance', 'getVoucher', 'isMac', 'postVoucher', 'read',
      'removeCashbook', 'removeContractor', 'removeFirm', 'reverseVoucher',
      'saveContractor', 'saveFirm', 'saveName', 'selectFirm'], require: 'undefined' });
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
  const cashPayment = await exerciseCashbooks(page, save, back, forward);
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
  assert.deepEqual((await readdir(join(profile, 'workspaces'))).filter(name => name.endsWith('.sqlite3')).sort(), ['demo.sqlite3', 'live.sqlite3']);
  console.log('Desktop smoke passed: offline workspaces and firms, vouchers and reversals, contractors, cashbooks and source drill-down after restart.');
} finally {
  try {
    if (app) await app.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
