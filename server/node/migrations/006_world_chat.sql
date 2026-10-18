-- Account chat state belongs to the authenticated Google-derived account key, never a browser tab.
-- Only already-filtered Talk lines are retained. Each account has at most 20 lines and 256 local targets.
CREATE TABLE world_chat_accounts (
  account_id text PRIMARY KEY REFERENCES accounts(username) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  party_only boolean NOT NULL DEFAULT false,
  mute_until bigint NOT NULL DEFAULT 0 CHECK (mute_until >= 0),
  report_watermark bigint NOT NULL DEFAULT 0 CHECK (report_watermark >= 0),
  talk jsonb NOT NULL DEFAULT '{"sent":[],"lines":[]}'::jsonb
    CHECK (jsonb_typeof(talk) = 'object' AND jsonb_typeof(talk->'sent') = 'array'
      AND jsonb_typeof(talk->'lines') = 'array' AND jsonb_array_length(talk->'sent') <= 5
      AND jsonb_array_length(talk->'lines') <= 20)
);

CREATE TABLE world_chat_targets (
  owner_account text NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  target_account text NOT NULL REFERENCES accounts(username) ON DELETE CASCADE,
  blocked boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(owner_account, target_account),
  CHECK (owner_account <> target_account),
  CHECK (blocked OR muted)
);

-- Legacy reports retain nullable account keys. The world host fills both using its admission binding.
ALTER TABLE chat_reports ADD COLUMN target_account text;
CREATE INDEX chat_reports_account_target ON chat_reports(target_account, created DESC, id DESC)
  WHERE target_account IS NOT NULL;
CREATE INDEX chat_reports_account_reporter ON chat_reports(reporter_account, created DESC)
  WHERE reporter_account IS NOT NULL;
