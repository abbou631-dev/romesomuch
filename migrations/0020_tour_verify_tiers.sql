-- Private guided tours (Vatican Museums, Colosseum) booked on the site, and
-- the ceramics workshop.
--
-- price_tiers: JSON object {"<guests>": cents}. When set, the total of a
--   booking is the price for its number of guests (a private group priced by
--   size) instead of price_cents x guests; price_cents is then the "from" price.
-- verify: the owner checks availability (museum tickets, a guide) before the
--   booking stands. The guest's card is only authorised; accepting the request
--   in the CRM charges it, declining releases it. Stripe drops an uncaptured
--   authorisation after 7 days, so requests must be answered within that.
--   These tours also ask for every participant's name and date of birth.
ALTER TABLE tours ADD COLUMN price_tiers TEXT;
ALTER TABLE tours ADD COLUMN verify INTEGER NOT NULL DEFAULT 0;

-- Names and dates of birth of all participants, as on their passports.
ALTER TABLE tour_bookings ADD COLUMN participants TEXT;
-- tour_bookings.status gains 'requested': card authorised, waiting for the owner.

-- 2 guests €485, 3 €540, 4 €600, then €150 more per guest up to 10 (owner's
-- prices, 18 Nov 2026). One guest pays the price of two. Larger groups write.
INSERT INTO tours (slug, title, price_cents, unit, deposit_pct, capacity, max_guests, times, weekdays, cutoff_hours, cancel_hours, meeting_point, price_tiers, verify) VALUES
  ('private-vatican-museums-tour', 'Private Vatican Museums Tour', 48500, 'group', 100, 3, 10, '["09:00","10:30","12:00","14:00"]', '123456', 48, 48, NULL,
   '{"1":48500,"2":48500,"3":54000,"4":60000,"5":75000,"6":90000,"7":105000,"8":120000,"9":135000,"10":150000}', 1),
  ('private-colosseum-tour', 'Private Colosseum Tour', 48500, 'group', 100, 3, 10, '["09:00","10:30","12:00","14:00"]', '0123456', 48, 48, NULL,
   '{"1":48500,"2":48500,"3":54000,"4":60000,"5":75000,"6":90000,"7":105000,"8":120000,"9":135000,"10":150000}', 1),
  ('coccio-ceramics-class', 'Ceramics Workshop in San Lorenzo', 8000, 'person', 30, 10, 10, '["11:00","16:00"]', '06', 24, 24, 'Coccio Lab, Via dei Volsci 40-42, 00185 Rome', NULL, 0);
