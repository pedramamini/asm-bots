-- Cloud bots (EXEC 3.2): a deleted bot is soft-deleted, so the hill entries and matches of its
-- versions keep their history. A column, not a `visibility` of 'deleted': the CHECK on
-- `visibility` changes only by rebuilding `bots`, and dropping the old table under D1's enforced
-- foreign keys would cascade into `bot_versions`, `hill_entries`, and `ratings`.
ALTER TABLE bots ADD COLUMN deleted_at TEXT;
