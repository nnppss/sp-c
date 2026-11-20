# Build and verify SP & Company Accounts

## Desktop development

Use Node.js 24 with npm 11 from the project root. Use Python 3.10 or later to regenerate or verify the prototype fixture. The first install needs access to the npm registry, the SheetJS CDN and Electron downloads. Once installed, the development app loads the same local renderer used in packaged builds.

```sh
npm ci
npm exec -- install-electron
npm run dev
```

`npm run dev` compiles TypeScript, builds the renderer with Vite and opens Electron. Re-run it after edits. The app opens in Live by default. The Live and Demo buttons open `workspaces/live.sqlite3` and `workspaces/demo.sqlite3` under Electron’s `userData` directory. Open Workspace settings to change the displayed name. Demo contains the fixed-date prototype books, and a new Live workspace starts empty. Use Firms to manage the directory and the Active firm control in the toolbar to switch books. Each workspace saves its own selection. In Vouchers, use Chart of accounts to create bank, cash or other accounts and Day book to post vouchers. In Sale & Purchase, enter the invoice, then choose the booking firm and any amount or percentage allocation before issuing. Open the saved invoice for print, PDF, notes and receipts or payments. In Cashbooks, use Pay supplier bill to apply a payment from that cashbook. In Reports, select a report, firm and date filter. Select a linked account, invoice, statement row or voucher to open its source. The print and export actions use the full filtered report, including rows on subsequent pages. Development and packaged smoke tests use disposable profiles.

## Regression and desktop checks

```sh
python3 -B scripts/capture-prototype.py --check
npm test
npm run test:desktop
```

The fixture check compares the checked-in JSON with a fresh fixed-date Python seed. Vitest checks SQLite migrations, firm persistence, voucher validation, duplicate saves, interruption recovery and linked reversals. It reconciles the demo ledger to the captured account and site balances and checks the issued invoice snapshots. The Electron smoke posts an opening balance and a payment, follows the payment through the reports, reverses it and checks the posted history after an offline restart. It also checks keyboard navigation, focus restoration and firm switching. Run on a graphical desktop. On Windows, use `py -3 -B` in place of `python3 -B`.

