-- Client categories (Trattoria/Osteria, Ristoranti medio-alti, Negozi, Street
-- food, Cafe), several per client, stored as comma-separated keys.
ALTER TABLE clients ADD COLUMN categories TEXT;
