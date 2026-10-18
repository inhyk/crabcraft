-- Completeness seal and immutable set digest for a whole victim lifetime outcome.
-- Existing account, character, journal and receipt rows are not rewritten.
CREATE TABLE world_victim_outcomes (
  outcome_key text PRIMARY KEY CHECK (octet_length(outcome_key) BETWEEN 1 AND 512),
  codec_version integer NOT NULL CHECK (codec_version > 0),
  recipient_count bigint NOT NULL CHECK (recipient_count BETWEEN 1 AND 9007199254740991),
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER world_victim_outcomes_immutable BEFORE UPDATE OR DELETE ON world_victim_outcomes
  FOR EACH ROW EXECUTE FUNCTION reject_world_grant_mutation();
