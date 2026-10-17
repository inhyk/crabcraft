-- Sign-in is Google only. An account's username is 'g' plus the first 23 hex characters of
-- SHA-256('google:' + sub); the Google sub, email, name and picture are never stored, and there
-- are no passwords any more.
-- Password accounts go with their sessions (ON DELETE CASCADE): on 2026-10-17 dev held only QA
-- accounts and prod had none.
DELETE FROM accounts;
DELETE FROM rate_limits WHERE id LIKE 'login:%';
ALTER TABLE accounts DROP COLUMN salt, DROP COLUMN hash;
ALTER TABLE accounts ADD CONSTRAINT accounts_google CHECK (username ~ '^g[a-f0-9]{23}$');
