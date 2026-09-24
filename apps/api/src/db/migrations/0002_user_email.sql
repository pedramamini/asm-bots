-- GitHub sign-in (EXEC 3.2): the account's primary verified email, for account mail only. Never
-- in an API record.
ALTER TABLE users ADD COLUMN email TEXT;
