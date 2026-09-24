-- The audit log (EXEC 3.2): one row per change a user makes (protocol `AUDIT_ACTIONS`). It goes
-- with the user when they delete their account.
CREATE TABLE audit (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action   TEXT NOT NULL,
  target   TEXT NOT NULL,
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX audit_user_at ON audit (user_id, at);
