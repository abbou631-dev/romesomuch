-- A deposit by group size (tours.deposit_tiers, {"2": 13500} in cents),
-- instead of a percentage: the owner's margin is paid online and the
-- provider's price on the spot, to the provider (owner, 24 Nov 2026).
-- A promo discount comes off the deposit. Extras are paid on the spot.
ALTER TABLE tours ADD COLUMN deposit_tiers TEXT;
-- Tiber cruise (owner, 24 Nov 2026): €580 for 1–2 guests, +€75 per guest.
-- Provider: 445 for 1–2, 510 for 3, 575 for 4, 625 for 5–6.
UPDATE tours SET price_cents = 58000,
  price_tiers = '{"1":58000,"2":58000,"3":65500,"4":73000,"5":80500,"6":88000}',
  deposit_tiers = '{"1":13500,"2":13500,"3":14500,"4":15500,"5":18000,"6":25500}'
  WHERE slug = 'tiber-cruise';
