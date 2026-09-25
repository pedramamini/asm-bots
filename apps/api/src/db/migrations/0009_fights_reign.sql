-- A bot's fights and a hill king's reign (EXEC 4.1): what a bot's page and a hill's king card say.
--
-- A bot's fights count the matches of its versions: a duel by its two version columns, indexed
-- here, and any other match (a melee) by its participants.
CREATE INDEX matches_a_version ON matches (a_version_id);
CREATE INDEX matches_b_version ON matches (b_version_id);

-- The king's reign: the challenges (finished submissions) the entry at rank 1 has held it
-- through, 0 for a king just crowned; null for every other entry. The Runner writes it with each
-- board: the king that stays king reigns one challenge longer.
ALTER TABLE hill_entries ADD COLUMN reign INTEGER CHECK (reign >= 0);

-- The kings on the boards now. Each launch seed king took its hill as it entered it, so its reign
-- is its age (the challenges it has been on the hill through). A king that took its hill after it
-- entered, in a database with submissions since the seed, starts from its age too: its reign reads
-- long until it loses the hill.
UPDATE hill_entries SET reign = age WHERE rank = 1;
