import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const [target, transferDirectory, mode = 'roundtrip'] = process.argv.slice(2);
if (!target || !['roundtrip', 'import'].includes(mode) || (mode === 'import' && !transferDirectory)) {
  throw new Error('Pass the executable or . and optionally a transfer directory and import mode.');
}
const temp = await mkdtemp(join(tmpdir(), 'sp-recovery-'));
const exchange = transferDirectory ? resolve(transferDirectory) : temp;
const backup = join(exchange, 'phase-10-sample.sqlite3');
const manifest = join(exchange, 'phase-10-sample.json');
const invalid = join(temp, 'invalid.sqlite3');
const receiving = join(temp, 'receiving');
let app;

async function launch(profile) {
  const args = [`--user-data-dir=${profile}`, '--proxy-server=http://127.0.0.1:9'];
  app = await electron.launch(target === '.' ? { args: ['.', ...args] } : { executablePath: resolve(target), args });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.context().setOffline(true);
  await page.getByRole('heading', { level: 1, name: 'SP & Company', exact: true }).or(
    page.getByRole('heading', { level: 1, name: 'Phase 10 sample books', exact: true })).waitFor();
  return page;
}

async function close() {
  await app.close();
  app = undefined;
}

async function press(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
}

async function dialogs({ save, open, response = 1 }) {
  await app.evaluate(({ dialog }, { save, open, response }) => {
    dialog.showSaveDialog = async () => ({ canceled: !save, filePath: save });
    dialog.showOpenDialog = async () => ({ canceled: !open, filePaths: open ? [open] : [] });
    dialog.showMessageBox = async (_parent, options) => {
      if (options.defaultId !== 0 || options.cancelId !== 0 || options.buttons.join('/') !== 'Cancel/Restore') {
        throw new Error('Restore must default to cancellation.');
      }
      return { response };
    };
  }, { save, open, response });
}

async function seed(page) {
  await page.evaluate(async () => {
    const api = window.workspaces;
    const kind = 'live';
    const day = '2026-11-20';
    await api.saveName(kind, 'Phase 10 sample books');
    for (const name of ['Firm A', 'Firm B']) {
      await api.saveFirm(kind, null, { name, owner: '', address: 'Agra, Uttar Pradesh', gstin: '' });
    }
    const { firms: [a, b] } = await api.read(kind);
    const bank = await api.createAccount(kind, a.id, { kind: 'bank', name: 'Sample bank' });
    await api.postVoucher(kind, a.id, { requestId: 'opening', day, memo: '', kind: 'Opening balance',
      accountId: bank.id, value: 7_000_000 });
    const contractor = await api.saveContractor(kind, a.id, { id: null, name: 'Anuj', siteIds: [], newSites: ['Yamuna', 'Bodla'] });
    const { sites } = await api.getChart(kind, a.id);
    const line = (accountId, siteId, value) => ({ accountId, siteId, value });
    await api.postVoucher(kind, a.id, { requestId: 'split', day, kind: 'Payment', memo: 'Two-site contractor payment', lines: [
      line(contractor.id, sites.find(site => site.name === 'Yamuna').id, 3_000_000),
      line(contractor.id, sites.find(site => site.name === 'Bodla').id, 1_000_000),
      line(bank.id, null, -4_000_000),
    ] });
    await api.importStatement(kind, a.id, { accountId: bank.id, filename: 'sample.csv',
      bytes: new TextEncoder().encode('Date,Description,Reference,Amount\n2026-11-20,Pending fee,1,-250\n2026-11-20,Pending deposit,2,1250\n').buffer,
      mapping: { date: 0, description: 1, reference: 2, amount: 3 } });
    const invoice = { day, document: 'Invoice', partyAddress: '', partyGstin: '', consumer: '', supply: 'Agra',
      allocationMode: 'amount' };
    const item = { description: 'Site supplies', quantity: '1', unit: 'lot', gst: '18' };
    await api.postInvoice(kind, a.id, { ...invoice, requestId: 'purchase', number: 'QA-P-001', side: 'Purchase',
      issuerId: a.id, party: 'Sample supplier', taxMode: 'split', items: [{ ...item, rate: '100000' }],
      allocations: [{ firmId: a.id, value: '60000' }, { firmId: b.id, value: '40000' }] });
    await api.postInvoice(kind, b.id, { ...invoice, requestId: 'sale', number: 'QA-S-001', side: 'Sale',
      issuerId: b.id, party: 'Sample customer', taxMode: 'igst', items: [{ ...item, rate: '10000' }], allocations: [] });
    await api.selectFirm(kind, b.id);
  });
}

