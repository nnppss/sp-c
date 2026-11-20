import type { DatabaseSync } from 'node:sqlite';

export const invoiceSchema = `
  CREATE TABLE invoice_records (
    voucher_id INTEGER PRIMARY KEY,
    firm_id INTEGER NOT NULL,
    party_id INTEGER NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Sale', 'Purchase')),
    number TEXT NOT NULL,
    number_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
    original_id INTEGER,
    issuer_id INTEGER NOT NULL REFERENCES firms(id),
    request_json TEXT,
    UNIQUE (firm_id, voucher_id),
    FOREIGN KEY (firm_id, voucher_id) REFERENCES vouchers(firm_id, id),
    FOREIGN KEY (firm_id, party_id) REFERENCES accounts(firm_id, id),
    FOREIGN KEY (firm_id, original_id) REFERENCES invoice_records(firm_id, voucher_id)
  ) STRICT;
  CREATE INDEX invoice_by_firm ON invoice_records(firm_id, voucher_id);
  CREATE INDEX invoice_notes ON invoice_records(original_id);
  CREATE TABLE invoice_allocations (
    invoice_id INTEGER NOT NULL REFERENCES invoice_records(voucher_id),
    firm_id INTEGER NOT NULL REFERENCES firms(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    PRIMARY KEY (invoice_id, firm_id)
  ) STRICT;
  CREATE INDEX allocations_by_firm ON invoice_allocations(firm_id, invoice_id);
  CREATE TABLE bill_applications (
    voucher_id INTEGER PRIMARY KEY,
    firm_id INTEGER NOT NULL,
    invoice_id INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    FOREIGN KEY (firm_id, voucher_id) REFERENCES vouchers(firm_id, id),
    FOREIGN KEY (firm_id, invoice_id) REFERENCES invoice_records(firm_id, voucher_id)
  ) STRICT;
  CREATE INDEX applications_by_invoice ON bill_applications(invoice_id);
  CREATE TABLE statement_match_history (
    id INTEGER PRIMARY KEY,
    statement_id INTEGER NOT NULL REFERENCES statement_rows(id),
    voucher_id INTEGER NOT NULL REFERENCES vouchers(id),
    UNIQUE (statement_id, voucher_id)
  ) STRICT;
  INSERT INTO statement_match_history (statement_id, voucher_id)
    SELECT id, voucher_id FROM statement_rows WHERE voucher_id IS NOT NULL;
  CREATE VIEW bill_movements AS
    WITH sources AS (
      SELECT COALESCE(i.original_id, i.voucher_id) AS bill_id, i.voucher_id, i.firm_id, i.party_id, i.side, 0 AS application
      FROM invoice_records i
      UNION ALL SELECT i.voucher_id, b.voucher_id, b.firm_id, i.party_id, i.side, 1
      FROM bill_applications b JOIN invoice_records i ON i.voucher_id = b.invoice_id
    ), dated AS (
      SELECT s.*, v.id AS movement_id, v.day, v.kind FROM sources s JOIN vouchers v ON v.id = s.voucher_id
      UNION ALL SELECT s.*, r.id, r.day, r.kind FROM sources s JOIN vouchers r ON r.reverses_id = s.voucher_id
    )
    SELECT d.bill_id, d.movement_id AS voucherId, d.day, d.kind, d.application,
      CASE d.side WHEN 'Sale' THEN l.value ELSE -l.value END AS amount
    FROM dated d JOIN posting_lines l ON l.firm_id = d.firm_id AND l.voucher_id = d.movement_id AND l.account_id = d.party_id;
`;

export function indexPrototypeInvoices(db: DatabaseSync) {
  db.exec(`
    INSERT INTO invoice_records (voucher_id, firm_id, party_id, side, number, issuer_id, number_key)
    SELECT v.id, v.firm_id, l.account_id, v.kind, v.document ->> '$.number', v.firm_id,
      json_array(v.kind, v.firm_id, CASE v.kind WHEN 'Sale' THEN '' ELSE v.document ->> '$.party' END,
        CAST(substr(v.day, 1, 4) AS INTEGER) - (substr(v.day, 6, 2) < '04'), 'Invoice', v.document ->> '$.number')
    FROM vouchers v JOIN posting_lines l ON l.voucher_id = v.id AND l.firm_id = v.firm_id
    JOIN accounts a ON a.id = l.account_id AND a.firm_id = v.firm_id AND a.kind = 'party'
    WHERE v.kind IN ('Sale', 'Purchase') AND v.document IS NOT NULL AND v.request_id LIKE 'prototype:%';
    INSERT INTO invoice_allocations (invoice_id, firm_id, amount)
    SELECT i.voucher_id, i.firm_id, v.document ->> '$.totals.base'
    FROM invoice_records i JOIN vouchers v ON v.id = i.voucher_id;
    INSERT INTO bill_applications (voucher_id, firm_id, invoice_id, amount)
    SELECT receipt.id, i.firm_id, i.voucher_id, receipt.amount
    FROM invoice_records i JOIN vouchers sale ON sale.id = i.voucher_id AND sale.request_id = 'prototype:35'
    JOIN vouchers receipt ON receipt.firm_id = i.firm_id AND receipt.request_id = 'prototype:39'
    JOIN posting_lines l ON l.voucher_id = receipt.id AND l.account_id = i.party_id AND l.value = -receipt.amount;
  `);
}
