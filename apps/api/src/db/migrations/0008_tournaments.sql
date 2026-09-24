-- Server tournaments and championships (EXEC 3.3): tournaments a user makes and starts, and the
-- weekly championship the cron makes and starts.
--
-- How a tournament takes its entrants: `invite`, the bot versions its owner named; `open`, one
-- version from each signed-in user until `entry_closes_at`.
ALTER TABLE tournaments ADD COLUMN entry TEXT NOT NULL DEFAULT 'invite'
  CHECK (entry IN ('invite', 'open'));
ALTER TABLE tournaments ADD COLUMN entry_closes_at TEXT;

-- What a finished tournament came to, written with its `finished` status: the winner's bot
-- version and when. The finished championships, latest first, are the championships feed.
ALTER TABLE tournaments ADD COLUMN champion_id TEXT REFERENCES bot_versions (id) ON DELETE SET NULL;
ALTER TABLE tournaments ADD COLUMN finished_at TEXT;
CREATE INDEX tournaments_finished ON tournaments (owner_id, status, finished_at);

-- Who entered an open tournament (null for an invited version), and when: `given` seeds follow
-- the entries' order. A user has one entry a tournament. The `deleted` user holds the entries of
-- every deleted account, so its rows are not held to that.
ALTER TABLE tournament_entries ADD COLUMN user_id TEXT REFERENCES users (id);
ALTER TABLE tournament_entries ADD COLUMN entered_at TEXT;
CREATE UNIQUE INDEX tournament_entries_user ON tournament_entries (tournament_id, user_id)
  WHERE user_id IS NOT NULL AND user_id <> 'deleted';