async function snapshot(page) {
  return JSON.parse(await page.evaluate(async () => {
    const api = window.workspaces;
    const kind = 'live';
    const period = { from: '2026-11-01', to: '2026-11-30' };
    const workspace = await api.read(kind);
    const firms = [];
    for (const { id } of workspace.firms) {
      const { accounts, sites } = await api.getChart(kind, id);
      const balances = await Promise.all(accounts.map(async account => ({
        account, closing: (await api.getLedger(kind, id, { ...period, accountId: account.id })).closing,
      })));
      const register = await api.getInvoices(kind, id, period);
      if (register.hasNext) throw new Error('Sample invoice register exceeds one page.');
      const invoices = await Promise.all(register.rows.map(({ voucherId }) => api.getInvoice(kind, id, { voucherId })));
      const siteTotals = await Promise.all(accounts.filter(account => account.kind === 'contractor').map(async account => ({
        accountId: account.id, totals: (await api.getContractorLedger(kind, id, { ...period, accountId: account.id })).sites,
      })));
      const pending = await Promise.all(accounts.filter(account => account.kind === 'bank').map(async account => {
        const rows = await api.getStatements(kind, id, { accountId: account.id, pending: true });
        if (rows.hasNext) throw new Error('Sample pending rows exceed one page.');
        return { accountId: account.id, rows: rows.rows };
      }));
      const trial = await api.getTrialBalance(kind, id, { to: period.to });
      firms.push({ balances, invoices, sites, siteTotals, pending, debit: trial.debit, credit: trial.credit });
    }
    return JSON.stringify({ workspace, firms }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  }));
}

try {
  let expected;
  if (mode === 'roundtrip') {
    await mkdir(exchange, { recursive: true });
    const source = await launch(join(temp, 'source'));
    await seed(source);
    expected = await snapshot(source);
    assert.equal(expected.workspace.firms.length, 2);
    const [a, b] = expected.firms;
    assert.deepEqual([a.debit, a.credit, b.debit, b.credit], ['18800000', '18800000', '1180000', '1180000']);
    assert.deepEqual(a.siteTotals[0].totals.map(({ given }) => given).sort(), ['1000000', '3000000']);
    assert.deepEqual(a.pending[0].rows.map(({ value }) => value).sort((first, second) => first - second), [-25000, 125000]);
    assert.deepEqual(a.invoices[0].snapshot.allocations.map(({ amount }) => amount), [6_000_000, 4_000_000]);
    assert.equal(b.invoices[0].snapshot.totals.total, 1_180_000);
    await dialogs({ save: backup });
    await press(source, 'Workspace settings');
    await press(source, 'Save backup');
    await source.getByText('Workspace backup saved.', { exact: true }).waitFor();
    await writeFile(manifest, JSON.stringify(expected, null, 2) + '\n');
    await close();
  } else {
    expected = JSON.parse(await readFile(manifest, 'utf8'));
  }

  let page = await launch(receiving);
  await press(page, 'Workspace settings');
  await dialogs({ open: backup, response: 0 });
  await press(page, 'Restore backup');
  await page.waitForFunction(() => document.getElementById('restore-workspace')?.getAttribute('aria-disabled') === 'false');
  assert.deepEqual((await snapshot(page)).workspace.firms, []);
  await dialogs({ open: backup });
  await press(page, 'Restore backup');
  await page.getByText('Workspace restored. The previous books were saved as live.before-restore.sqlite3.', { exact: true }).waitFor();
  assert.deepEqual(await snapshot(page), expected);
  assert.equal(await page.locator('#active-firm').inputValue(), String(expected.workspace.activeFirmId));
  const recovery = join(receiving, 'workspaces', 'live.before-restore.sqlite3');
  const previous = await readFile(recovery);
  await writeFile(invalid, 'invalid backup sample');
  await dialogs({ open: invalid });
  await press(page, 'Restore backup');
  await page.getByRole('alert').filter({ hasText: /existing books are unchanged/ }).waitFor();
  assert.deepEqual(await readFile(recovery), previous);
  await close();

  page = await launch(receiving);
  await page.getByRole('heading', { level: 1, name: 'Phase 10 sample books', exact: true }).waitFor();
  assert.deepEqual(await snapshot(page), expected);
  await press(page, 'Workspace settings');
  await dialogs({ open: recovery });
  await press(page, 'Restore backup');
  await page.getByText(/^Workspace restored\./).waitFor();
  assert.deepEqual((await snapshot(page)).workspace.firms, []);
  await close();
  page = await launch(receiving);
  assert.deepEqual((await snapshot(page)).workspace.firms, []);
  console.log(`Recovery passed on ${process.platform}/${process.arch}: two firms, account balances, issued invoices, allocations, site totals, pending rows, invalid backup, and recovery after offline restarts.`);
} finally {
  try {
    if (app) await close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
