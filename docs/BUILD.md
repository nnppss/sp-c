# Run and verify the accounting prototype

The current checkout contains a Python/SQLite backend and an HTML shell. The Electron application and its installers are phase 1 deliverables. This guide covers commands available in this checkout. See the [phase tracker](../phases.md) for delivery status.

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

The expected output is `Prototype baseline passed`. Add the desktop install, test and packaging commands here as they become available on each platform.
