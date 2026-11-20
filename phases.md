# Build phases and progress

**Starting point, 20 November 2026.** The checkout contains the Python/SQLite prototype and an HTML shell. The desktop build begins with phase 1. Each of the six business modules has its own implementation prompt.

## Milestones

| Phase | Status | Working result |
| --- | --- | --- |
| 1. Desktop foundation | Blocked | Verified offline restart and workspace isolation on Apple silicon. Intel Mac launch and Windows installer and launch checks need platform runners. |
| 2. Firms | Verified | Firm details and the selected books survived an offline restart on Apple silicon. Unused firms can be deleted and referenced firms retain their history. |
| 3. Vouchers and accounting core | Verified | Posted and reversed a ₹5,000.25 sample payment. The day book and trial balance led to the same voucher, and the fixture reconciled to ₹21,98,000 on each side. |
| 4. Contractors | Verified | One ₹40,000 bank payment and a ₹2,000 cash return leave Anuj with ₹38,000 net given. Both sites open the original payment. |
| 5. Cashbooks | Verified | Vikram holds ₹2,500 after the handover, expense and return. Total firm cash fell only by the ₹6,500 expense. |
| 6. Employees | Verified | Vikram’s salary and advance settled while he retained ₹2,500 in company cash. The sample pilot is ready for accountant feedback. |
| 7. Bank | Verified | CSV and XLSX statement rows can be posted or matched, and pending rows survive restart. |
| 8. Sale & Purchase | Planned | Printable GST invoices support bill payments and pre-tax allocations across firms. |
| 9. Reports | Planned | Financial, tax and management reports reconcile to source vouchers. |
| 10. Backup, restore and release | Planned | Packaged Mac and Windows apps can open and recover the same set of books. |

## Build prompts

Open the SP & Company project in a Codex implementation chat. Paste one numbered block below, in order. A new chat can pick up from the same checkout. To let Codex select the next phase, reuse this block each time:

```text
Read phases.md in this project. Implement one phase: resume the earliest phase with outstanding work you can complete here, or start the next phase whose prerequisites are in place. Follow its numbered build prompt and the shared instructions. Run its acceptance checks and update phases.md with results before ending this run. If all phases are verified, report that instead.
```

**Shared instructions.** Read the current code, [product specification](software.md), [architecture](architecture.md) and latest handover before editing. Implement the phase through the actual app UI. Exercise keyboard navigation and add a regression test for its accounting or persistence rules. Use sample books. Update the milestone status and progress log with the date, checks run, results and anything pending. Use **In progress** during implementation, **Blocked** for a concrete dependency and **Verified** once the phase checks pass. If a platform runner or accountant is unavailable, record the outstanding check and continue independent work. Update the [build guide](docs/BUILD.md) when commands change.

### Phase 1. Desktop foundation

```text
Implement Phase 1, Desktop foundation, following the shared instructions in phases.md. Use the fixed-date seed and baseline in docs/BUILD.md to capture all 40 prototype vouchers as regression fixtures, including postings, site assignments, balances and invoice snapshots.

Build the offline Electron shell with React, Vite, TypeScript, a restricted preload bridge and a Node worker owning the SQLite database. Add versioned migrations, separate demo and live workspaces, page navigation, visible shortcuts, and Back/Forward that restores focus. Provide reproducible dev, test and packaging commands.

Open a fresh workspace, save a workspace setting, quit and reopen offline. Verify persistence and demo/live isolation. Smoke-test packaged builds on the available target platforms, and record commands, artifacts and pending platform checks in phases.md.
```

### Phase 2. Firms

```text
Implement Phase 2, Firms, using the desktop foundation and shared instructions in phases.md. Build the firm directory, creation, editing and active-firm switcher. Store name, owner, address and GST details. Expose the chosen firm to every subsequent entry and query. Support deleting unused firms and retaining referenced firms with their history.

Create Firm A and Firm B in one sample workspace, give them different details, edit A, switch to B, then reopen the app. Verify the selected firm persists and B’s details are intact. Verify switching remains keyboard accessible. Run the checks and update phases.md.
```

### Phase 3. Vouchers and accounting core

