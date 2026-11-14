-- RomeSoMuch's own experiences, booked on the site instead of Bokun: the
-- customer pays a deposit online (Stripe) and the balance on the day.
-- Golf cart tours are not here: the partner sells them with its own Stripe.

-- One row per bookable experience; `slug` is the file name in
-- src/content/experiences. Everything here is edited from /crm/tour/.
CREATE TABLE tours (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price_cents INTEGER NOT NULL,          -- per person, or per group when unit = 'group'
  unit TEXT NOT NULL DEFAULT 'person',   -- person | group
  deposit_pct INTEGER NOT NULL,          -- share of the total paid online, 1-100
  capacity INTEGER NOT NULL,             -- guests per start time (unit person) or groups per start time (unit group)
  max_guests INTEGER NOT NULL,           -- most guests in one booking
  times TEXT NOT NULL,                   -- JSON array of start times, "HH:MM", Rome time
  weekdays TEXT NOT NULL DEFAULT '0123456', -- days it runs, 0 = Sunday
  cutoff_hours INTEGER NOT NULL DEFAULT 24, -- online sales close this long before the start
  cancel_hours INTEGER NOT NULL DEFAULT 48, -- free cancellation up to this long before the start
  meeting_point TEXT,                    -- printed in the confirmation and reminder emails
  active INTEGER NOT NULL DEFAULT 1
);

-- Days an experience does not run (holidays, weather, a booking taken elsewhere).
CREATE TABLE tour_closures (
  slug TEXT NOT NULL REFERENCES tours(slug) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (slug, date)
);

CREATE TABLE tour_bookings (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,             -- RSM-XXXXXX, shown to the customer
  slug TEXT NOT NULL REFERENCES tours(slug),
  date TEXT NOT NULL,                    -- YYYY-MM-DD, Rome
  time TEXT NOT NULL,                    -- HH:MM, Rome
  guests INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,                            -- always asked, with the country code
  whatsapp INTEGER,                      -- 1 the phone has WhatsApp, 0 it does not
  notes TEXT,
  source TEXT,                           -- how they heard of us: instagram, tiktok, facebook, online, other
  total_cents INTEGER NOT NULL,          -- price of the whole booking
  deposit_cents INTEGER NOT NULL,        -- what is paid online; the rest is paid on the day
  status TEXT NOT NULL DEFAULT 'pending', -- pending (waiting for payment, holds the seats 20 min), confirmed, cancelled
  payment_intent TEXT UNIQUE,            -- Stripe PaymentIntent of the deposit
  paid_cents INTEGER NOT NULL DEFAULT 0,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT,
  cancelled_at TEXT,
  reminded_at TEXT                       -- the day-before email went out
);
CREATE INDEX tour_bookings_slot ON tour_bookings(slug, date, time, status);
CREATE INDEX tour_bookings_date ON tour_bookings(date, status);

-- The catalogue as Bokun sold it on 14 Nov 2026 (base prices, without the
-- 1.5% Bokun added). Capacity 10 where Bokun had no limit, as the owner asked.
INSERT INTO tours (slug, title, price_cents, unit, deposit_pct, capacity, max_guests, times, weekdays, cutoff_hours, meeting_point) VALUES
  ('vespa-tour', 'Vespa Tour', 9000, 'person', 40, 8, 8, '["09:00","11:00","13:00","15:00","17:00","19:00","21:00"]', '0123456', 24, 'Via Cavour 207, 00184 Rome'),
  ('vespa-sidecar-tour', 'Vespa Sidecar Tour', 14000, 'person', 36, 10, 10, '["10:00","14:00","18:00"]', '0123456', 12, 'Piazza di San Pantaleo, 00186 Rome'),
  ('tiber-cruise', 'Exclusive Private Cruise on the Tiber', 59500, 'group', 25, 1, 6, '["10:00","12:00","15:00","16:30","18:00","19:30","20:45"]', '0123456', 24, 'Ponte Regina Margherita, The Boat by Gregory''s'),
  ('pasta-cooking-class', 'Pasta Cooking Class', 9000, 'person', 45, 10, 10, '["09:30","12:30","15:00","18:30"]', '0123456', 24, 'Cantiere Gastronomico, Via della Cordonata 4, 00187 Rome'),
  ('roman-mosaic-class', 'Roman Mosaic Workshop', 9500, 'person', 35, 10, 10, '["14:00"]', '2345', 4, 'Via Urbana 98, 00184 Rome'),
  ('micromosaic-jewelry-class', 'Micromosaic Jewelry Workshop', 13000, 'person', 31, 10, 10, '["10:00","16:00"]', '134', 10, NULL);
