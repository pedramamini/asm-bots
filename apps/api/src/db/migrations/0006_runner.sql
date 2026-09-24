-- The Runner (EXEC 3.3).
--
-- A hill's `revision` counts the changes to its board. A Runner writes a new board only over the
-- revision it read: its batch first sets the revision to the next one, or to -1 when another
-- Runner wrote in between, and the CHECK refuses -1, so the whole batch fails. The Runner then
-- reads the board again (and fights any entry that is new to it).
ALTER TABLE hills ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

-- How a hill scores a challenge: `duel`, one match per entry (`@asmbots/tourney` `submitToHill`),
-- or `melee`, all in one core. The launch seed's `melee` hill is the one melee hill.
ALTER TABLE hills ADD COLUMN scoring TEXT NOT NULL DEFAULT 'duel'
  CHECK (scoring IN ('duel', 'melee'));
UPDATE hills SET scoring = 'melee' WHERE slug = 'melee';

-- A match's `matchHash` (`@asmbots/tourney`): the hash of every input that decides its result.
-- One key, one result: a Runner that finds a result under the key it is about to play uses it.
ALTER TABLE matches ADD COLUMN match_key TEXT;
CREATE INDEX matches_key ON matches (match_key);

-- A bot version submitted to a hill: one Runner job (`hill:<slug>:<id>`). The Runner marks its
-- status and writes its score and rank in the same batch as the new board, so a Runner cut off
-- after that write knows the board has the challenge in it already. A deleted account's rows
-- pass to the `deleted` user; the rows of a version deleted with it go with the version.
CREATE TABLE hill_submissions (
  id              TEXT PRIMARY KEY,
  hill_id         TEXT NOT NULL REFERENCES hills (id) ON DELETE CASCADE,
  bot_version_id  TEXT NOT NULL REFERENCES bot_versions (id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id),
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'finished', 'cancelled', 'failed')),
  score           REAL,                          -- its score in the field; null until finished
  rank            INTEGER CHECK (rank >= 1),     -- its rank on the new board; null off the hill
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX hill_submissions_hill ON hill_submissions (hill_id, created_at);
CREATE INDEX hill_submissions_user ON hill_submissions (user_id, hill_id, status);
