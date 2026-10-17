-- Chat reports from players (server/rooms.ts `report`). No IP address is stored. The lines are the reported
-- player's last chat lines as the others received them, already masked by server/chat/filter.ts.
-- Read them on the VM with server-dist/reports.mjs; rows older than 90 days are deleted by the hourly cleanup.

CREATE TABLE chat_reports (
  id bigserial PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT now(),
  -- The random id the reporter's browser tab made for this visit (or the connection id from an older client).
  reporter_session text NOT NULL,
  -- The reporter's account when the socket knows it. Sign-in cookies are not sent to /multiplayer, so NULL for now.
  reporter_account text,
  reporter_name text NOT NULL,
  target_session text NOT NULL,
  target_name text NOT NULL,
  -- [{"at": milliseconds since the Unix epoch, "text": "..."}], oldest first, at most 20.
  target_lines jsonb NOT NULL,
  -- Public shard (W1xxxx) or room code where they met.
  room text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('abuse', 'personal', 'harassment', 'other')),
  -- This was the third report on the target within ten minutes, which muted their chat for thirty minutes.
  muted boolean NOT NULL DEFAULT false
);
CREATE INDEX chat_reports_created ON chat_reports (created DESC);
CREATE INDEX chat_reports_target ON chat_reports (target_session, created DESC);
