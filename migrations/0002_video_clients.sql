-- A video can feature several clients: the link moves from videos.client_id
-- to the video_clients table. Also: password-reset links for the client area.

CREATE TABLE videos_new (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok')),
  url TEXT NOT NULL,
  external_id TEXT,
  title TEXT,
  published_on TEXT NOT NULL,
  thumbnail TEXT,
  views INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  metrics_at TEXT,
  metrics_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO videos_new (id, platform, url, external_id, title, published_on, thumbnail, views, reach, likes, comments,
  shares, saves, metrics_at, metrics_error, created_at)
SELECT id, platform, url, external_id, title, published_on, thumbnail, views, reach, likes, comments,
  shares, saves, metrics_at, metrics_error, created_at FROM videos;
-- The old links, kept aside until the new table exists.
CREATE TABLE links_tmp AS SELECT id AS video_id, client_id FROM videos;
DROP TABLE videos;
ALTER TABLE videos_new RENAME TO videos;
CREATE INDEX videos_published ON videos(published_on);

CREATE TABLE video_clients (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, client_id)
);
CREATE INDEX video_clients_client ON video_clients(client_id);
INSERT INTO video_clients (video_id, client_id) SELECT video_id, client_id FROM links_tmp;
DROP TABLE links_tmp;

-- One-hour links sent by email; only the SHA-256 of the token is stored.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
