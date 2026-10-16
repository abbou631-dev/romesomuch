-- One-off promos sold on the RomeSoMuch pages, outside the Visibilità
-- costante package: what the venue pays and what the agency pays the people
-- who make it. Money in euro cents.
CREATE TABLE promos (
  id INTEGER PRIMARY KEY,
  venue TEXT NOT NULL,          -- who bought it (a client or anyone else)
  title TEXT,
  date TEXT NOT NULL,           -- the day it goes out; it counts in that month
  price INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  cost_to TEXT,                 -- who was paid
  url TEXT,
  paid_at TEXT,                 -- when the venue paid; empty = not yet
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX promos_date ON promos(date);
