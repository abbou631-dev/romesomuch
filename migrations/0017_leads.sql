-- Venues the agency has contacted and might sign: who, how, when, where it
-- stands and when to get back to them. The owner can open the page to single
-- team members from the Team page (can_leads).
CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,           -- the venue
  category TEXT,                -- ristorante, tour_operator, street_food, cafe, altro (LEAD_CATEGORY in app.ts)
  zone TEXT,                    -- the area of Rome
  contact TEXT,                 -- the person spoken to
  phone TEXT,
  email TEXT,
  instagram TEXT,
  channel TEXT,                 -- instagram, whatsapp, telefono, email, di_persona
  contacted_on TEXT,            -- first contact
  contacted_by TEXT,            -- who in the agency contacted them
  status TEXT NOT NULL DEFAULT 'contattato', -- contattato, interessato, trattativa, cliente, perso
  next_on TEXT,                 -- when to get back to them
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX leads_status ON leads(status);
ALTER TABLE team_members ADD COLUMN can_leads INTEGER NOT NULL DEFAULT 0;
