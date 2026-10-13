-- The package counts videos over the whole contract (e.g. 6 in all), not
-- per month; and each client gets documents (contracts, invoices) whose
-- files live in KV under file_key.

ALTER TABLE clients ADD COLUMN videos_total INTEGER NOT NULL DEFAULT 0;

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'contratto' CHECK (kind IN ('contratto', 'fattura', 'altro')),
  doc_date TEXT,
  amount INTEGER,            -- invoices: total in cents
  file_key TEXT NOT NULL,
  file_name TEXT,
  mime TEXT,
  size INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX documents_client ON documents(client_id);
