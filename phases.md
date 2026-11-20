# Build phases and progress

**Last verified 20 November 2026.** The workspace contains a Python/SQLite accounting prototype and an HTML shell. The Electron desktop build starts at phase 1. The next task is to capture the fixed-date sample books and package a minimal application that can create and reopen a local firm on both operating systems.

Use the [delivery plan](plan.md) for sequencing, the [architecture](architecture.md) for implementation decisions and the [product specification](software.md) for expected behaviour.

## Milestones

Use **Planned**, **In progress**, **Blocked** or **Verified** for each phase. When a status changes, record the date and a test result, build, or specific blocker in the progress log. Verify a phase when its completion check passes.

| Phase | Status | Deliverable | Completion check |
| --- | --- | --- | --- |
| 1. Desktop foundation | Planned | Electron, React and TypeScript project, keyboard navigation, firm setup, schema migrations, separate demo workspace and initial Mac/Windows packages. | Install on each platform. Create a firm offline, quit, reopen and find the same firm. Navigate forward and back with the keyboard. |
| 2. Accounting core | Planned | Chart of accounts, opening balances, payment, receipt, contra and journal vouchers, reversals, day book and trial balance. | Compare the TypeScript postings with the fixed-date prototype fixture account by account. Retry a save and interrupt a write. Verify one complete voucher on retry and no partial posting after failure. |
| 3. Contractors, cashbooks and employees | Planned | Site assignments, chronological and site-wise ledgers, bank/cash entries, split payments, employee transactions, custody and returns. | Run the Anuj and Vikram examples in the product spec. Verify ₹38,000 net given to Anuj and ₹2,500 held by Vikram. Post an employee advance and check its ledger separately from site cash. Pilot with the accountant on sample books. |
| 4. Bank statements | Planned | Bank accounts, CSV/XLSX preview, column mapping, saved review queue, From/To details, duplicate detection and voucher matching. | Reimport an overlapping statement, match a previously entered ₹5,000 payment and post an unrecorded row. Preserve two genuine same-value payments. Reopen the app and resume unreviewed rows. |
| 5. Sales, purchases and firm allocation | Planned | Editable and printable invoice template, GST, credit/debit notes, bill-linked payments, management splits and PDF. | Enter and print a multi-line invoice using the keyboard. Allocate a ₹1,00,000 pre-tax bill ₹60,000/₹40,000. Verify the supplier payable and GST occur once, partial payment reduces the outstanding bill, and an address edit leaves the issued copy intact. |
| 6. Reporting, recovery and release | Planned | Financial statements, outstanding bills, bank reconciliation, registers, GST and management reports, export, backup, restore and release installers. | Reconcile a sample month against the accountant’s books. Restore a backup across Mac and Windows. Compare balances, vouchers, invoice copies and pending statement rows. Record platform builds and results here. |

## Build prompts

Open this project in Codex and paste one block at a time, in order. Each block works in a fresh implementation chat with access to the same checkout.

For each phase, inspect the current code and prior handover, implement the remaining work, and test it through the app. Use sample books for testing. Fix failures you can reproduce. Update the milestone row and progress log with the date, commands, results and any pending checks. Keep the build guide current when run or packaging commands change. A missing platform runner or accountant review can remain pending while independent work continues. Record a check as passed only after observing its result.

### Phase 1. Desktop foundation

```text
Implement Phase 1 of phases.md in this project. Follow its build instructions and the design in architecture.md. Capture the fixed-date Python prototype’s 40 vouchers as regression fixtures, including individual postings, site assignments, account balances and invoice totals.

Build a runnable offline Electron app with React, Vite, Node and TypeScript. Wire the sandboxed renderer through a typed preload bridge to the SQLite worker. Implement schema migrations, separate demo and live workspaces, and firm creation, editing and selection. Implement keyboard navigation, visible shortcuts and Back/Forward with focus restoration.

Add reproducible development, test and packaging commands. Build and smoke-test on available macOS and Windows targets. Create a firm through the UI, restart offline, and confirm it reopens in the correct workspace. Record installer paths, platforms tested and outstanding checks in phases.md.
```

### Phase 2. Accounting core

