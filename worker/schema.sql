-- Shifa Pharmacy POS sync server (Cloudflare D1). One deployment serves one pharmacy.
-- ops: every business change, append-only. seq is the server cursor devices pull from.
CREATE TABLE IF NOT EXISTS ops (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT NOT NULL UNIQUE,
  stamp TEXT NOT NULL,
  store TEXT NOT NULL,
  op TEXT NOT NULL,
  key TEXT NOT NULL,
  record TEXT
);

-- members: the staff and owner accounts that may sign in to sync. Kept up to date from the users ops.
-- hash and salt are PBKDF2-SHA256 values the app already stores; the password itself never reaches the server.
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  stamp TEXT NOT NULL DEFAULT ''
);

-- sessions: refresh tokens, stored as SHA-256 hashes. A refresh token is used once and replaced.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
