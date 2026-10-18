-- Separate authority storage. Never imports accounts.save (the legacy browser bundle).
CREATE TABLE world_characters (
  character_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(username),
  codec_version integer NOT NULL CHECK (codec_version > 0),
  identity_json text NOT NULL CHECK (octet_length(identity_json) <= 4096),
  checkpoint_json text NOT NULL CHECK (octet_length(checkpoint_json) <= 262144),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, account_id)
);
CREATE INDEX world_characters_account ON world_characters(account_id, character_id);

-- Earned grants are retained even after a checkpoint acknowledges them.
CREATE TABLE world_character_grants (
  -- Preserve the core's exact JSON.stringify([area,id,life,character]) ID, including quotes/brackets.
  -- Postgres UTF-8 text rejects NUL and invalid Unicode; explicitly reject remaining C0/C1 controls.
  grant_id text PRIMARY KEY CHECK (octet_length(grant_id) BETWEEN 1 AND 512 AND grant_id !~ U&'[\0001-\001F\007F-\009F]'),
  journal_sequence bigserial UNIQUE NOT NULL,
  character_id uuid NOT NULL,
  account_id text NOT NULL,
  codec_version integer NOT NULL CHECK (codec_version > 0),
  payload_json text NOT NULL CHECK (octet_length(payload_json) <= 16384),
  earned_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (character_id, account_id) REFERENCES world_characters(character_id, account_id),
  UNIQUE (grant_id, character_id)
);
CREATE INDEX world_character_grants_recipient ON world_character_grants(character_id, journal_sequence);
CREATE TABLE world_character_grant_receipts (
  grant_id text PRIMARY KEY,
  character_id uuid NOT NULL,
  applied_revision bigint NOT NULL CHECK (applied_revision BETWEEN 1 AND 9007199254740991),
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (grant_id, character_id) REFERENCES world_character_grants(grant_id, character_id)
);

-- An accidental UPDATE/DELETE must not change the meaning of an earned grant or receipt.
CREATE FUNCTION reject_world_grant_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'world grant journal and receipts are immutable';
END;
$$;
CREATE TRIGGER world_grants_immutable BEFORE UPDATE OR DELETE ON world_character_grants
  FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();
CREATE TRIGGER world_receipts_immutable BEFORE UPDATE OR DELETE ON world_character_grant_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();