```text
Implement Phase 3, Vouchers and accounting core, on the firm-aware desktop app. Follow the shared instructions in phases.md and the posting rules in architecture.md. Build the chart of accounts, opening balances, payment, receipt, contra and journal entry, linked reversals, day book, ledger and drill-down trial balance. Allow basic bank and cash ledgers to be created here so subsequent modules can already post payments.

Store signed integer paise, enforce balanced firm-scoped lines, and commit each voucher atomically with a stable request ID. Test a duplicate save, interrupted posting, reversal and attempted cross-firm posting. Replay the phase 1 fixture lines through the ledger and compare each account’s balance and site totals. Both sides of the trial balance must equal ₹21,98,000. Exercise a new payment through the UI and record results in phases.md.
```

### Phase 4. Contractors

```text
Implement Phase 4, Contractors, on the shared voucher engine. Follow phases.md and software.md. Build contractor creation, editing, deletion of unused records and archival with history. Assign many contractors to a site and many sites to a contractor. Search by either name. Open chronological and site-wise ledgers showing money given, money received, payment method and running balance. Allow site splits and manual settlement vouchers.

Using the keyboard, pay Anuj ₹40,000 from one bank account. Assign ₹30,000 to Yamuna and ₹10,000 to Bodla. Receive ₹2,000 back in cash for Bodla. Verify one bank payment, ₹38,000 net given, ₹30,000 at Yamuna and ₹8,000 at Bodla. Assign a second contractor to Yamuna and check that Anuj’s totals stay the same. Verify source-voucher drill-down and update phases.md.
```

### Phase 5. Cashbooks

```text
Implement Phase 5, Cashbooks, using the shared cash ledgers, transfers and payment vouchers. Follow the shared instructions in phases.md. Build named cashbooks with funding firm, custodian, dated opening cash, transaction history and balance held. Record handovers, expenses, payments to people or firms and returns. Let Vikram hold site cash and also own a payee firm. The cashbook must identify both roles.

Start with funded office cash and an empty site cashbook. Give Vikram ₹10,000, record ₹6,500 spent and return ₹1,000 to office cash. Verify he holds ₹2,500, the handover preserves total company cash and only the expense reduces it. Verify the dated balance and voucher links. Phase 8 adds application of cash payments to invoices. Record test results in phases.md.
```

### Phase 6. Employees

```text
Implement Phase 6, Employees, using the shared voucher engine and cashbook custodians. Follow phases.md and software.md. Build employee records and named ledgers for salary earned, salary payments, advances, repayments, reimbursements and manual adjustments. Allow an employee to hold a site cashbook, with separate views of personal transactions and company cash held.

In sample books, give Vikram a ₹2,000 salary advance and put ₹2,500 in his site cashbook. Post ₹24,000 salary earned, apply the advance and pay the remaining ₹22,000 by bank. Verify his salary is settled, salary expense is ₹24,000, and he still holds ₹2,500 of company cash. Exercise a reimbursement and an advance repayment through the keyboard UI. Prepare the daily-entry sample pilot and record test results and any accountant feedback still pending in phases.md.
```

### Phase 7. Bank

```text
Implement Phase 7, Bank, extending the existing bank ledgers. Follow the shared instructions in phases.md. Build bank account management, manual entries, and SheetJS preview for CSV and XLSX. Map dates, descriptions, references and signed amounts or debit/credit columns. Persist unreviewed rows. From a selected row, confirm From, To and site, then create a voucher or match an existing movement.

Test both paths with a ₹5,000 payment to Anuj at Yamuna. Reimport identical and overlapping statements, preserve two genuine same-value payments and leave ambiguous matches for review. Verify pending rows do not affect the books, malformed data identifies the offending row, and a pending row survives restart. Confirm the bank book and Anuj’s ledger open the same voucher. Update phases.md.
```

### Phase 8. Sale & Purchase

```text
Implement Phase 8, Sale & Purchase, using the firm, cashbook and ledger modules. Follow phases.md and the invoice fields in software.md. Build the printable template with keyboard entry advancing through invoice number, date, issuer, customer or supplier, consumer, item descriptions, quantities, units, rates and GST. Calculate with decimal arithmetic and post printed amounts in paise. Support CGST/SGST or IGST, credit/debit notes, partial bill payments, print and PDF. Save issued snapshots.

At the end of entry choose the booking firm and allocate pre-tax value by amount or percentage. Book a ₹1,00,000 pre-tax purchase in A, allocating ₹60,000 to A and ₹40,000 to B. Verify the payable and GST post once. Apply a ₹6,500 cashbook payment to the bill and verify the outstanding amount falls without a second expense. Create a sale, change the firm address and reprint the original invoice. Check its saved details and totals and record results in phases.md.
```

