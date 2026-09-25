-- API tokens: a user's personal tokens, so a script or an AI agent can push bots and submit them
-- to hills as them (`Authorization: Bearer asmb_...`). Only the SHA-256 of a token is kept; the
-- token itself is shown once, when it is made. `prefix` is its first 12 characters, so the settings
-- page can tell tokens apart. The tokens go with the user when they delete their account.
CREATE TABLE api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  hash          TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at  TEXT
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);
