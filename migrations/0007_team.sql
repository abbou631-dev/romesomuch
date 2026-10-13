-- Team members: people of the agency who add videos and look up clients,
-- without the money. They sign in with a link emailed to them, like clients.
CREATE TABLE team_members (
  id INTEGER PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  session_version INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE team_links (
  token_hash TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