### Phase 9. Reports

```text
Implement Phase 9, Reports, following phases.md and software.md. Reuse posted vouchers, bank matches, bill applications and management allocations. Deliver profit and loss, balance sheet, outstanding bills, bank reconciliation, sales and purchase registers, GST summaries and combined firm-allocation reports. Integrate the existing trial balance, day book and account ledgers. Support firm and date filters, source drill-down, print and export.

Reconcile a sample period account by account. Verify the balance sheet balances, the trial balance agrees with its ledgers and a partial bill payment agrees with the outstanding report. Trace the phase 8 split to one supplier invoice and verify the management view counts the pre-tax total once. Check printed and exported totals against the screen. Record results in phases.md.
```

### Phase 10. Backup, restore and release

```text
Implement Phase 10, Backup, restore and release, following phases.md and architecture.md. Build a consistent local backup, validation before restore, and recovery that preserves existing books if restore fails. Test schema upgrades on populated copies. Produce the macOS disk image and Windows installer and document verified install, run and recovery steps in docs/BUILD.md.

Use a sample workspace with two firms, issued invoices, contractor site splits and pending bank rows. Restore it across Mac and Windows, restart offline, and compare per-account balances, invoices, allocations, site totals and pending rows. Test an invalid backup and confirm existing books reopen. Reconcile a representative month against the accountant’s figures when available. Record actual artifacts, platform results and outstanding release checks in phases.md.
```

## Progress log

