-- ARCHITECTURE §7, data model. Ids are text (ULIDs or slugs); times are ISO 8601 UTC text; a
-- `_json` column holds the protocol record's value as JSON. D1 enforces foreign keys.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  github_id   INTEGER UNIQUE,                  -- null for the `system` user
  handle      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  avatar_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE bots (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner_id, slug)
);
CREATE INDEX bots_owner ON bots (owner_id);

CREATE TABLE bot_versions (
  id            TEXT PRIMARY KEY,
  bot_id        TEXT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
  version       INTEGER NOT NULL CHECK (version >= 1),
  source        TEXT NOT NULL,
  bytes_sha256  TEXT NOT NULL,                 -- the bytes are in R2 under this
  size          INTEGER NOT NULL CHECK (size BETWEEN 1 AND 65536),
  author        TEXT,
  strategy      TEXT,
  isa           TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX bot_versions_bot_version ON bot_versions (bot_id, version);

CREATE TABLE hills (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL CHECK (size BETWEEN 2 AND 1000),
  rounds       INTEGER NOT NULL CHECK (rounds BETWEEN 1 AND 100),
  config_json  TEXT NOT NULL,                  -- protocol ReplayConfig
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE hill_entries (
  hill_id         TEXT NOT NULL REFERENCES hills (id) ON DELETE CASCADE,
  bot_version_id  TEXT NOT NULL REFERENCES bot_versions (id) ON DELETE CASCADE,
  score           REAL NOT NULL DEFAULT 0,
  rating          REAL NOT NULL DEFAULT 1500,
  wins            INTEGER NOT NULL DEFAULT 0,
  ties            INTEGER NOT NULL DEFAULT 0,
  losses          INTEGER NOT NULL DEFAULT 0,
  age             INTEGER NOT NULL DEFAULT 0,  -- challengers outlasted since it entered
  entered_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  rank            INTEGER NOT NULL CHECK (rank >= 1),  -- 1 is the king
  PRIMARY KEY (hill_id, bot_version_id)
);
CREATE INDEX hill_entries_rank ON hill_entries (hill_id, rank);

CREATE TABLE tournaments (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('roundrobin', 'bracket', 'melee')),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'scheduled', 'running', 'finished', 'cancelled')),
  config_json   TEXT NOT NULL,                 -- protocol TournamentConfig
  bracket_json  TEXT,                          -- null unless kind = 'bracket'
  owner_id      TEXT REFERENCES users (id) ON DELETE SET NULL,  -- null for a championship
  starts_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tournaments_starts ON tournaments (status, starts_at);

CREATE TABLE tournament_entries (
  tournament_id   TEXT NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  bot_version_id  TEXT NOT NULL REFERENCES bot_versions (id) ON DELETE CASCADE,
  seed            INTEGER,                     -- bracket seeding; null until drawn
  PRIMARY KEY (tournament_id, bot_version_id)
);

CREATE TABLE matches (
  id                 TEXT PRIMARY KEY,
  tournament_id      TEXT REFERENCES tournaments (id) ON DELETE CASCADE,
  hill_id            TEXT REFERENCES hills (id) ON DELETE CASCADE,
  a_version_id       TEXT REFERENCES bot_versions (id) ON DELETE SET NULL,  -- duels only
  b_version_id       TEXT REFERENCES bot_versions (id) ON DELETE SET NULL,
  participants_json  TEXT NOT NULL,            -- bot version ids, entrant order
  rounds             INTEGER NOT NULL CHECK (rounds BETWEEN 1 AND 100),
  seed               INTEGER NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  result_json        TEXT,                     -- protocol MatchOutcome; null until finished
  replay_key         TEXT,                     -- R2 replays/<key>.json
  finished_at        TEXT
);
CREATE INDEX matches_tournament ON matches (tournament_id);
CREATE INDEX matches_hill_finished ON matches (hill_id, finished_at);

CREATE TABLE ratings (
  bot_version_id  TEXT NOT NULL REFERENCES bot_versions (id) ON DELETE CASCADE,
  hill_id         TEXT NOT NULL REFERENCES hills (id) ON DELETE CASCADE,
  rating          REAL NOT NULL,
  rd              REAL NOT NULL,
  volatility      REAL NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (bot_version_id, hill_id)
);
