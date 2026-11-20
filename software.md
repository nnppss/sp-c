# SP & Company Accounts

SP & Company Accounts is a local desktop accounting application for the office accountant. A payment entered once can be opened from the bank book, the recipient’s ledger, the site record and the trial balance. Each installation on macOS or Windows keeps its own books and works offline.

This is the product specification for the first desktop release. Build status and test evidence live in the [phase tracker](phases.md). For implementation, see the [architecture](architecture.md) and [delivery plan](plan.md).

## The six modules

| Module | What the accountant needs to do |
| --- | --- |
| Contractors | Add, edit and remove contractors. Assign several sites to a contractor and several contractors to a site. Search by either name. Open a contractor’s chronological money list or group it by site. See money given, money received, payment method and running balance. Enter the final settlement when the accountant has agreed it. |
| Bank | Add and remove bank accounts, enter transactions manually and review original Excel (.xlsx) or CSV statements. Select a row to inspect its date, amount and narration, fill in From, To and site as applicable, then post a voucher or match an existing entry. Resume pending rows after closing the app. |
| Sale & Purchase | Create sales and purchase invoices in a printable template. Enter invoice number and date, issuer, customer or supplier, consumer details, item description, quantity, unit, rate and GST. Show applicable CGST, SGST or IGST and the total. At the end, select the booking firm and any management allocation. Save, print or export the issued copy as a PDF. Item quantities serve invoice calculations. |
| Cashbooks | Create named cashbooks, recording the funding firm, custodian and opening cash with its date. Record handovers, expenses, payments to people or firms, and returns. Show the counterparty, purpose and cash still held. A custodian can also own a firm that receives a payment. |
| Employees | Open a named ledger for salary entries, advances, repayments, reimbursements and adjustments. An employee who holds site cash can also be selected as a cashbook custodian. The accountant can inspect the employee balance and cash held independently. |
| Firms | Maintain the firm’s name, owner, address and GST details. Open an individual firm’s books and review the combined management view. Keep trading parties, the firm that books an invoice and the firms sharing its value identifiable. |

Unused records can be deleted. Records referenced by vouchers or statement rows can be archived, keeping historical entries available.

## How the books should read

- **Anuj at two sites.** Pay ₹40,000 from the bank, assigning ₹30,000 to Yamuna and ₹10,000 to Bodla. If Anuj returns ₹2,000 for Bodla, his money list shows ₹38,000 net given. The site view shows ₹30,000 at Yamuna and ₹8,000 at Bodla. The accountant posts any subsequent settlement.
- **Reviewing a bank payment.** A bank export shows a ₹5,000 withdrawal. Open the row, confirm that the bank paid Anuj for Yamuna, and select the matching voucher if the accountant already entered it. If this is the first entry, post it from the review screen. Either path ends with one ₹5,000 payment that can be opened from the statement or Anuj’s site ledger.
- **Vikram’s site cash.** Transfer ₹10,000 from office cash to Vikram’s cashbook. Total company cash is unchanged at handover. After ₹6,500 is spent and ₹1,000 is returned, he holds ₹2,500. If the ₹6,500 pays an invoice from his own firm, apply the payment to that bill and retain the link.
- **One supplier bill shared by two firms.** Firm A receives a bill for ₹1,00,000 before tax. Book the supplier and GST in A. Allocate ₹60,000 to A and ₹40,000 to B for management reporting. The accountant can enter a separate inter-firm journal when needed. With a single beneficiary, the allocation defaults to 100% to the booking firm.

## Daily entry and reporting

Each module opens as a page in the desktop window. Back and Forward restore the previous selection, filters and keyboard focus. Show shortcuts on the page where they apply. Support keyboard search, arrow-key selection, Enter to advance, Shift+Tab to return to a field, Esc to dismiss, and Ctrl+S or Cmd+S to save. Keep invoice totals and actions visible while the active edit field moves through the template. Paginate long registers.

The accountant uses opening balances, payments, receipts, contra transfers, journals, sales, purchases, credit notes and debit notes. Reports cover the day book, account ledgers, trial balance, profit and loss, balance sheet, outstanding bills, bank reconciliation, sales and purchase registers, GST summaries and firm allocations. A report total drills down to its vouchers. The GST workflow ends with review, printing and export for the accountant.
