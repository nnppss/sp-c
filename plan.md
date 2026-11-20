# Delivery plan

Deliver the first accountant pilot after phase 3 and the first full desktop release after phase 6. Build the shared ledger early so the accountant can trace an entry from a day-to-day screen into the books throughout development. The [phase tracker](phases.md) holds the work queue, current status and acceptance evidence.

## From prototype to desktop

1. **Capture the starting books.** Seed the existing Python backend with a fixed date. Capture per-account balances, dated voucher lines, site attribution and the issued invoice totals as regression fixtures. Use the baseline in the tracker to catch changes during the TypeScript port.
2. **Prove the installation path early.** Package a small Electron app on Mac and Windows. Create a firm, write to SQLite, quit and reopen it offline. Resolve runtime or data-path issues before adding accounts screens.
3. **Deliver one complete posting path.** Enter a payment, commit its voucher, open it from the account ledger and verify the trial balance. Extend this same path to the remaining voucher types and module screens.
4. **Pilot daily money records.** With sample books, let the office accountant enter a two-site payment to Anuj, a cash handover to Vikram and an employee advance using the keyboard. Check the figures and the effort required to move between entries.
5. **Add the document workflows.** Build bank review and matching, then invoicing, bill-linked payments and firm allocation. Use representative anonymised bank exports and a sample invoice layout to verify column handling, entry order and printed output.
6. **Reconcile before release.** Run a representative month through the app and compare it with the accountant’s reference books. Investigate differences by voucher. Test backup and restore between platforms, including pending bank rows and invoices issued before a firm’s address changed.

## Decisions that guide implementation

| Decision | Consequence for the build |
| --- | --- |
| Each installation is an independent local workplace. | Ship a self-contained Electron runtime. Use a local workspace file and explicit backup and restore. |
| The accountant settles contractors manually. | Capture payments, receipts, site attribution and later journal entries. Label net money given clearly so it cannot be mistaken for an agreed work value. |
| Staff cash is money under custody. | A handover moves money between cash accounts. Record an expense, bill payment or cash return when it happens. Salary and cash custody have separate ledgers. |
| The booking firm and the beneficiary can differ. | Post supplier/customer and GST once in the booking firm. Keep management allocations separate from financial posting lines. |
| Bank input uses structured exports. | Accept CSV and XLSX, preview the original fields and leave the accountant in control of matching or posting. |

## Evidence for pilot and release

- **Pilot.** Use clean sample books, carry out the phase 3 scenarios and record the accountant’s feedback on entry order, search and site totals.
- **Release.** Exercise keyboard-only entry, date filters and drill-downs, repeated saves, failed imports, historical invoice printing and restoration on another operating system. Compare ledger totals and outstanding items as well as debit/credit equality. A balanced trial balance can still contain a posting to the wrong account.
- **Keep the docs current.** Update [software.md](software.md) when the accountant’s workflow or scope changes, [architecture.md](architecture.md) when an implementation decision changes, and this plan when the delivery sequence changes. After a milestone or a failed acceptance check, update [phases.md](phases.md) with the date, result and remaining work.
