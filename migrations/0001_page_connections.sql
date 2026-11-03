CREATE TABLE page_connections (
  workspace_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  tasks TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  checked_at TEXT,
  status TEXT NOT NULL DEFAULT 'saved'
);

CREATE TABLE meta_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX meta_sessions_expiry ON meta_sessions(expires_at);
