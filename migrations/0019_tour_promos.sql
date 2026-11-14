-- Promo codes for the experiences booked on the site (CRM → Tour → Codici
-- sconto). A code takes a percentage or a fixed amount off the booking's
-- total; the deposit is then the usual share of the discounted total.
CREATE TABLE tour_promos (
  code TEXT PRIMARY KEY,                 -- upper case, letters, digits and dashes
  percent INTEGER,                       -- 1–100, or NULL when amount_cents is set
  amount_cents INTEGER,                  -- fixed amount off the total
  slug TEXT,                             -- one experience, NULL for all of them
  max_uses INTEGER,                      -- NULL for unlimited
  expires_on TEXT,                       -- last day it works (YYYY-MM-DD), NULL for never
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE tour_bookings ADD COLUMN promo_code TEXT;
ALTER TABLE tour_bookings ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tour_bookings_promo ON tour_bookings (promo_code);
