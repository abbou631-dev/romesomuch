-- Passwordless client area. Each client has a private invite link; whoever
-- opens it asks for access with name and email; the agency approves once;
-- from then on that person signs in with a link emailed to them.
-- Passwords and their reset links are gone.

ALTER TABLE clients ADD COLUMN invite_token TEXT;
CREATE UNIQUE INDEX clients_invite ON clients(invite_token);
UPDATE clients SET password = NULL;
DROP TABLE password_resets;

CREATE TABLE client_users (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'in_attesa' CHECK (status IN ('in_attesa', 'approvato', 'rifiutato')),
  -- Part of every session cookie: raising it signs this person out everywhere.
  session_version INTEGER NOT NULL DEFAULT 1,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  last_seen TEXT,
  UNIQUE (client_id, email)
);
CREATE INDEX client_users_email ON client_users(email);

-- Sign-in links sent by email: valid 30 minutes, only the SHA-256 is stored.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
