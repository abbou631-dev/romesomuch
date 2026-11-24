-- Optional extras a guest can add when booking, at a flat price per booking
-- (owner, 24 Nov 2026: Classic Italian Gourmet Basket, €50, on the Tiber
-- cruise). tours.extras: [{"name": "...", "price_cents": 5000}].
-- tour_bookings.extras: the ones chosen, as sold (same shape); the booking's
-- total_cents already includes them.
ALTER TABLE tours ADD COLUMN extras TEXT;
ALTER TABLE tour_bookings ADD COLUMN extras TEXT;
UPDATE tours SET extras = '[{"name":"Classic Italian Gourmet Basket","price_cents":5000}]' WHERE slug = 'tiber-cruise';
-- Boat prices by group size (owner, 24 Nov 2026): the provider's price + 30%,
-- the 30% being the online deposit. 23% of the price ≈ 30% of the cost.
-- 1–2 guests 445 → 578.50, 3: 510 → 663, 4: 575 → 747.50, 5–6: 625 → 812.50.
UPDATE tours SET price_cents = 57850, deposit_pct = 23, max_guests = 6,
  price_tiers = '{"1":57850,"2":57850,"3":66300,"4":74750,"5":81250,"6":81250}'
  WHERE slug = 'tiber-cruise';
