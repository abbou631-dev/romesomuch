-- Gift cards sold on the site (owner, 24 Nov 2026): €100, 200, 300, 500,
-- valid 12 months from purchase, paid in full with Stripe. A card pays for
-- bookings of the site's own experiences, the whole price (online part
-- first, then the balance due on the day); what is left stays on the card.
-- The balance is never stored: it is amount_cents minus the gift_cents of
-- the bookings that hold it (confirmed, requested or being paid), so a
-- cancelled booking gives its share back by itself. See server/gift-cards.js.
CREATE TABLE gift_cards (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,           -- GIFT-XXXX-XXXX, typed in the booking box
  token TEXT NOT NULL,                 -- key of the card's page /gift/<code>?k=
  amount_cents INTEGER NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  recipient_name TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending (being paid), paid, void
  payment_intent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  expires_on TEXT                       -- last day it can be used to book
);
CREATE INDEX gift_cards_pi ON gift_cards (payment_intent);
ALTER TABLE tour_bookings ADD COLUMN gift_code TEXT;
ALTER TABLE tour_bookings ADD COLUMN gift_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tour_bookings_gift ON tour_bookings (gift_code);
