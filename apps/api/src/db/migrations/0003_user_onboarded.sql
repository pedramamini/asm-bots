-- First sign-in (EXEC 3.2): when the user picked their handle. Null until then, so the web app
-- asks for one (PRODUCT_SPEC §9).
ALTER TABLE users ADD COLUMN onboarded_at TEXT;
