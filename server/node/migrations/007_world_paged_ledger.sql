-- Bounded contribution spill and staged outcome publication. Does not reinterpret005 manifests.
CREATE TABLE world_contribution_sources (
  victim_key text PRIMARY KEY CHECK (octet_length(victim_key) BETWEEN 1 AND 512),
  victim_json text NOT NULL CHECK (octet_length(victim_json) <= 512),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','frozen')),
  contributor_count bigint NOT NULL DEFAULT 0 CHECK (contributor_count BETWEEN 0 AND 9007199254740991),
  source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision BETWEEN 0 AND 9007199254740991),
  stored_eligible_count bigint NOT NULL DEFAULT 0 CHECK (stored_eligible_count BETWEEN 0 AND contributor_count),
  max_version bigint NOT NULL DEFAULT 0 CHECK (max_version BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE world_contributions (
  victim_key text NOT NULL REFERENCES world_contribution_sources(victim_key),
  character_id uuid NOT NULL REFERENCES world_characters(character_id),
  credit_version bigint NOT NULL CHECK (credit_version BETWEEN 1 AND 9007199254740991),
  credit_json text NOT NULL CHECK (octet_length(credit_json) <= 4096),
  PRIMARY KEY(victim_key,character_id)
);
CREATE INDEX world_contributions_eligible_prefix ON world_contributions(victim_key, ((character_id::text) COLLATE "C")) WHERE (credit_json::jsonb->'cogEligible')='true'::jsonb;
CREATE TABLE world_victim_drafts (
  draft_id uuid PRIMARY KEY,
  recovery_sequence bigserial UNIQUE NOT NULL,
  victim_key text UNIQUE NOT NULL REFERENCES world_contribution_sources(victim_key),
  codec_version integer NOT NULL CHECK (codec_version > 0),
  recipe_json text NOT NULL CHECK (octet_length(recipe_json) <= 524288),
  recipe_digest text NOT NULL CHECK (recipe_digest ~ '^[a-f0-9]{64}$'),
  initial_cursor_json text NOT NULL CHECK (octet_length(initial_cursor_json) <= 4096),
  cursor_json text NOT NULL CHECK (octet_length(cursor_json) <= 4096),
  total_count bigint NOT NULL CHECK (total_count BETWEEN 0 AND 9007199254740991),
  source_version bigint NOT NULL CHECK (source_version BETWEEN 0 AND 9007199254740991),
  planned_count bigint NOT NULL DEFAULT 0 CHECK (planned_count BETWEEN 0 AND total_count),
  page_sequence bigint NOT NULL DEFAULT 0 CHECK (page_sequence BETWEEN 0 AND 9007199254740991),
  after_character uuid,
  content_chain text NOT NULL CHECK (content_chain ~ '^[a-f0-9]{64}$'),
  CHECK ((planned_count=0) = (after_character IS NULL))
);
CREATE TABLE world_victim_pages (
  draft_id uuid NOT NULL REFERENCES world_victim_drafts(draft_id),
  page_sequence bigint NOT NULL CHECK (page_sequence BETWEEN 1 AND 9007199254740991),
  page_digest text NOT NULL CHECK (page_digest ~ '^[a-f0-9]{64}$'),
  through_character uuid NOT NULL,
  cursor_digest text NOT NULL CHECK (cursor_digest ~ '^[a-f0-9]{64}$'),
  content_chain text NOT NULL CHECK (content_chain ~ '^[a-f0-9]{64}$'),
  planned_count bigint NOT NULL CHECK (planned_count BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY(draft_id,page_sequence)
);
CREATE TABLE world_paged_grant_visibility (
  grant_id text PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES world_victim_drafts(draft_id),
  victim_key text NOT NULL,
  character_id uuid NOT NULL,
  UNIQUE(draft_id,character_id),
  FOREIGN KEY(grant_id,character_id) REFERENCES world_character_grants(grant_id,character_id)
);
CREATE INDEX world_paged_grant_visibility_victim ON world_paged_grant_visibility(victim_key);
CREATE TABLE world_paged_outcome_seals (
  victim_key text PRIMARY KEY CHECK (octet_length(victim_key) BETWEEN 1 AND 512),
  draft_id uuid UNIQUE NOT NULL,
  codec_version integer NOT NULL CHECK (codec_version > 0),
  recipient_count bigint NOT NULL CHECK (recipient_count BETWEEN 0 AND 9007199254740991),
  recipe_digest text NOT NULL CHECK (recipe_digest ~ '^[a-f0-9]{64}$'),
  digest_scheme text NOT NULL CHECK (digest_scheme='sha256-chain-v1'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  final_cursor_json text NOT NULL CHECK (octet_length(final_cursor_json) <= 4096),
  final_cursor_digest text NOT NULL CHECK (final_cursor_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER world_paged_outcome_seals_immutable BEFORE UPDATE OR DELETE ON world_paged_outcome_seals
  FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();

-- Staged journal rows and visibility mappings commit together; one constant-size seal publishes all N.
CREATE VIEW world_replayable_grants AS
SELECT g.* FROM world_character_grants g
WHERE NOT EXISTS(SELECT 1 FROM world_paged_grant_visibility v WHERE v.grant_id=g.grant_id)
   OR EXISTS(SELECT 1 FROM world_paged_grant_visibility v JOIN world_paged_outcome_seals s USING(victim_key) WHERE v.grant_id=g.grant_id);

-- Eligibility/staging obligations cannot be pruned before the complete immutable seal exists.
CREATE FUNCTION protect_unsealed_world_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE victim text;
BEGIN
  IF TG_TABLE_NAME='world_contributions' THEN victim=OLD.victim_key;
  ELSE SELECT victim_key INTO victim FROM world_victim_drafts WHERE draft_id=OLD.draft_id; END IF;
  IF NOT EXISTS(SELECT 1 FROM world_paged_outcome_seals WHERE victim_key=victim) THEN
    RAISE EXCEPTION 'unsealed world ledger obligations cannot be removed';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER world_contributions_protect_delete BEFORE DELETE ON world_contributions FOR EACH ROW EXECUTE FUNCTION protect_unsealed_world_ledger();
CREATE TRIGGER world_victim_pages_protect_delete BEFORE DELETE ON world_victim_pages FOR EACH ROW EXECUTE FUNCTION protect_unsealed_world_ledger();
CREATE TRIGGER world_paged_visibility_protect_delete BEFORE DELETE ON world_paged_grant_visibility FOR EACH ROW EXECUTE FUNCTION protect_unsealed_world_ledger();

CREATE TRIGGER world_victim_pages_immutable BEFORE UPDATE ON world_victim_pages FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();