```text
Implement Phase 2 of phases.md in the existing Electron app. Follow its build instructions and the posting rules in architecture.md. Build the chart of accounts, opening balances, payments, receipts, contra transfers, journals and linked reversals. Expose voucher entry, account ledgers, the day book and a drill-down trial balance through the keyboard UI.

Use integer paise, firm-scoped accounts and atomic postings. Verify that a repeated save creates one voucher, a failed write leaves no partial entry, and a reversal preserves the original. Compare the TypeScript ledger with the phase 1 fixture account by account. The sample closing debit and credit balances should each total ₹21,98,000. Run the checks and update phases.md.
```

### Phase 3. Contractors, cashbooks and employees

```text
Implement Phase 3 of phases.md on the shared ledger. Follow its build instructions and software.md. Deliver searchable contractors and sites with many-to-many assignments, chronological and site-wise ledgers, split payments from a bank or cashbook, and manual settlement entries. Support editing, deleting unused records and archiving records with history. Build named employee ledgers and cashbooks with independent funding firm, custodian and payee.

Using only the keyboard, pay Anuj ₹30,000 for Yamuna and ₹10,000 for Bodla in one voucher. Return ₹2,000 against Bodla and verify ₹38,000 net given. Give Vikram ₹10,000, spend ₹6,500 and return ₹1,000. Verify ₹2,500 held and check that his salary ledger is independent. Run the tests, prepare the sample pilot and record results and any outstanding accountant review in phases.md.
```

### Phase 4. Bank statements

```text
Implement Phase 4 of phases.md in the Bank module. Follow its build instructions and software.md. Support bank account creation, editing, deletion or archival, and manual entries. Use SheetJS to preview XLSX and CSV exports, map columns and save a review queue that survives restart. Let the accountant open a row, confirm From, To, amount and site, then post a voucher or link an existing bank movement.

Test both paths with a ₹5,000 payment to Anuj at Yamuna. Reimport the same file and an overlapping statement. Verify that a matched payment appears once, two genuine same-value payments survive, ambiguous matches stay available for review, and an unreviewed row leaves the ledger balance unchanged. Exercise a malformed row and resume a pending row after restart. Update phases.md with the results.
```

### Phase 5. Invoices and firm allocation

```text
Implement Phase 5 of phases.md in Sale & Purchase. Follow its build instructions and the invoice fields in software.md. Build a keyboard-editable invoice template with Enter advancing through fields and line items. Support decimal quantities and rates, CGST/SGST or IGST, credit and debit notes, bill-linked partial payments, printing and PDF. Save an issued snapshot. At the end of entry, choose the booking firm and assign the pre-tax amount to one or more firms by amount or percentage.

Book a ₹1,00,000 pre-tax purchase in Firm A and allocate ₹60,000 to A and ₹40,000 to B. Verify the supplier payable and GST post once, allocations add up, and a cashbook payment against the bill reduces the outstanding amount. Create a sale invoice, change the firm address, and confirm its reprinted PDF still shows the issued details and totals. Run the checks and update phases.md.
```

### Phase 6. Reporting, recovery and release

```text
Implement Phase 6 of phases.md. Follow its build instructions and complete the reports in software.md. Deliver profit and loss, balance sheet, outstanding bills, bank reconciliation, GST summaries, sales and purchase registers, and the combined firm-allocation view. Support period filters, drill-down to source vouchers, printing and export.

Implement consistent backup, validated restore and recovery from a failed restore. Exercise an upgrade on populated sample books. Package the Mac and Windows installers and run the available installation and cross-platform restore checks. Compare voucher counts, per-account balances, issued invoices and pending bank rows. Reconcile a representative month with accountant-provided figures when available. Record the build artifacts, test results and outstanding platform or accountant checks in phases.md and update docs/BUILD.md with verified release commands.
```

## Progress log

| Date | Area | Evidence and remaining work |
| --- | --- | --- |
| 20 Nov 2026 | Repository baseline | The prototype contains posting, invoice, statement import/match and backup code. The HTML shell references scripts and styles that are absent. The project has no Electron package or desktop installer. [Prototype entry point](app.py) · [Ledger code](ledger.py) · [HTML shell](static/index.html) |
| 20 Nov 2026 | Prototype ledger check | With the seed date fixed at 20 Nov 2026, all 40 vouchers balanced individually. Closing debit and credit balances each totalled ₹21,98,000. The saved sale totalled ₹1,13,280 and the purchase ₹63,720. This checks the sample ledger. The six desktop milestones await their own acceptance checks. |

### Reproduce the prototype baseline

Repeat the fixed-date check from the project root using the [build guide](docs/BUILD.md#reproduce-the-prototype-baseline). For the reading order and handover convention, see the [documentation index](docs/README.md).