The same Electron command runs the daily-entry pilot, CSV/XLSX review, invoice entry and reporting workflows offline in disposable Demo books. It checks output through temporary PDF and CSV files. On macOS it also compares PDF text with the screen totals using the built-in PDFKit framework. See the [pilot worksheet](../phases.md#daily-entry-sample-pilot) for the entries and expected balances.

## Back up and recover books

1. Finish saving any open drafts. Select **Live** or **Demo**, open **Workspace settings** and choose **Save backup**. Save the `.sqlite3` file outside the app's workspaces folder. It contains every firm and all committed records in the selected workspace.
2. To move books, copy that single file to the other computer and install the same or a newer app release. Open the matching **Live** or **Demo** workspace, then choose **Restore backup** in **Workspace settings**. Select the file and confirm **Restore**. This replaces all firms and records in that workspace.
3. Wait for **Workspace restored**. Open **Firms** and confirm the selected firm. Open **Reports**, **Sale & Purchase**, **Contractors** and **Bank** to check your balances, issued invoices, allocations, site totals and pending rows. Quit and reopen the app offline to confirm the restored books persist.
4. If restore reports an error, reopen the app and check the existing firm list and balances. For a valid restore, the app first saves the previous books as `live.before-restore.sqlite3` or `demo.before-restore.sqlite3` next to the workspace under `userData/workspaces`. To undo the restore, select that file in **Restore backup**. Copy it elsewhere first if you need to keep it across subsequent restores.

The packaged app's default `userData` folder is `~/Library/Application Support/sp-company-accounts` on macOS or `%APPDATA%\sp-company-accounts` on Windows. If damaged books prevent the app from opening the workspace, quit the app fully and move the affected workspace database and any matching `-journal`, `-wal` and `-shm` files together into a separate folder. Keep those files and any recovery snapshot. Reopen the app to create a fresh workspace of the same type, then restore from a known-good backup. Copy the recovery snapshot outside the app's workspaces folder before attempting this recovery so the fresh workspace's recovery copy cannot replace it.

## Package and smoke-test

```sh
npm run package:mac
npm run package:win
```

Run the macOS build on macOS. It produces separate Apple silicon and Intel disk images in `release/`. The Windows build produces an x64 NSIS installer and uses the pinned multi-platform NSIS toolset. Test installation on Windows. The phase tracker records artifacts and completed checks. [Phase 10 verification](../phases.md#phase-10-verification)

- On macOS, open the DMG for the machine's architecture, copy **SP Company Accounts.app** to Applications, then launch the copy. The package uses ad-hoc signing and macOS may require approval to open it. Eject the DMG after copying.
- On Windows x64, launch `sp-company-accounts-0.1.1-win-x64.exe` and open **SP Company Accounts** from the Start menu. The installer is unsigned and Windows may show a reputation prompt. The default per-user executable is `%LOCALAPPDATA%\Programs\sp-company-accounts\SP Company Accounts.exe`.

Use the built Electron executable to run the same smoke test against a package. For example, from the project root on macOS or Windows respectively:

```sh
npm run test:packaged -- "release/mac-arm64/SP Company Accounts.app/Contents/MacOS/SP Company Accounts"
```

```powershell
npm run test:packaged -- ".\release\win-unpacked\SP Company Accounts.exe"
```

To check an installer, mount the DMG or run the Windows installer first and pass the mounted or installed executable path. For a build that uses cached Electron archives, append `-- --config.electronDist=/path/to/archives` to the packaging command. Keep the original archive filenames and use the pinned Electron version.

### Recovery release check

Run the recovery smoke with the installed executable. Run `npm run build` first if using `.` as the target for the development build. The smoke uses disposable profiles, blocks network access, exercises the settings buttons by keyboard, and supplies test paths and responses to the native dialogs. It compares both firms' account balances, issued invoices, allocations, site totals and pending rows after restore and an offline restart. It also checks that invalid input preserves the existing books and that the recovery copy can be restored.

```sh
npm run test:recovery -- "/Applications/SP Company Accounts.app/Contents/MacOS/SP Company Accounts" release/qa
```

Transfer `phase-10-sample.sqlite3` and `phase-10-sample.json` from the specified output folder to the Windows machine. After installing, run the packaged smoke and the recovery import with that same pair.

```powershell
$exe = "$env:LOCALAPPDATA\Programs\sp-company-accounts\SP Company Accounts.exe"
npm run test:packaged -- "$exe"
npm run test:recovery -- "$exe" "C:\path\to\qa" import
```

For the reverse check, run recovery on Windows with a new output folder and omit `import`. Transfer that pair back to macOS and run recovery there with `import`. To exercise the actual file pickers and confirmation prompts, repeat the backup and restore steps above with disposable workspaces and check the values in the phase tracker.

## Start the local backend

From the project root, use Python 3 with the standard-library SQLite module. The following command creates a dedicated demo database on first launch and reopens it on later runs.

```sh
python3 -B app.py --database books/demo.sqlite3
```

The prototype listens on the loopback address printed in the terminal. Open `/api/state?firm=1` at that address to inspect the seeded firm. The root page is an HTML shell whose JavaScript and stylesheet are still pending. Stop the process with Ctrl+C. On Windows, the Python launcher equivalent is `py -3 -B app.py --database books/demo.sqlite3`.

## Reproduce the prototype baseline

Run this check from the project root in a shell that supports heredocs, such as zsh or Bash. It seeds 20 November 2026 in memory. It checks each voucher, both sides of the trial balance and the issued sale and purchase totals without opening a workspace database.

```sh
python3 -B - <<'PY'
from datetime import date
from app import connect, seed
from ledger import SCHEMA, state

with connect(":memory:") as db:
    db.executescript(SCHEMA)
    seed(db, date(2026, 11, 20))
    vouchers = state(db, 1)["vouchers"]

balances = {}
assert len(vouchers) == 40
for voucher in vouchers:
    assert sum(line["value"] for line in voucher["lines"]) == 0
    for line in voucher["lines"]:
        account = line["account"]
        balances[account] = balances.get(account, 0) + line["value"]

assert sum(v for v in balances.values() if v > 0) == 219_800_000
assert sum(-v for v in balances.values() if v < 0) == 219_800_000
invoices = [(v["kind"], v["amount"]) for v in vouchers if v["document"]]
assert sorted(invoices) == [("Purchase", 6_372_000), ("Sale", 11_328_000)]
print("Prototype baseline passed")
PY
```

The expected output is `Prototype baseline passed`. To generate the fixture from the same seed, run `python3 -B scripts/capture-prototype.py`. The JSON in `fixtures/prototype-2026-11-20.json` contains all 40 vouchers with their original posting and site IDs, accounts, contractor assignments, closing balances, site-by-account balances and the two saved invoice snapshots. Amounts are signed integer paise where applicable.
