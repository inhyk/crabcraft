-- Typed dungeon completion is independent of combat victim/grant journals.
CREATE TABLE world_dungeon_completions (
  area_id text NOT NULL CHECK (octet_length(area_id) BETWEEN 1 AND 256),
  run_id uuid NOT NULL,
  manifest_json text NOT NULL CHECK (octet_length(manifest_json) <= 32768),
  recipient_count integer NOT NULL CHECK (recipient_count BETWEEN 0 AND 8),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(area_id,run_id)
);
CREATE TABLE world_dungeon_awards (
  award_id text PRIMARY KEY CHECK (octet_length(award_id) BETWEEN 1 AND 2048),
  journal_sequence bigserial UNIQUE NOT NULL,
  area_id text NOT NULL,
  run_id uuid NOT NULL,
  character_id uuid NOT NULL,
  account_id text NOT NULL,
  payload_json text NOT NULL CHECK (octet_length(payload_json) <= 8192),
  FOREIGN KEY(area_id,run_id) REFERENCES world_dungeon_completions(area_id,run_id),
  FOREIGN KEY(character_id,account_id) REFERENCES world_characters(character_id,account_id),
  UNIQUE(area_id,run_id,character_id),
  UNIQUE(award_id,character_id)
);
CREATE INDEX world_dungeon_awards_recipient ON world_dungeon_awards(character_id,journal_sequence);
CREATE TABLE world_dungeon_award_receipts (
  award_id text PRIMARY KEY,
  character_id uuid NOT NULL,
  applied_revision bigint NOT NULL CHECK (applied_revision BETWEEN 1 AND 9007199254740991),
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(award_id,character_id) REFERENCES world_dungeon_awards(award_id,character_id)
);
CREATE TRIGGER world_dungeon_completions_immutable BEFORE UPDATE OR DELETE ON world_dungeon_completions FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();
CREATE TRIGGER world_dungeon_awards_immutable BEFORE UPDATE OR DELETE ON world_dungeon_awards FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();
CREATE TRIGGER world_dungeon_receipts_immutable BEFORE UPDATE OR DELETE ON world_dungeon_award_receipts FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();

-- No partial manifest, including a trusted/raw writer accidentally omitting a recipient, can commit.
CREATE FUNCTION check_world_dungeon_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a text; r uuid; m jsonb; expected integer; actual integer;
BEGIN
  a:=NEW.area_id; r:=NEW.run_id;
  SELECT manifest_json::jsonb,recipient_count INTO m,expected FROM world_dungeon_completions WHERE area_id=a AND run_id=r;
  SELECT count(*) INTO actual FROM world_dungeon_awards WHERE area_id=a AND run_id=r;
  IF expected IS NULL OR actual<>expected OR jsonb_array_length(m->'recipients')<>expected THEN
    RAISE EXCEPTION 'incomplete dungeon completion manifest';
  END IF;
  IF m->>'kind' IS DISTINCT FROM 'dungeon-clear-v1' OR m->'candidate'->'run' IS DISTINCT FROM jsonb_build_object('area',a,'runId',r::text) THEN
    RAISE EXCEPTION 'dungeon manifest run does not match its row';
  END IF;
  IF EXISTS(SELECT 1 FROM world_dungeon_awards w WHERE w.area_id=a AND w.run_id=r AND (
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'recipients') e WHERE e->>'characterId'=w.character_id::text AND e->>'accountId'=w.account_id)
    OR w.payload_json::jsonb<>jsonb_build_object('schema','dungeon-award-v1','id',w.award_id,'run',m->'candidate'->'run','tier',m->'candidate'->'tier','recipient',w.character_id::text,'baseXp',m->'candidate'->'baseXp','coins',m->'candidate'->'coins')
    OR w.award_id::jsonb<>jsonb_build_array('dungeon-award-v1',a,r::text,w.character_id::text)
  )) THEN RAISE EXCEPTION 'dungeon award does not match sealed manifest'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER world_dungeon_completion_complete AFTER INSERT ON world_dungeon_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_dungeon_completion();
CREATE CONSTRAINT TRIGGER world_dungeon_awards_complete AFTER INSERT ON world_dungeon_awards DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_world_dungeon_completion();
