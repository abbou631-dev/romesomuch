-- The RomeSoMuch CRM: clients of the "visibilità costante" package, what they
-- pay, and the videos published for them with their metrics.
-- Money in euro cents; dates ISO text (YYYY-MM-DD), months YYYY-MM.

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT UNIQUE COLLATE NOCASE,   -- client-area login
  password TEXT,                      -- pbkdf2$iterations$salt$hash, empty = no access
  phone TEXT,
  instagram TEXT,
  tiktok TEXT,
  vat TEXT,
  fee INTEGER NOT NULL DEFAULT 0,                -- monthly fee
  videos_per_month INTEGER NOT NULL DEFAULT 0,   -- videos the package promises
  billing_day INTEGER NOT NULL DEFAULT 1,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'attivo' CHECK (status IN ('attivo', 'pausa', 'concluso')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE charges (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'canone' CHECK (kind IN ('canone', 'extra')),
  description TEXT,
  amount INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  paid_at TEXT,
  invoice_no TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX charges_one_fee_a_month ON charges(client_id, period) WHERE kind = 'canone';
CREATE INDEX charges_client ON charges(client_id);

-- One row per published video. Metrics are the last reading: from the
-- platform's API when it is connected, typed in by hand otherwise.
CREATE TABLE videos (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok')),
  url TEXT NOT NULL,
  external_id TEXT,
  title TEXT,
  published_on TEXT NOT NULL,
  thumbnail TEXT,
  views INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  metrics_at TEXT,
  metrics_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX videos_client ON videos(client_id, published_on);

-- Tokens the server keeps for itself (TikTok's refresh token).
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE login_failures (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX login_failures_ip ON login_failures(ip, at);
