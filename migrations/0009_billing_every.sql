-- How often a client pays: every 1, 3 or 6 months (most pay every six).
-- The fee stays monthly; each instalment is fee x months.
ALTER TABLE clients ADD COLUMN billing_every INTEGER NOT NULL DEFAULT 6;
