-- Applications sent from /ugc/ on the site, one row each, so the agency can
-- keep them, sort them and pick the creators worth inviting. The site's form
-- fills everything up to `page`; the CRM sets status, rating and notes.
CREATE TABLE ugc (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  country TEXT,
  instagram TEXT,
  tiktok TEXT,
  portfolio TEXT,
  followers TEXT,               -- the band picked on the form, e.g. "20k–100k"
  views TEXT,                   -- free text: "about 15k"
  niche TEXT,
  languages TEXT,
  arrival TEXT,                 -- YYYY-MM-DD
  departure TEXT,
  party TEXT,                   -- "Who is coming"
  interest TEXT,                -- Experiences / Restaurants / Both
  deliverables TEXT,
  rights TEXT,
  message TEXT,
  agreement TEXT,               -- "Accepted": the commitment to post
  page TEXT,
  status TEXT NOT NULL DEFAULT 'nuovo',
  rating INTEGER,               -- 1 to 5, the agency's own judgement
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ugc_created ON ugc(created_at);
