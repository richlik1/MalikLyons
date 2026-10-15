-- AI receptionist call records. The transcript holds speech-recognition text
-- of each turn (callers are told the call is transcribed).
CREATE TABLE calls (
  call_sid         text PRIMARY KEY,
  from_number      text,
  to_number        text,
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  status           text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress', 'completed', 'escalated', 'voicemail', 'failed')),
  turns            int NOT NULL DEFAULT 0,
  empty_turns      int NOT NULL DEFAULT 0,
  transcript       jsonb NOT NULL DEFAULT '[]'::jsonb,
  intent           text,
  captured         jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalated        boolean NOT NULL DEFAULT false,
  guard_events     jsonb NOT NULL DEFAULT '[]'::jsonb,
  voicemail_url    text,
  voicemail_text   text,
  owner_notified   boolean NOT NULL DEFAULT false
);
CREATE INDEX calls_started_idx ON calls (started_at DESC);

-- Apple device & storage assistant (reports come from the owner's Mac bridge).
CREATE TABLE storage_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  summary     jsonb NOT NULL,
  groups      jsonb NOT NULL
);

-- Owner-approved moves to Trash, executed by the bridge (never permanent deletion).
CREATE TABLE storage_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    uuid NOT NULL REFERENCES storage_reports(id) ON DELETE CASCADE,
  group_hash   text NOT NULL,
  keep_path    text NOT NULL,
  trash_paths  text[] NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'done', 'partial', 'failed')),
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz,
  UNIQUE (report_id, group_hash)
);
