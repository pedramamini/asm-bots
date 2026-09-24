-- Hill submissions end to end (EXEC 3.3): the submit route, the hill's history, and its ratings.
--
-- A user has at most one submission queued or running per hill. The `deleted` user holds the rows
-- of every deleted account, so its rows are not held to that.
CREATE UNIQUE INDEX hill_submissions_active ON hill_submissions (user_id, hill_id)
  WHERE status IN ('queued', 'running') AND user_id <> 'deleted';

-- A submission that did not stay: the field score of the lowest entry that did, the score it had
-- to beat. Written with its score and rank.
ALTER TABLE hill_submissions ADD COLUMN needed REAL;

-- A hill's history, the feed of its board's changes: what each submission's board write did. The
-- Runner writes it in the same batch as the board. `rank`: the challenger's new rank (`entered`),
-- the entry's rank on the board before (`evicted`, `replaced`), null (`rejected`). `score`: the
-- bot's score in the field of the challenge (its old score for `replaced`). `delta`, `entered`
-- only: its bot's best rank on the board before less its new rank (up is positive), null when the
-- bot had no place there.
CREATE TABLE hill_history (
  id              TEXT PRIMARY KEY,
  hill_id         TEXT NOT NULL REFERENCES hills (id) ON DELETE CASCADE,
  submission_id   TEXT REFERENCES hill_submissions (id) ON DELETE SET NULL,
  event           TEXT NOT NULL CHECK (event IN ('entered', 'rejected', 'evicted', 'replaced')),
  bot_version_id  TEXT NOT NULL REFERENCES bot_versions (id) ON DELETE CASCADE,
  rank            INTEGER CHECK (rank >= 1),
  score           REAL NOT NULL,
  delta           INTEGER,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX hill_history_hill_at ON hill_history (hill_id, at);
CREATE INDEX hill_history_submission ON hill_history (submission_id);
