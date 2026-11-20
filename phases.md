# Build phases and progress

**Starting point, 20 November 2026.** The checkout contains the Python/SQLite prototype and an HTML shell. The desktop build begins with phase 1. Each of the six business modules has its own implementation prompt.

## Milestones

| Phase | Status | Working result |
| --- | --- | --- |
| 1. Desktop foundation | Planned | An offline Electron app can reopen its local workspace on Mac and Windows. |
| 2. Firms | Planned | The accountant can create two firms and switch between their books. |
| 3. Vouchers and accounting core | Planned | A posted voucher can be opened from the day book, account ledger and trial balance. |
| 4. Contractors | Planned | A single bank payment can be split across sites and traced back from Anuj’s ledger. |
| 5. Cashbooks | Planned | Vikram’s cashbook reconciles money entrusted, spent, returned and still held. |
| 6. Employees | Planned | Salary, advances and reimbursements can be followed separately from cash held for the firm. First accountant pilot. |
| 7. Bank | Planned | The accountant can import a statement, match or post each row, and resume after restart. |
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

### Reproduce the prototype baseline

Repeat the fixed-date check from the project root using the [build guide](docs/BUILD.md#reproduce-the-prototype-baseline). For the reading order and handover convention, see the [documentation index](docs/README.md).
