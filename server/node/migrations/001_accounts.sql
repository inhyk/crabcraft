-- Accounts, sessions and rate-limit counters for /api/account/*.
-- Times are milliseconds since the Unix epoch, as in the Cloudflare Worker.

CREATE TABLE accounts (
  username text PRIMARY KEY CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  -- 64 hex characters; PBKDF2-SHA256 takes this string's UTF-8 bytes as the salt.
  salt text NOT NULL,
  -- Hex PBKDF2-SHA256, 100000 iterations, 32 bytes.
  hash text NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  -- The validated save bundle as JSON text; text keeps key order, which the client compares.
  save text NOT NULL DEFAULT '{}',
  updated bigint NOT NULL,
  created bigint NOT NULL
);

CREATE TABLE sessions (
  -- SHA-256 hex of the session token; the token itself is never stored.
  token_hash text PRIMARY KEY,
  username text NOT NULL REFERENCES accounts (username) ON DELETE CASCADE,
  expires bigint NOT NULL
);
CREATE INDEX sessions_username ON sessions (username, expires DESC);
CREATE INDEX sessions_expires ON sessions (expires);

CREATE TABLE rate_limits (
  -- login:<username>, save:<username> or ip:<SHA-256 hex of the client IP>.
  id text PRIMARY KEY,
  count integer NOT NULL,
  until bigint NOT NULL
);
CREATE INDEX rate_limits_until ON rate_limits (until);