| Date | Area | Evidence and remaining work |
| --- | --- | --- |
| 20 Nov 2026 | Repository baseline | The prototype contains posting, invoice, statement import/match and backup code. The HTML shell references scripts and styles that are absent. The project has no Electron package or desktop installer. [Prototype entry point](app.py) · [Ledger code](ledger.py) · [HTML shell](static/index.html) |
| 20 Nov 2026 | Prototype ledger check | With the seed date fixed at 20 Nov 2026, all 40 vouchers balanced individually. Closing debit and credit balances each totalled ₹21,98,000. The saved sale totalled ₹1,13,280 and the purchase ₹63,720. This checks the sample ledger. Desktop implementation awaits the module acceptance checks. |
| 20 Nov 2026 | Phase 1 desktop foundation | Captured all 40 vouchers, postings, site assignments, balances and the two invoice snapshots. The Electron app opens separate Live and Demo SQLite files through a worker. Keyboard navigation and offline restart passed in development and from the mounted Apple silicon DMG. [Commands and platform results](#phase-1-verification) |
| 20 Nov 2026 | Phase 2 firms | Created Firm A and Firm B in a disposable Demo workspace, edited A, switched to B by keyboard and verified the saved selection and both firms’ details after relaunch. [Checks and platform coverage](#phase-2-verification) |
| 20 Nov 2026 | Phase 3 vouchers and accounting core | Replayed the 40 prototype vouchers into SQLite and reconciled every account and site total. Posted a sample payment and followed it from the day book and trial balance through to the ledger and voucher. [Checks and platform coverage](#phase-3-verification) |
| 20 Nov 2026 | Phase 4 contractors | Entered Anuj’s bank payment, site split, Bodla cash return and manual settlement from the keyboard. Verified shared assignments, voucher links, and archived history after restart. [Checks and platform coverage](#phase-4-verification) |
| 20 Nov 2026 | Phase 5 cashbooks | Reconciled Vikram’s site cash and office cash by date. The cashbook showed Vikram as custodian and Vikram Enterprises as the payee firm. Verified source vouchers and the balance after an offline restart. [Checks and platform coverage](#phase-5-verification) |
| 20 Nov 2026 | Phase 6 employees | Verified payroll settlement, separate cash custody, reimbursement and advance repayment in offline Demo books. The accountant walkthrough is pending. [Checks](#phase-6-verification) · [Pilot worksheet](#daily-entry-sample-pilot) |
| 20 Nov 2026 | Phase 7 bank | Verified CSV and XLSX imports, both confirmation paths, overlapping exports and pending rows after offline restart. [Checks](#phase-7-verification) |

### Reproduce the prototype baseline

Repeat the fixed-date check from the project root using the [build guide](docs/BUILD.md#reproduce-the-prototype-baseline). For the reading order and handover convention, see the [documentation index](docs/README.md).

### Phase 1 verification

- A clean `npm ci` and `npm exec -- install-electron` succeeded from local caches in a disposable checkout. `npm run build` and `npm test` passed there.
- `python3 -B scripts/capture-prototype.py --check` matched the [checked-in fixture](fixtures/prototype-2026-11-20.json) against a fresh seed. `npm test` passed all three Vitest checks for voucher replay, trial and site balances, invoice totals, migration rollback, and workspace persistence.
- `npm run test:desktop` passed on macOS 27.0 arm64 with the pinned Electron 45.3.2. The Playwright workflow used a fresh profile, navigated with Enter, checked Back and Forward focus and input selection, saved `Office books` and `Training books` with Cmd+S, quit, and reopened with the renderer offline. Both names and the demo balance returned from their respective SQLite files.
- `npm run package:mac` produced [`release/sp-company-accounts-0.1.0-mac-arm64.dmg`](release/sp-company-accounts-0.1.0-mac-arm64.dmg) and [`release/sp-company-accounts-0.1.0-mac-x64.dmg`](release/sp-company-accounts-0.1.0-mac-x64.dmg). `hdiutil verify` passed for both images. `npm run test:packaged -- "<mount>/SP Company Accounts.app/Contents/MacOS/SP Company Accounts"` passed from the read-only Apple silicon image. The Intel bundle passed code-signature verification and still needs the launch and offline restart test on a compatible Mac.
- `npm run package:win` cross-bundled [`release/win-unpacked/SP Company Accounts.exe`](release/win-unpacked/SP%20Company%20Accounts.exe). Static inspection confirmed the x64 executable and its packaged main, preload, worker, renderer and fixture. The NSIS step failed because the bundled `makensis` is an Intel macOS binary and this host lacks Rosetta. The Windows x64 NSIS build, install and offline smoke remain pending on a Windows runner.

The local package attempts used cached Electron archives via `--config.electronDist` and a cached electron-builder tool directory. Standard commands and the executable paths for repeating the checks are in the [build guide](docs/BUILD.md#package-and-smoke-test).

### Phase 2 verification

- `python3 -B scripts/capture-prototype.py --check` matched the fixed-date fixture, including all 40 vouchers.
- `npm test` passed all five checks. The Firms regressions cover a populated version 1 upgrade, persisted selection, stable firm IDs, deletion of unused firms, and preservation of references and the demo snapshot when a firm is archived.
- `npm run test:desktop` built the app and passed on macOS 27.0 arm64 with Electron 45.3.2. The smoke test created Firm A and Firm B with different owners, addresses and GSTINs, edited A, tabbed to the switcher and selected B using the arrow keys. The demo totals stayed with their original firm. The test deleted an unused firm, archived the original seeded firm and checked its retained voucher count and both trial balance totals. After an offline relaunch, the Demo workspace restored Firm B as active and both firms’ saved details matched. Live had no firms in the test profile.
- Phase 2 verification covered the development build on Apple silicon. Packaged Phase 2 builds, Intel Mac and Windows were outside this run. The Phase 1 platform checks above remain pending.

### Phase 3 verification

- `python3 -B scripts/capture-prototype.py --check` matched the fixed-date fixture. `npm test` passed all nine tests. The desktop ledger replay matched all 40 vouchers and their posting lines, all 23 account balances, all seven site-by-account totals and both invoice snapshots. The trial balance totals were ₹21,98,000 debit and ₹21,98,000 credit.
- The tests covered opening balances, payments, receipts, contra transfers, journals, and linked reversals. They rejected unbalanced lines, fractional paise, unassigned contractor sites and cross-firm accounts, sites and voucher links. Repeating a committed request returned the existing voucher, including after reopening the workspace. Killing the writer after it inserted the header and first line left zero partial rows. Retrying with the same ID posted one complete voucher.
- `npm run test:desktop` passed on macOS 27.0 arm64 with Electron 45.3.2. In a disposable offline profile, the smoke test posted payment #41 for ₹5,000.25 from HDFC Bank to Anuj Kumar at Yamuna. The day book and the trial balance account drill-down opened #41. The Yamuna ledger closed at −₹12,999.75, and Back and Forward restored the site filter and voucher focus. After posting linked reversal #42, both trial balance totals returned to ₹21,98,000. The two voucher links still opened from the archived firm’s books after an offline relaunch.
- The same desktop test created a bank and a cash account in Firm A and posted a ₹75.10 opening balance against Opening capital. Firm A’s trial balance showed ₹75.10 on each side. Phase 3 package checks on macOS and Windows remain pending.

### Phase 4 verification

- `npm run test:desktop` passed on macOS 27.0 arm64 with Electron 45.3.2. In a disposable offline Demo profile, the keyboard workflow posted one ₹40,000 bank withdrawal with ₹30,000 assigned to Yamuna and ₹10,000 to Bodla. After a ₹2,000 cash receipt for Bodla, Anuj showed ₹38,000 net given. Yamuna showed ₹30,000 and Bodla ₹8,000. Both sites opened the same payment voucher. Bodla also opened the cash receipt.
- Assigning Ravi to Yamuna preserved Anuj’s totals. The smoke test searched by site and contractor name, restored the search and voucher focus with Back and Forward, and deleted Ravi’s unused record. A ₹30,000 settlement journal reduced Anuj’s ledger balance to ₹8,000 and kept net given at ₹38,000. The edited name and archived ledger persisted through offline restart and the journal still opened from the ledger.
- `npm test` passed all ten tests, including site and firm validation, shared assignments, idempotent split payments, historical postings after site removal, and reversal of an archived contractor’s payment. `python3 -B scripts/capture-prototype.py --check` matched the 40-voucher baseline.
- Phase 4 verification covered the development build on Apple silicon. Packaged macOS and Windows checks remain pending.

### Phase 5 verification

- `npm run test:desktop` passed on macOS 27.0 arm64 with Electron 45.3.2. The keyboard workflow used a disposable offline Demo profile and opened the books on 17 Nov 2026 with ₹20,000 in office cash and ₹0 in site cash. It used Enter and Shift+Tab to navigate forms, arrows to select accounts and the payee, Esc to cancel an entry, and Cmd+S to post.

| Date | Entry | Office cash | Vikram’s site cash | Total firm cash |
| --- | --- | ---: | ---: | ---: |
| 17 Nov 2026 | Opening cash | ₹20,000 | ₹0 | ₹20,000 |
| 18 Nov 2026 | ₹10,000 handed to Vikram | ₹10,000 | ₹10,000 | ₹20,000 |
| 19 Nov 2026 | ₹6,500 paid to Vikram Enterprises for site supplies | ₹10,000 | ₹3,500 | ₹13,500 |
| 20 Nov 2026 | ₹1,000 returned to office | ₹11,000 | ₹2,500 | ₹13,500 |

- Both histories referenced the same contra vouchers. The 19 Nov as-of view showed ₹3,500 and opened the ₹6,500 payment. Back restored the date and voucher focus. Forward reopened the payment, which showed Vikram Enterprises and its owner Vikram. The cashbook identified Vikram as custodian. The ₹2,500 balance and payment link survived an offline relaunch.
- `npm test` passed all 11 tests. The cashbook regression checked exact paise, posting dates, firm scope, duplicate saves, person and firm payees, reversals, archival with history and persistence. `python3 -B scripts/capture-prototype.py --check` matched the fixed-date 40-voucher baseline.
- Phase 8 remains responsible for applying cash payments to invoices. Phase 5 package checks on macOS and Windows remain pending.

### Phase 6 verification

- `npm run test:desktop` passed on macOS 27.0 arm64 with Electron 45.3.2. The offline workflow created Vikram in disposable Demo books, linked the existing site cashbook to his employee record, and opened its voucher history from his company-cash view. Back restored keyboard focus to the cashbook link.
- A ₹2,000 advance posted to the employee’s advance ledger. ₹24,000 salary earned credited the employee payable and debited Salaries. Applying the advance left ₹22,000 payable and cleared the advance. The bank payment cleared salary payable. The trial balance showed ₹24,000 in Salaries, and Vikram still held ₹2,500 of company cash.
- The keyboard workflow posted and repaid a separate ₹300 advance and paid a ₹500 reimbursement. It opened the repayment from the advance ledger and checked the reimbursement and ₹2,500 cash balance after restart. The SQLite regression also covered manual adjustments, over-application and over-repayment, duplicate payroll saves, reimbursement reversal, custodian rename and archive history.
- The [daily-entry sample pilot](#daily-entry-sample-pilot) is ready for the accountant walkthrough. Feedback and sign-off on the entry order, search and site totals are pending.

### Phase 7 verification

- In the same offline desktop test, a manually entered ₹5,000 payment to Anuj at Yamuna was matched from a CSV statement row. The next ₹5,000 row was posted from XLSX as a second voucher. Both vouchers opened from the bank book and Anuj’s Yamuna ledger. Inspecting a candidate and going Back restored focus to the voucher link.
- Reimporting the identical CSV added zero rows. The overlapping XLSX preserved the two same-value payments, including identical rows occurring twice in an export. A malformed date identified source row 3 and the batch added zero rows. The SQLite regression also checked atomic imports, signed amounts and debit/credit mapping, exact paise and worksheet selection.
- The bank book showed −₹15,000 both before and after importing pending rows. Matching the manual voucher preserved that balance. Posting a new voucher moved it to −₹20,000. Two candidate vouchers for another statement row required an explicit choice, so that row and a pending deposit were still pending after an offline restart. The SQLite regression checked firm scope, repeated confirmation, reversal releasing the match, reposting, and preserving pending rows when a bank account is archived.
- Matching looks for the same date, signed bank amount, counterparty and site. Overlap detection uses those source rows’ date, description, reference, amount and occurrence count. Two separately exported movements with identical fields and no shared export showing both cannot be distinguished.
- `npm test` passed all 13 tests. `python3 -B scripts/capture-prototype.py --check` matched all 40 baseline vouchers. Both phases were checked on the Apple silicon development build. Packaged Mac and Windows verification remains pending.

### Daily-entry sample pilot

Run `npm run test:desktop` to prepare and exercise the sample workflow in a disposable, offline Demo profile. For an accountant walkthrough, start in Demo, create a fresh pilot firm, and use the following entries in order. Use a bank account funded with at least ₹70,000 and enter ₹20,000 of dated opening cash in an office cashbook. Create employee Vikram and select him as custodian of a site cashbook opened at ₹0.

| Walkthrough | Entries | Check on screen |
| --- | --- | --- |
| Contractor payments | Assign Anuj to Yamuna and Bodla. Pay ₹40,000 from the bank with ₹30,000 at Yamuna and ₹10,000 at Bodla. Receive ₹2,000 into office cash for Bodla. | Anuj shows ₹38,000 net given. Yamuna shows ₹30,000 and Bodla ₹8,000. Both sites open the original payment. |
| Cash held | Hand over ₹10,000 from office cash to Vikram’s site cashbook. Pay ₹6,500 for site supplies and return ₹1,000 to office cash. | Vikram holds ₹2,500. The ₹6,500 expense is the only cashbook movement that changes total company cash. |
| Salary and advance | Pay a ₹2,000 salary advance. Record ₹24,000 salary earned. Apply ₹2,000 from the advance ledger and pay ₹22,000 by bank. | Salary payable and advance outstanding are ₹0. Salaries show a debit of ₹24,000. Company cash held shows ₹2,500. |
| Repayment and reimbursement | Pay a new ₹300 advance, receive its repayment into office cash, and pay a ₹500 site-supplies reimbursement from the bank. | Repayment opens from the salary advance ledger. Reimbursement opens from salary and reimbursements. Salary balances stay settled and site cash stays at ₹2,500. |

Use Enter, Shift+Tab and the arrow keys to move through the forms, Esc to leave a draft, and Cmd+S or Ctrl+S to post. Ask the accountant to try the entry order, find Anuj by name and site, compare the two site totals, and trace the salary and cashbook vouchers. Record feedback on entry order, contractor search and site totals after the walkthrough.

**Accountant feedback pending.** The walkthrough with the accountant, their comments on entry order and search, and their sign-off on site totals remain open.
