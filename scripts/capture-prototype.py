"""Capture the fixed-date prototype books in integer paise."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))

from app import connect, seed
from ledger import SCHEMA, state


def capture():
    seed_date = date(2026, 11, 20)
    with closing(connect(":memory:")) as db:
        db.executescript(SCHEMA)
        seed(db, seed_date)
        books = state(db, 1)

    balances = Counter({account["id"]: 0 for account in books["accounts"]})
    site_balances = Counter()
    vouchers = books["vouchers"]
    assert len(vouchers) == 40
    for voucher in vouchers:
        assert sum(line["value"] for line in voucher["lines"]) == 0
        for line in voucher["lines"]:
            balances[line["account"]] += line["value"]
            if line["site"] is not None:
                site_balances[line["site"], line["account"]] += line["value"]

    debit = sum(value for value in balances.values() if value > 0)
    credit = sum(-value for value in balances.values() if value < 0)
    assert debit == credit == 219_800_000
    invoices = [(v["kind"], v["amount"]) for v in vouchers if v["document"]]
    assert sorted(invoices) == [("Purchase", 6_372_000), ("Sale", 11_328_000)]
    books["assigned"].sort(key=lambda row: (row["account"], row["site"]))
    return {
        "seedDate": seed_date.isoformat(),
        **books,
        "balances": [{"account": account, "value": value} for account, value in sorted(balances.items())],
        "siteBalances": [
            {"site": site, "account": account, "value": value}
            for (site, account), value in sorted(site_balances.items())
        ],
        "trialBalance": {"debit": debit, "credit": credit},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = root / "fixtures" / "prototype-2026-11-20.json"
    contents = json.dumps(capture(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if path.read_text(encoding="utf-8") != contents:
            sys.exit("Prototype fixture differs from the fixed-date seed.")
        print("Prototype fixture matches the fixed-date seed (40 vouchers).")
    else:
        path.parent.mkdir(exist_ok=True)
        path.write_text(contents, encoding="utf-8", newline="\n")
