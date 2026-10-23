-- Title requests for one video, typed in the CRM (#/titoli). The connector on
-- the agents' server (romesomuch-agents/crm-bridge) picks up the waiting ones,
-- opens a Paperclip task for the Video Ideas agent and writes its answer back.
CREATE TABLE title_requests (
  id INTEGER PRIMARY KEY,
  brief TEXT NOT NULL,          -- what the video shows, in the agency's words
  status TEXT NOT NULL DEFAULT 'in_attesa',  -- in_attesa, in_corso, pronto, errore
  issue TEXT,                   -- the Paperclip task, e.g. ROM-25
  answer TEXT,                  -- the agent's titles, as it wrote them
  error TEXT,
  created_by TEXT,              -- "owner" or the team member's name
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  answered_at TEXT
);
CREATE INDEX title_requests_status ON title_requests(status);
