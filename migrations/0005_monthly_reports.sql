-- Monthly recap emails: one row per client and month once sent, so the CRM
-- shows what is done and never sends the same month twice by mistake.
CREATE TABLE monthly_reports (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  recipients TEXT NOT NULL,
  PRIMARY KEY (client_id, period)
);
