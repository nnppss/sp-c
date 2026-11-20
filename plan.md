# Delivery plan

Deliver the daily-entry pilot after phase 6 (Employees) and the first full desktop release after phase 10 (Backup, restore and release). Each of the six business modules has a dedicated implementation phase. Open the [build prompts](phases.md#build-prompts) to execute them individually or use the repeatable prompt to pick up the next phase.

## From prototype to desktop

1. **Phases 1–3 establish the books.** Capture the Python prototype’s fixed-date fixtures, package the Electron shell, build Firms, then implement vouchers and the trial balance within the selected firm. The accounting core supplies basic bank and cash ledgers for the next modules.
2. **Phases 4–6 deliver daily entry.** Build Contractors, Cashbooks and Employees individually. Pilot the two-site payment to Anuj, Vikram’s cash handover and an employee advance through the keyboard UI.
3. **Phases 7–8 add document workflows.** Bank adds statement review and matching to existing manual entries. Sale & Purchase adds issued invoices, GST, bill-linked payments and firm allocations. Exercise both modules with representative bank exports and an invoice printout.
4. **Phases 9–10 reconcile and release.** Reports trace financial and management totals down to their source vouchers. Test installers and backup recovery across platforms, and compare a representative month with the accountant’s reference books.

## Decisions that guide implementation

| Decision | Consequence for the build |
| --- | --- |
| Each installation is an independent local workplace. | Ship a self-contained Electron runtime. Use a local workspace file and explicit backup and restore. |
| The accountant settles contractors manually. | Capture payments, receipts, site attribution and later journal entries. Label net money given clearly so it cannot be mistaken for an agreed work value. |
| Staff cash is money under custody. | A handover moves money between cash accounts. Record an expense, bill payment or cash return when it happens. Salary and cash custody have separate ledgers. |
| The booking firm and the beneficiary can differ. | Post supplier/customer and GST once in the booking firm. Keep management allocations separate from financial posting lines. |
| Bank input uses structured exports. | Accept CSV and XLSX, preview the original fields and leave the accountant in control of matching or posting. |

## Evidence for pilot and release

- **Pilot.** Use clean sample books, carry out the Contractors, Cashbooks and Employees scenarios, and record the accountant’s feedback on entry order, search and site totals.
- **Release.** Exercise keyboard-only entry, date filters and drill-downs, repeated saves, failed imports, historical invoice printing and restoration on another operating system. Compare ledger totals and outstanding items as well as debit/credit equality. A balanced trial balance can still contain a posting to the wrong account.
- **Keep the docs current.** Update [software.md](software.md) when the accountant’s workflow or scope changes, [architecture.md](architecture.md) when an implementation decision changes, and this plan when the delivery sequence changes. After a milestone or a failed acceptance check, update [phases.md](phases.md) with the date, result and remaining work.
