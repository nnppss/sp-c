# Build and verify SP & Company Accounts

## Desktop development

Use Node.js 24 with npm 11 from the project root. Use Python 3.10 or later to regenerate or verify the prototype fixture. The first install needs access to the npm registry and Electron downloads. Once installed, the development app loads the same local renderer used in packaged builds.

```sh
npm ci
npm exec -- install-electron
npm run dev
```

`npm run dev` compiles TypeScript, builds the renderer with Vite and opens Electron. Re-run it after edits. The app opens in Live by default. The Live and Demo buttons open `workspaces/live.sqlite3` and `workspaces/demo.sqlite3` under Electron’s `userData` directory. Open Workspace settings to change the displayed name. Demo contains the fixed-date prototype books, and a new Live workspace starts empty. Use Firms to manage the directory and the Active firm control in the toolbar to switch books. Each workspace saves its own selection. In Vouchers, use Chart of accounts to create bank, cash or other accounts and Day book to post vouchers. In Reports, select a trial balance account to open its ledger, then select a voucher number to see its posting lines. Development and packaged smoke tests use disposable profiles.

## Regression and desktop checks

```sh
python3 -B scripts/capture-prototype.py --check
npm test
npm run test:desktop
```

The fixture check compares the checked-in JSON with a fresh fixed-date Python seed. Vitest checks SQLite migrations, firm persistence, voucher validation, duplicate saves, interruption recovery and linked reversals. It reconciles the demo ledger to the captured account and site balances and checks the issued invoice snapshots. The Electron smoke posts an opening balance and a payment, follows the payment through the reports, reverses it and checks the posted history after an offline restart. It also checks keyboard navigation, focus restoration and firm switching. Run on a graphical desktop. On Windows, use `py -3 -B` in place of `python3 -B`.

## Package and smoke-test

```sh
npm run package:mac
npm run package:win
```

Run the macOS build on macOS. It produces separate Apple silicon and Intel disk images in `release/`. Run the Windows build on Windows for an x64 NSIS installer. The phase tracker records artifacts and platform checks. [Phase tracker](../phases.md)

Use the built Electron executable to run the same smoke test against a package. For example, from the project root on macOS or Windows respectively:

```sh
npm run test:packaged -- "release/mac-arm64/SP Company Accounts.app/Contents/MacOS/SP Company Accounts"
```

```powershell
npm run test:packaged -- ".\release\win-unpacked\SP Company Accounts.exe"
```

To check an installer, mount the DMG or run the Windows installer first and pass the mounted or installed executable path. macOS builds use ad-hoc signing. Windows builds are unsigned. For a build that uses cached Electron archives, append `-- --config.electronDist=/path/to/archives` to the packaging command. Keep the original archive filenames and use the pinned Electron version.

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
